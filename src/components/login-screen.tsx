"use client";

import Image, { getImageProps } from "next/image";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { preload } from "react-dom";
import { useLane } from "@/components/app-shell";
import {
  BirthDateFields,
  EMPTY_BIRTH_DATE,
  isAdultOn,
  isDeviceRefused,
  localToday,
  readBirthDate,
  refuseDevice,
  type BirthDateParts,
} from "@/components/age-gate";
import { CheckIcon } from "@/components/account/account-icons";
import { isPrivyConfigured } from "@/components/privy-app";
import { buttonClass, cx, inputClass } from "@/components/ui";
import type { Me } from "@/lib/api-types";
import {
  PASSWORD_MAX,
  USERNAME_MAX,
  authErrorField,
  authErrorMessage,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
  type AuthAction,
} from "@/lib/session";

type Mode = "login" | "signup" | "forgot";

type Stage =
  | { step: "form" }
  // A recovery code to save, after signing up or resetting a password.
  | { step: "code"; code: string; after: "signup" | "recover" }
  // An under-18 date of birth, here or on this device before.
  | { step: "refused" };

type Props = {
  embedded?: boolean;
  intent?: "login" | "signup";
  // The account, as soon as the server has signed it in (the cookie is set).
  onAccount?: (me: Me) => void;
  // All done: signed in, and any new recovery code saved.
  onSignedIn?: () => void;
  // True while a recovery code is on screen, so the modal can't close by accident.
  onLock?: (locked: boolean) => void;
};

type Field = "username" | "password" | "birthDate" | "consent" | "recoveryCode";
type Errors = Partial<Record<Field | "form", string>>;

type ErrorBody = { error?: string; code?: string } | null;
type Outcome<T> = { ok: true; data: T } | { ok: false; status: number | null; body: ErrorBody };

// POSTs to our own API. Same origin, so the session cookie it sets just works.
async function send<T>(path: string, json: unknown): Promise<Outcome<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) return { ok: false, status: response.status, body: body as ErrorBody };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

// A 403 that turns this device away: an under-18 date at sign-up, or a device
// refused before (the server reads the refusal cookie on every account form).
export function isRefusal(status: number | null, code: string | undefined) {
  return status === 403 && (code === "under_18" || code === "device_refused");
}

// What sign-up sends. The username goes as typed, only trimmed: the server
// logs in with its lower-case form and keeps this one as the display name.
export function signupRequest(fields: { username: string; password: string; birthDate: string }, now = new Date()) {
  return {
    username: fields.username.trim(),
    password: fields.password,
    birthDate: fields.birthDate,
    today: localToday(now),
    consent: true as const,
  };
}

// The picture beside the form (above it on phones), matched to the lane the
// visitor is browsing.
function panelArt(lane?: string) {
  return `/hero/hero-pair-${lane === "anime" || lane === "guys" ? lane : "girls"}.jpg`;
}

const PANEL_SIZES = "(min-width: 768px) 430px, 100vw";

// Called when someone hovers or focuses Log in / Join, so the art is already
// downloaded when the modal opens.
export function preloadLoginArt(lane?: string) {
  const { props } = getImageProps({ src: panelArt(lane), alt: "", fill: true, sizes: PANEL_SIZES });
  preload(props.src, { as: "image", imageSrcSet: props.srcSet, imageSizes: props.sizes, fetchPriority: "high" });
}

const legalLink = "!text-[var(--ink)] underline underline-offset-2";
const LEAVE_URL = "https://www.google.com";
// 16px text on phones, so focusing a field doesn't zoom the page.
const fieldClass = cx(inputClass, "h-12 !text-base aria-[invalid=true]:border-red-400 sm:!text-sm");
const textLink = "font-semibold text-[var(--accent)] underline-offset-2 hover:underline";

