"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ACCOUNT_PAGE, Notice, SectionCard, fieldHint, fieldLabel } from "@/components/account/account-ui";
import { CheckIcon } from "@/components/account/account-icons";
import { ShieldIcon } from "@/components/icons";
import { Button, PageHeader, Panel, buttonClass, cx, inputClass } from "@/components/ui";
import { useApi } from "@/lib/api";

type Kind = "ncii" | "csam" | "real_person" | "copyright" | "other";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  {
    value: "ncii",
    label: "An intimate image of me or someone else, shared without consent",
    hint: "Real or AI-made. Handled under the TAKE IT DOWN Act.",
  },
  {
    value: "csam",
    label: "Anything that sexualizes a minor, or someone who looks like one",
    hint: "Includes drawn and anime content. We report it to NCMEC.",
  },
  {
    value: "real_person",
    label: "Content that looks like a real, identifiable person",
    hint: "A celebrity, public figure, or anyone you know.",
  },
  {
    value: "copyright",
    label: "Copyright infringement",
    hint: "For a formal DMCA notice, see our DMCA page.",
  },
  { value: "other", label: "Something else", hint: "Anything else that breaks our content policy." },
];

export default function ReportPage() {
  const api = useApi();
  const [kind, setKind] = useState<Kind | null>(null);
  const [target, setTarget] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);

  useEffect(() => {
    // Links from elsewhere in the app can prefill what's being reported.
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("target");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (prefill) setTarget(prefill.slice(0, 1000));
    const preKind = params.get("kind");
    if (KINDS.some((option) => option.value === preKind)) setKind(preKind as Kind);
  }, []);

  const ncii = kind === "ncii";

  async function submit() {
    if (!kind) {
      setError("Choose what you're reporting.");
      return;
    }
    if (!target.trim()) {
      setError("Tell us where the content is: paste the page link, media id or character id.");
      return;
    }
    if (ncii && (!email.trim() || !signature.trim() || !goodFaith)) {
      setError("For this kind of request we need your email, your name as a signature, and the statement checked.");
      return;
    }
    setBusy(true);
    setError(null);
    // The TAKE IT DOWN Act asks for a signature and a good-faith statement;
    // they travel with the details so the reviewer sees them together.
    const full = ncii
      ? `${details.trim()}\n\nSigned: ${signature.trim()}\nGood-faith statement: I believe this depiction was published without the consent of the person shown.`.trim()
      : details.trim();
    try {
      const result = await api<{ ok: true; dueAt: string }>("/api/reports", {
        method: "POST",
        json: { kind, target: target.trim(), details: full.slice(0, 5000), email: email.trim() || undefined },
      });
      setDueAt(result.dueAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send your report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className={ACCOUNT_PAGE}>
        <PageHeader
          accent="Report"
          title="content"
          subtitle={
            <>
              Tell us about anything on Simulust that shouldn&apos;t be here. You don&apos;t need an account. A person reviews
              every report.
            </>
          }
        />

        {/* The form comes first in the page, so phones reach it without scrolling
            past the policy summary; on wide screens the summary sits beside it. */}
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {dueAt ? (
              <Panel className="flex flex-col items-start p-6 sm:p-8">
                <span
                  aria-hidden
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"
                >
                  <CheckIcon className="h-6 w-6" />
                </span>
                <h2 className="mt-4 text-2xl font-bold tracking-tight text-[var(--ink)]">Report received</h2>
                <p className="mt-2 leading-7 text-[var(--muted)]">
                  Thank you. We&apos;ll act on it by{" "}
                  <span className="font-semibold text-[var(--ink)]">
                    {new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  . {email.trim() ? "We'll email you when it's done." : "Add an email next time if you want to hear back."}
                </p>
                <Button
                  variant="secondary"
                  size="lg"
                  className="mt-6"
                  onClick={() => {
                    setDueAt(null);
                    setKind(null);
                    setTarget("");
                    setDetails("");
                    setSignature("");
                    setGoodFaith(false);
                  }}
                >
                  Report something else
                </Button>
              </Panel>
            ) : (
              <form
                className="space-y-7 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <fieldset>
                  <legend className={fieldLabel}>What are you reporting?</legend>
                  <div className="mt-3 space-y-2">
                    {KINDS.map((option) => {
                      const on = kind === option.value;
                      return (
                        <label
                          key={option.value}
                          className={cx(
                            "flex cursor-pointer gap-3 rounded-xl border px-4 py-3.5 transition-colors",
                            on
                              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                              : "border-[var(--line)] bg-[var(--bg-2)] hover:border-white/20",
                          )}
                        >
                          <input
                            type="radio"
                            name="kind"
                            value={option.value}
                            checked={on}
                            onChange={() => setKind(option.value)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-[var(--ink)]">{option.label}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
                              {option.value === "copyright" ? (
                                <>
                                  For a formal notice, see our{" "}
                                  <Link href="/dmca" className="!text-[var(--accent)] underline underline-offset-2">
                                    DMCA page
                                  </Link>
                                  .
                                </>
                              ) : (
                                option.hint
                              )}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block">
                  <span className={fieldLabel}>Where is it?</span>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    placeholder="Page link, media id or character id"
                    maxLength={1000}
                    className={cx(inputClass, "mt-2 h-11")}
                  />
                  <span className={fieldHint}>
                    The address in your browser works, for example a character&apos;s chat page or an image link.
                  </span>
                </label>

                <label className="block">
                  <span className={fieldLabel}>Details</span>
                  <textarea
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    rows={5}
                    maxLength={4500}
                    placeholder="What's wrong with it, and anything that helps us find it."
                    className={cx(inputClass, "mt-2 resize-y py-3 leading-6")}
                  />
                </label>

                <label className="block">
                  <span className={fieldLabel}>
                    Your email{" "}
                    <span className="font-normal text-[var(--muted)]">{ncii ? "(required)" : "(optional)"}</span>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="So we can tell you what we did"
                    maxLength={254}
                    className={cx(inputClass, "mt-2 h-11")}
                  />
                </label>

                {ncii ? (
                  <div className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--bg-2)] p-4">
                    <label className="block">
                      <span className={fieldLabel}>Your full name, as a signature</span>
                      <input
                        value={signature}
                        onChange={(event) => setSignature(event.target.value)}
                        maxLength={120}
                        className={cx(inputClass, "mt-2 h-11")}
                      />
                    </label>
                    <label className="flex cursor-pointer gap-3 text-sm leading-6 text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={goodFaith}
                        onChange={(event) => setGoodFaith(event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      I believe in good faith that this intimate depiction was published without the consent of the person
                      shown. I am that person or am authorized to act for them.
                    </label>
                  </div>
                ) : null}

                {error ? <Notice role="alert">{error}</Notice> : null}

                <button type="submit" disabled={busy} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
                  {busy ? "Sending…" : "Send report"}
                </button>
              </form>
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-24">
            <SectionCard title="What happens next" icon={<ShieldIcon />}>
              <ul className="space-y-4 text-sm leading-6 text-[var(--muted)]">
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>
                    <strong className="text-[var(--ink)]">Intimate images shared without consent</strong> are removed within
                    48 hours of a valid request, as the TAKE IT DOWN Act requires. We also remove copies we can find.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>
                    <strong className="text-[var(--ink)]">Child sexual abuse material</strong> is removed, the account is
                    closed, and we report it to the National Center for Missing &amp; Exploited Children (NCMEC). You can
                    also report directly to NCMEC at{" "}
                    <a
                      href="https://report.cybertip.org"
                      className="!text-[var(--accent)] underline underline-offset-2"
                      rel="noreferrer"
                      target="_blank"
                    >
                      report.cybertip.org
                    </a>{" "}
                    or 1-800-843-5678.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>Everything else is reviewed within 48 hours.</span>
                </li>
              </ul>
            </SectionCard>
            <p className="hidden px-1 text-xs leading-5 text-[var(--muted)] lg:block">
              <EmergencyNote />
            </p>
          </aside>
        </div>

        <p className="mt-8 text-xs leading-5 text-[var(--muted)] lg:hidden">
          <EmergencyNote />
        </p>
      </div>
    </AppShell>
  );
}

function EmergencyNote() {
  return (
    <>
      If someone is in immediate danger, contact local emergency services. See our{" "}
      <Link href="/content-policy" className="underline underline-offset-2 hover:!text-[var(--ink)]">
        content policy
      </Link>{" "}
      and{" "}
      <Link href="/safety" className="underline underline-offset-2 hover:!text-[var(--ink)]">
        safety page
      </Link>
      .
    </>
  );
}
