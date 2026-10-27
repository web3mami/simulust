"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { useApi, useAuthHeaders } from "@/lib/api";
import type { Me } from "@/lib/api-types";

type SettingKey = "explicit" | "unpromptedMedia";

export default function SettingsPage() {
  const router = useRouter();
  const { ready, session, me, refreshMe, signOut, openLogin, openSignup } = useSession();
  const api = useApi();
  const authHeaders = useAuthHeaders();
  const [saving, setSaving] = useState<SettingKey | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggle(key: SettingKey, value: boolean) {
    setSaving(key);
    setSettingsError(null);
    try {
      await api<{ me: Me }>("/api/me", { method: "PATCH", json: { settings: { [key]: value } } });
      await refreshMe();
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : "That didn't save. Try again.");
    } finally {
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
      setDeleteError(caught instanceof Error ? caught.message : "We couldn't delete your account. Try again.");
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">Settings</h1>

        {!ready || (session && !me) ? (
          <p className="mt-8 text-sm text-[var(--muted)]">Loading…</p>
        ) : !me ? (
          <div className="mt-8">
            <p className="text-[var(--muted)]">Sign in to change your settings.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-[var(--ink)]"
                onClick={openLogin}
              >
                Login
              </button>
              <button
                type="button"
                className="rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-medium !text-[#12110F]"
                onClick={openSignup}
              >
                Sign up
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="mt-10 text-xs uppercase tracking-wide text-[var(--muted)]">Content</h2>
            <div className="mt-3 divide-y divide-[var(--line)] rounded-3xl border border-[var(--line)] bg-[var(--bg-2)]">
              <Row
                title="Explicit content"
                body={
                  me.ageVerified ? (
                    <>
                      Lets characters write explicitly and send explicit photos, voice notes and video when you ask.
                      Turning this on means you agree to us processing your chats, which may reveal details of your sex
                      life, to run the service. Turn it off any time. See our{" "}
                      <Link href="/privacy" className="text-[var(--gold)] underline underline-offset-2">
                        privacy policy
                      </Link>
                      .
                    </>
                  ) : (
                    <>
                      Needs a one-time ID check first.{" "}
                      <Link href="/verify" className="text-[var(--gold)] underline underline-offset-2">
                        Verify your age
                      </Link>
                      .
                    </>
                  )
                }
                control={
                  <Toggle
                    label="Explicit content"
                    on={me.settings.explicit}
                    disabled={!me.ageVerified || saving !== null}
                    busy={saving === "explicit"}
                    onChange={(value) => toggle("explicit", value)}
                  />
                }
              />
              <Row
                title="Photos and voice notes without asking"
                body="Characters can send a photo or voice note on their own now and then. Off means they only send media when you ask. Media still costs credits."
                control={
                  <Toggle
                    label="Photos and voice notes without asking"
                    on={me.settings.unpromptedMedia}
                    disabled={saving !== null}
                    busy={saving === "unpromptedMedia"}
                    onChange={(value) => toggle("unpromptedMedia", value)}
                  />
                }
              />
            </div>
            {settingsError ? <p className="mt-3 text-sm text-red-300">{settingsError}</p> : null}

            <h2 className="mt-10 text-xs uppercase tracking-wide text-[var(--muted)]">Your data</h2>
            <div className="mt-3 rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-5">
              <p className="text-[var(--ink)]">Download your data</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                One JSON file with your account, profile, characters, chats, memories, orders and credit history.
              </p>
              <button
                type="button"
                disabled={exporting}
                className="mt-4 rounded-full border border-white/20 px-5 py-2.5 text-sm text-[var(--ink)] disabled:opacity-60"
                onClick={exportData}
              >
                {exporting ? "Preparing…" : "Download my data"}
              </button>
              {exportError ? <p className="mt-3 text-sm text-red-300">{exportError}</p> : null}
            </div>

            <h2 className="mt-10 text-xs uppercase tracking-wide text-red-300">Delete account</h2>
            <div className="mt-3 rounded-3xl border border-red-400/30 bg-red-500/5 p-5">
              <p className="text-sm leading-6 text-[var(--muted)]">
                This permanently deletes your account, characters, chats, memories, photos, voice notes and videos, and
                any credits you have left. It can&apos;t be undone. Download your data first if you want a copy.
              </p>
              <label className="mt-4 block">
                <span className="text-xs text-[var(--muted)]">
                  Type <span className="font-medium text-[var(--ink)]">DELETE</span> to confirm
                </span>
                <input
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  autoComplete="off"
                  className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:border-red-400"
                />
              </label>
              <button
                type="button"
                disabled={confirmText !== "DELETE" || deleting}
                className="mt-4 rounded-full bg-red-500/90 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                onClick={deleteAccount}
              >
                {deleting ? "Deleting…" : "Delete my account"}
              </button>
              {deleteError ? <p className="mt-3 text-sm text-red-300">{deleteError}</p> : null}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}

function Row({ title, body, control }: { title: string; body: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 p-5">
      <div className="min-w-0 flex-1">
        <p className="text-[var(--ink)]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{body}</p>
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
      className={`relative h-7 w-12 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-[var(--gold)]" : "bg-white/15"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1 h-5 w-5 rounded-full bg-[var(--bg)] transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        } ${busy ? "animate-pulse" : ""}`}
        style={{ left: 0 }}
      />
    </button>
  );
}
