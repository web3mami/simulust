"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AGE_DOT } from "@/components/account-menu";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import {
  ACCOUNT_PAGE,
  AccountNav,
  Notice,
  SectionCard,
  SignInPrompt,
  SkeletonCard,
  fieldLabel,
  solidDangerClass,
} from "@/components/account/account-ui";
import { DownloadIcon, TrashIcon } from "@/components/account/account-icons";
import { LockIcon, SettingsIcon, SignOutIcon, UserIcon } from "@/components/icons";
import { PageHeader, buttonClass, cx, inputClass } from "@/components/ui";
import { ApiError, useApi, useAuthHeaders } from "@/lib/api";
import type { Me } from "@/lib/api-types";
import { ageLine } from "@/lib/session";

// Everything explicit is open to every confirmed adult, so there's no switch
// for it here: only what characters may send unasked.
type SettingKey = "unpromptedMedia";

export default function SettingsPage() {
  const router = useRouter();
  const { ready, session, me, refreshMe, signOut, openLogin, openSignup } = useSession();
  const api = useApi();
  const authHeaders = useAuthHeaders();
  const [saving, setSaving] = useState<SettingKey | null>(null);
  // The switch moves the moment it's tapped; if the save fails it moves back
  // and the error shows.
  const [optimistic, setOptimistic] = useState<Partial<Record<SettingKey, boolean>>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ message: string; hold: boolean } | null>(null);

  async function toggle(key: SettingKey, value: boolean) {
    setSaving(key);
    setSettingsError(null);
    setOptimistic((current) => ({ ...current, [key]: value }));
    try {
      await api<{ me: Me }>("/api/me", { method: "PATCH", json: { settings: { [key]: value } } });
      await refreshMe();
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "That didn't save. Try again.");
    } finally {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setSaving(null);
    }
  }

  async function exportData() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/me/export", { headers: await authHeaders(), cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "We couldn't prepare your export. Try again.");
      }
      const blob = await response.blob();
      const name =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "simulust-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "We couldn't prepare your export. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api<{ ok: true }>("/api/me/account", { method: "DELETE", json: { confirm: confirmText } });
      signOut();
      router.replace("/");
    } catch (caught) {
      setDeleteError({
        message: caught instanceof Error ? caught.message : "We couldn't delete your account. Try again.",
        // 409 deletion_on_hold: some content is under review, so support deletes it later.
        hold: caught instanceof ApiError && caught.code === "deletion_on_hold",
      });
      setDeleting(false);
    }
  }

  let content: ReactNode;
  if (!ready || (session && !me)) {
    content = (
      <div className="space-y-6" aria-busy="true" aria-label="Loading your settings">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={2} />
      </div>
    );
  } else if (!me) {
    content = (
      <SignInPrompt
        title="Sign in to change your settings."
        body="Choose what characters can send you, download your data, or delete your account."
        onLogin={openLogin}
        onSignup={openSignup}
      />
    );
  } else {
    const age = ageLine(me);
    content = (
      <div className="space-y-6">
        {me.explicitHold ? (
          <Notice tone="hold" role="status">
            <span className="mb-1 block font-semibold">Paused while we review this account</span>
            Simulust is only for adults. Something on this account said you might be under 18, so nude and explicit
            content is off until our team has looked. Everything else here still works, and you can download your data
            or delete the account below.
          </Notice>
        ) : null}

        <SectionCard title="Account" icon={<UserIcon />}>
          <dl className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-[var(--muted)]">Username</dt>
                <dd className="mt-1 break-all text-sm font-semibold text-[var(--ink)]">
                  {me.username ? `@${me.username}` : session?.display}
                </dd>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-[var(--muted)]">Age</dt>
                <dd className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <span aria-hidden className={cx("h-2 w-2 rounded-full", AGE_DOT[age.tone])} />
                  {age.label}
                </dd>
              </div>
              {age.href ? (
                <Link href={age.href} className={buttonClass("primary", "sm", "h-10 px-4")}>
                  Confirm
                </Link>
              ) : null}
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            {me.username ? (
              <Link href="/profile#password" className={buttonClass("secondary", "md", "whitespace-nowrap")}>
                <LockIcon className="h-4 w-4" />
                Change password
              </Link>
            ) : null}
            <button type="button" className={buttonClass("ghost", "md", "whitespace-nowrap")} onClick={signOut}>
              <SignOutIcon className="h-4 w-4" />
              Log out
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Preferences"
          description="What characters can send you."
          icon={<SettingsIcon />}
        >
          <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
            <Row
              title="Photos and voice notes without asking"
              body="Characters can send a photo or voice note on their own now and then. Off means they only send media when you ask. Media still costs credits."
              control={
                <Toggle
                  label="Photos and voice notes without asking"
                  on={optimistic.unpromptedMedia ?? me.settings.unpromptedMedia}
                  disabled={saving !== null}
                  busy={saving === "unpromptedMedia"}
                  onChange={(value) => toggle("unpromptedMedia", value)}
                />
              }
            />
          </div>
          {settingsError ? (
            <Notice role="alert" className="mt-3">
              {settingsError}
            </Notice>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Your data"
          description="One JSON file with your account, profile, characters, chats, memories, orders and credit history."
          icon={<DownloadIcon />}
        >
          <button type="button" disabled={exporting} className={buttonClass("secondary", "md")} onClick={exportData}>
            <DownloadIcon className="h-4 w-4" />
            {exporting ? "Preparing…" : "Download my data"}
          </button>
          {exportError ? (
            <Notice role="alert" className="mt-3">
              {exportError}
            </Notice>
          ) : null}
        </SectionCard>

        <SectionCard
          tone="danger"
          title="Delete account"
          icon={<TrashIcon />}
          description={
            <>
              This permanently deletes your account, characters, chats, memories, photos, voice notes and videos, and
              any credits you have left. It can&apos;t be undone. Download your data first if you want a copy.
            </>
          }
        >
          <label className="block max-w-md">
            <span className={cx(fieldLabel, "font-medium text-[var(--muted)]")}>
              Type <span className="font-bold text-[var(--ink)]">DELETE</span> to confirm
            </span>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className={cx(inputClass, "mt-2 h-11 font-semibold tracking-wide focus:border-red-400")}
            />
          </label>
          <button
            type="button"
            disabled={confirmText !== "DELETE" || deleting}
            className={solidDangerClass("md", "mt-4 w-full sm:w-auto")}
            onClick={deleteAccount}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
          {deleteError ? (
            <Notice role="alert" tone={deleteError.hold ? "hold" : "error"} className="mt-4">
              {deleteError.hold ? <span className="mb-1 block font-semibold">Deletion is on hold</span> : null}
              {deleteError.message}
            </Notice>
          ) : null}
        </SectionCard>
      </div>
    );
  }

  return (
    <AppShell>
      <div className={ACCOUNT_PAGE}>
        <PageHeader title="Settings" accent="Account" subtitle="Your account, what characters can send you, and your data." />
        <AccountNav className="mt-5" />
        <div className="mt-6">{content}</div>
      </div>
    </AppShell>
  );
}

function Row({ title, body, control }: { title: string; body: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-4 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--ink)]">{title}</p>
        <div className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">{body}</div>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

function Toggle({
  label,
  on,
  disabled,
  busy,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      aria-busy={busy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      // A 40px tall hit area around the 28px track.
      className="group flex h-10 w-14 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cx(
          "relative h-7 w-12 rounded-full transition-colors",
          on ? "bg-[var(--accent)]" : "bg-white/15 group-hover:bg-white/20",
        )}
      >
        <span
          className={cx(
            "absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
            on ? "translate-x-6" : "translate-x-1",
            busy && "animate-pulse motion-reduce:animate-none",
          )}
        />
      </span>
    </button>
  );
}