// Picture on the left, form on the right, in the modal or as a full page.
function Frame({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  const { lane } = useLane();
  const card = (
    <div
      className={cx(
        "grid text-[var(--ink)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]",
        embedded
          ? "bg-[var(--bg-2)]"
          : "w-full max-w-[880px] overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]",
      )}
    >
      <div className="relative h-40 overflow-hidden bg-[var(--surface)] sm:h-56 md:h-auto md:min-h-[640px]">
        <Image
          src={panelArt(lane)}
          alt=""
          fill
          sizes={PANEL_SIZES}
          loading="eager"
          fetchPriority="high"
          className="object-cover object-[50%_18%] md:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-2)] via-black/30 to-black/5 md:from-black/90 md:via-black/25 md:to-black/0" />
        <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
          <p className="text-xl font-bold leading-tight tracking-tight text-white md:text-[28px]">
            Meet an AI that <span className="text-[var(--accent)]">actually</span> remembers you.
          </p>
          <p className="mt-1.5 hidden text-xs leading-5 text-white/75 sm:block md:mt-2 md:text-sm md:leading-6">
            Every character is a fictional adult and every image is AI-generated.
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-center px-5 pb-7 pt-3 sm:px-10 md:py-10">
        <p className="hidden text-xl font-extrabold tracking-tight md:block">
          simu<span className="text-[var(--accent)]">lust</span>
        </p>
        {children}
      </div>
    </div>
  );
  if (embedded) return card;
  return <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 py-10">{card}</main>;
}

// A label, the control, then its hint or its error (which replaces the hint),
// and anything after it (Forgot password?), so Tab goes field to field.
function FieldRow({
  id,
  label,
  after,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  after?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const note = error ? (
    <p id={`${id}-error`} className="text-xs leading-5 text-red-300">
      {error}
    </p>
  ) : hint ? (
    <p id={`${id}-hint`} className="text-xs leading-5 text-[var(--muted)]">
      {hint}
    </p>
  ) : null;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-[var(--ink)]">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {note || after ? (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0">{note}</div>
          {after}
        </div>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  show,
  onToggle,
  invalid,
  describedBy: described,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  show: boolean;
  onToggle: () => void;
  invalid: boolean;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        name={autoComplete === "current-password" ? "password" : "new-password"}
        type={show ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={PASSWORD_MAX}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={described}
        className={cx(fieldClass, "!pr-[4.5rem]")}
      />
      <button
        type="button"
        aria-controls={id}
        aria-pressed={show}
        aria-label={show ? "Hide password" : "Show password"}
        onClick={onToggle}
        className="absolute right-1 top-1/2 flex h-10 min-w-14 -translate-y-1/2 items-center justify-center rounded-lg px-3 text-xs font-semibold text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--ink)]"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

const TITLES: Record<Mode, { title: string; subtitle: string }> = {
  signup: {
    title: "Join Simulust",
    subtitle: isPrivyConfigured()
      ? "A username and a password, nothing else. No email, and your account comes with its own Solana wallet."
      : "A username and a password, nothing else. No email needed.",
  },
  login: { title: "Welcome back", subtitle: "Pick up where you left off." },
  forgot: { title: "Reset your password", subtitle: "Use the recovery code you saved when you signed up." },
};

export function LoginScreen({ embedded = false, intent = "login", onAccount, onSignedIn, onLock }: Props) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(intent);
  // A device the age check turned away never sees the forms, to log in or to
  // sign up. Only ever mounted in the browser (the modal), so reading the
  // device here is safe.
  const [stage, setStage] = useState<Stage>(() => (isDeviceRefused() ? { step: "refused" } : { step: "form" }));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [birthDate, setBirthDate] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  // Where focus goes after the next mode or step change.
  const focusNext = useRef<"heading" | "username" | null>(null);

  const ids = {
    username: `${id}-username`,
    password: `${id}-password`,
    recoveryCode: `${id}-code`,
    consent: `${id}-consent`,
    birthDate: `${id}-birth`,
    form: `${id}-form-error`,
  };

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "heading") heading.current?.focus();
    else if (target === "username") usernameField.current?.focus();
  }, [mode, stage.step]);

  function switchMode(next: Mode, focus: "username" | null = null) {
    focusNext.current = focus;
    setMode(next);
    setErrors({});
    setPassword("");
    setShowPassword(false);
  }

  // Focus the first field that needs fixing, so keyboard and screen reader
  // users land on it.
  function showErrors(next: Errors) {
    setErrors(next);
    const order: Field[] = ["username", "password", "recoveryCode", "birthDate", "consent"];
    const first = order.find((field) => next[field]);
    if (first === "birthDate") document.getElementById(ids.birthDate)?.querySelector("select")?.focus();
    else if (first) document.getElementById(ids[first])?.focus();
  }

  function fail(action: AuthAction, outcome: { status: number | null; body: ErrorBody }) {
    const message = authErrorMessage(action, outcome.status, outcome.body);
    const field = action === "signup" && outcome.status === 409 ? "username" : authErrorField(outcome.body?.code);
    if (field) showErrors({ [field]: message });
    else setErrors({ form: message });
  }

  function refuse() {
    refuseDevice();
    onLock?.(false);
    focusNext.current = "heading";
    setStage({ step: "refused" });
  }

  function showCode(me: Me, code: string, after: "signup" | "recover") {
    onAccount?.(me);
    onLock?.(true);
    setPassword("");
    focusNext.current = "heading";
    setStage({ step: "code", code, after });
  }

  async function logIn() {
    const name = normalizeUsername(username);
    const problems: Errors = {
      username: name ? undefined : "Enter your username.",
      password: password ? undefined : "Enter your password.",
    };
    if (problems.username || problems.password) return showErrors(problems);
    setBusy(true);
    setErrors({});
    const outcome = await send<{ me: Me }>("/api/auth/login", { username: name, password });
    setBusy(false);
    if (!outcome.ok) return isRefusal(outcome.status, outcome.body?.code) ? refuse() : fail("login", outcome);
    onAccount?.(outcome.data.me);
    onSignedIn?.();
  }

  async function signUp() {
    const read = readBirthDate(birthDate);
    const problems: Errors = {
      // Checked in the lower-case form the server logs in with.
      username: usernameProblem(normalizeUsername(username)) ?? undefined,
      password: passwordProblem(password) ?? undefined,
      birthDate: "error" in read ? read.error : undefined,
      consent: consent ? undefined : "Tick the box to confirm you're 18 or older and agree.",
    };
    if (Object.values(problems).some(Boolean)) return showErrors(problems);
    if (!("date" in read)) return;
    // Under 18: no account, and this device is turned away like at the gate.
    if (!isAdultOn(read.date)) return refuse();
    setBusy(true);
    setErrors({});
    const outcome = await send<{ me: Me; recoveryCode: string }>(
      "/api/auth/signup",
      signupRequest({ username, password, birthDate: read.date }),
    );
    setBusy(false);
    if (!outcome.ok) return isRefusal(outcome.status, outcome.body?.code) ? refuse() : fail("signup", outcome);
    showCode(outcome.data.me, outcome.data.recoveryCode, "signup");
  }

  async function recover() {
    const name = normalizeUsername(username);
    const code = recoveryCode.trim();
    const problems: Errors = {
      username: name ? undefined : "Enter your username.",
      recoveryCode: code ? undefined : "Enter your recovery code.",
      password: passwordProblem(password) ?? undefined,
    };
    if (Object.values(problems).some(Boolean)) return showErrors(problems);
    setBusy(true);
    setErrors({});
    const outcome = await send<{ me: Me; recoveryCode: string }>("/api/auth/recover", {
      username: name,
      recoveryCode: code,
      newPassword: password,
    });
    setBusy(false);
    if (!outcome.ok) return isRefusal(outcome.status, outcome.body?.code) ? refuse() : fail("recover", outcome);
    setRecoveryCode("");
    showCode(outcome.data.me, outcome.data.recoveryCode, "recover");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void (mode === "login" ? logIn() : mode === "signup" ? signUp() : recover());
  }

  if (stage.step === "code") {
    return (
      <Frame embedded={embedded}>
        <RecoveryCodeStep
          code={stage.code}
          after={stage.after}
          headingRef={heading}
          onDone={() => {
            onLock?.(false);
            onSignedIn?.();
          }}
        />
      </Frame>
    );
  }

  if (stage.step === "refused") {
    return (
      <Frame embedded={embedded}>
        <h1
          id="login-title"
          ref={heading}
          tabIndex={-1}
          // The modal opens with focus here when the device was refused before.
          data-autofocus
          className="mt-5 text-2xl font-bold leading-tight tracking-tight outline-none md:text-3xl"
        >
          Simulust is for adults.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          You need to be 18 or older to have an account here, so we can&apos;t let you in. Thanks for being honest
          with us.
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Picked the wrong year by mistake? Contact support through the{" "}
          <a href="/report" className={legalLink}>
            report page
          </a>{" "}
          and we&apos;ll take a look.
        </p>
        <a className={buttonClass("primary", "lg", "mt-6 w-full")} href={LEAVE_URL}>
          Leave
        </a>
        <p className="mt-5 flex justify-center gap-4 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
          <a href="/terms" className={legalLink}>Terms</a>
          <a href="/privacy" className={legalLink}>Privacy</a>
          <a href="/report" className={legalLink}>Report content</a>
        </p>
      </Frame>
    );
  }

  const signup = mode === "signup";
  const forgot = mode === "forgot";
  const { title, subtitle } = TITLES[mode];
  const usernameHint = signup ? "3 to 24 letters, numbers or underscores. It's how you log in." : undefined;
  const passwordHint = signup || forgot ? "At least 8 characters." : undefined;
  const passwordLabel = forgot ? "New password" : "Password";

  return (
    <Frame embedded={embedded}>
      {forgot ? (
        <button
          type="button"
          onClick={() => switchMode("login", "username")}
          className="-ml-2 mt-1 inline-flex h-10 items-center self-start rounded-full px-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)] md:mt-4"
        >
          <span aria-hidden className="mr-1">←</span>
          Back to log in
        </button>
      ) : (
        <div
          role="group"
          aria-label="Sign up or log in"
          className="grid grid-cols-2 gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 md:mt-5"
        >
          {(["signup", "login"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => mode !== option && switchMode(option)}
              className={cx(
                "h-9 rounded-full text-sm font-semibold transition-[background-color,color] duration-150",
                mode === option ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {option === "signup" ? "Sign up" : "Log in"}
            </button>
          ))}
        </div>
      )}
      <h1 id="login-title" ref={heading} tabIndex={-1} className="mt-5 text-2xl font-bold leading-tight tracking-tight outline-none md:text-3xl">
        {title}
      </h1>
      <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{subtitle}</p>

      <form className="mt-5 flex flex-col gap-4" onSubmit={submit} noValidate aria-describedby={errors.form ? ids.form : undefined}>
        <FieldRow id={ids.username} label="Username" hint={usernameHint} error={errors.username}>
          <input
            ref={usernameField}
            id={ids.username}
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            enterKeyHint="next"
            disabled={busy}
            // The modal opens with focus on its first field.
            data-autofocus
            aria-invalid={Boolean(errors.username) || undefined}
            aria-describedby={describedBy(ids.username, errors.username, usernameHint)}
            className={fieldClass}
          />
        </FieldRow>

        {forgot ? (
          <FieldRow
            id={ids.recoveryCode}
            label="Recovery code"
            hint="The code we showed you when you signed up, or after your last reset."
            error={errors.recoveryCode}
          >
            <input
              id={ids.recoveryCode}
              name="recovery-code"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              enterKeyHint="next"
              disabled={busy}
              aria-invalid={Boolean(errors.recoveryCode) || undefined}
              aria-describedby={describedBy(ids.recoveryCode, errors.recoveryCode, true)}
              className={cx(fieldClass, "font-mono tracking-wider")}
            />
          </FieldRow>
        ) : null}

        <FieldRow
          id={ids.password}
          label={passwordLabel}
          hint={passwordHint}
          error={errors.password}
          after={
            mode === "login" ? (
              <button
                type="button"
                className={cx(textLink, "-my-2 shrink-0 py-2 text-xs")}
                onClick={() => switchMode("forgot", "username")}
              >
                Forgot password?
              </button>
            ) : null
          }
        >
          <PasswordInput
            id={ids.password}
            value={password}
            onChange={setPassword}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            invalid={Boolean(errors.password)}
            describedBy={describedBy(ids.password, errors.password, passwordHint)}
            disabled={busy}
          />
        </FieldRow>

        {signup ? (
          <>
            <div id={ids.birthDate}>
              <BirthDateFields value={birthDate} onChange={setBirthDate} disabled={busy} invalid={Boolean(errors.birthDate)} />
              {errors.birthDate ? (
                <p className="mt-1.5 text-xs leading-5 text-red-300">{errors.birthDate}</p>
              ) : (
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  We check it and forget it. Only the time you confirmed is kept.
                </p>
              )}
            </div>
            <div>
              <label htmlFor={ids.consent} className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-[var(--muted)]">
                <input
                  id={ids.consent}
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                  aria-labelledby={`${ids.consent}-label`}
                  aria-invalid={Boolean(errors.consent) || undefined}
                  aria-describedby={errors.consent ? `${ids.consent}-error` : undefined}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <span id={`${ids.consent}-label`}>
                  I&apos;m 18 or older, I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noreferrer" className={legalLink}>
                    Terms
                  </a>{" "}
                  and{" "}
                  <a href="/content-policy" target="_blank" rel="noreferrer" className={legalLink}>
                    Content policy
                  </a>
                  , and I want explicit adult content: everything here is uncensored.
                </span>
              </label>
              {errors.consent ? (
                <p id={`${ids.consent}-error`} className="mt-1.5 text-xs leading-5 text-red-300">
                  {errors.consent}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {errors.form ? (
          <p id={ids.form} role="alert" className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200">
            {errors.form}
          </p>
        ) : null}

        <button type="submit" disabled={busy} aria-busy={busy || undefined} className={buttonClass("primary", "lg", "w-full")}>
          {busy
            ? signup
              ? "Creating your account…"
              : forgot
                ? "Resetting…"
                : "Logging in…"
            : signup
              ? "Create free account"
              : forgot
                ? "Reset password"
                : "Log in"}
        </button>
      </form>

      {forgot ? (
        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          There&apos;s no email on your account, so the recovery code is the only way to reset a password.
        </p>
      ) : (
        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          {signup ? "Already have an account? " : "New here? "}
          <button type="button" className={textLink} onClick={() => switchMode(signup ? "login" : "signup", "username")}>
            {signup ? "Log in" : "Create a free account"}
          </button>
        </p>
      )}
      <p className="mt-4 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--muted)]">
        18+ only.{" "}
        {signup ? (
          <>
            How we handle your data: our{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className={legalLink}>
              Privacy Policy
            </a>
            .
          </>
        ) : (
          <>
            By continuing you agree to the{" "}
            <a href="/terms" target="_blank" rel="noreferrer" className={legalLink}>
              Terms
            </a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className={legalLink}>
              Privacy Policy
            </a>
            .
          </>
        )}
      </p>
    </Frame>
  );
}

// Shown once, right after sign-up or a password reset. With no email on the
// account, it's the only way back in after a forgotten password.
function RecoveryCodeStep({
  code,
  after,
  headingRef,
  onDone,
}: {
  code: string;
  after: "signup" | "recover";
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const codeBox = useRef<HTMLParagraphElement>(null);
  // Groups of the code ("ABCDE-FGHIJ-…"), so a narrow screen wraps between
  // groups, never inside one.
  const groups = code.split("-");

  // The clipboard API needs permission some browsers don't give; then the old
  // way, with the code selected so copying by hand is one step.
  function copy() {
    const fallback = () => {
      const box = codeBox.current;
      const selection = window.getSelection();
      if (box && selection) {
        selection.selectAllChildren(box);
        try {
          if (document.execCommand("copy")) return setCopied("yes");
        } catch {
          // Fall through to copying by hand.
        }
      }
      setCopied("failed");
    };
    if (!navigator.clipboard) return fallback();
    navigator.clipboard
      .writeText(code)
      .then(() => setCopied("yes"))
      .catch(fallback);
  }

  return (
    <>
      <h1
        id="login-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-5 text-2xl font-bold leading-tight tracking-tight outline-none md:text-3xl"
      >
        {after === "signup" ? "Save your recovery code" : "Your new recovery code"}
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {after === "signup"
          ? "You're in. There's no email on your account, so this code is the only way back in if you ever forget your password."
          : "Your password is changed, and your old code no longer works. This one replaces it: it's the only way back in if you forget your password again."}{" "}
        Keep it somewhere safe, like a password manager.
      </p>
      <div className="mt-5 rounded-2xl border border-dashed border-[var(--accent)]/45 bg-[var(--accent-soft)] px-4 py-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Recovery code</p>
        <p
          ref={codeBox}
          className="mt-2 select-all break-all font-mono text-2xl font-bold tracking-[0.12em] text-[var(--ink)] sm:text-[26px]"
        >
          {groups.map((group, index) => (
            <span key={index} className="inline-block whitespace-nowrap">
              {group}
              {index < groups.length - 1 ? "-" : ""}
            </span>
          ))}
        </p>
      </div>
      <button type="button" onClick={copy} className={buttonClass("secondary", "lg", "mt-3 w-full")}>
        {copied === "yes" ? (
          <>
            <CheckIcon className="h-4 w-4 text-emerald-300" />
            Copied
          </>
        ) : (
          "Copy code"
        )}
      </button>
      <p role="status" className="mt-2 min-h-5 text-center text-xs text-[var(--muted)]">
        {copied === "yes"
          ? "Copied to your clipboard."
          : copied === "failed"
            ? "Couldn't copy it. The code is selected: copy it by hand."
            : ""}
      </p>
      <button type="button" onClick={onDone} className={buttonClass("primary", "lg", "mt-3 w-full")}>
        I&apos;ve saved it
      </button>
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        We only keep a scrambled copy, so we can&apos;t show it to you again.
      </p>
    </>
  );
}
