"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { Notice, SkeletonCard, solidDangerClass } from "@/components/account/account-ui";
import { AdminIcon } from "@/components/icons";
import {
  ButtonLink,
  Chip,
  EmptyState,
  PAGE_GUTTER,
  PAGE_PAD_Y,
  PageHeader,
  buttonClass,
  cx,
  inputClass,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import type {
  AdminMediaDTO,
  AdminModerationEventDTO,
  AdminReportDTO,
  AdminReviewResult,
  AdminTakedownResult,
  AdminUserDTO,
  ReportKind,
} from "@/app/api/admin/_lib/types";

type Tab = "reports" | "queue" | "users" | "media";

const TABS: { id: Tab; label: string }[] = [
  { id: "reports", label: "Reports" },
  { id: "queue", label: "Safety queue" },
  { id: "users", label: "Users" },
  { id: "media", label: "Media" },
];

// An age check that read an under-18 birth date (UNDERAGE_FINDING in
// server/auth). It's closed by unbanning the user, not from the queue.
const AGE_LOCK = "age_check_underage";

const KIND_LABEL: Record<ReportKind, string> = {
  ncii: "Non-consensual intimate image",
  csam: "Minor / CSAM",
  real_person: "Real person",
  copyright: "Copyright",
  other: "Other",
};

const input = inputClass;
// Links get `!` so the colour beats the global `a { color: inherit }`.
const ghost = buttonClass("secondary", "md", "!text-[var(--ink)]");
const primary = buttonClass("primary", "md");
const danger = solidDangerClass("md");
const card = "rounded-2xl border p-5";
const pill = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// What a takedown did with the files, in plain words.
function takedownSummary({ held, deleted }: AdminTakedownResult) {
  if (!held && !deleted) return "Taken down. There were no files to keep or delete.";
  if (!deleted) return `Taken down. Kept ${plural(held, "file")} under legal hold for one year; nothing was deleted.`;
  if (!held) return `Taken down. Deleted ${plural(deleted, "file")}; nothing was kept.`;
  return `Taken down. Kept ${plural(held, "file")} under legal hold for one year and deleted ${plural(deleted, "file")}.`;
}

function dueIn(iso: string) {
  const hours = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return `${Math.ceil(-hours)}h overdue`;
  if (hours < 1) return "due within the hour";
  return `due in ${Math.floor(hours)}h`;
}

// Loads a list from the admin API and exposes reload plus loading/error state.
function useAdminList<T>(path: string | null, key: string) {
  const api = useApi();
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const body = await api<Record<string, T[]>>(path);
      setItems(body[key] ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't load this list.");
    } finally {
      setLoading(false);
    }
  }, [api, path, key]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  return { items, setItems, error, loading, reload };
}

export default function AdminPage() {
  const { ready, session, me } = useSession();
  const [tab, setTab] = useState<Tab>("reports");
  const [userQuery, setUserQuery] = useState("");

  return (
    <AppShell>
      <section className={cx("mx-auto w-full max-w-6xl", PAGE_GUTTER, PAGE_PAD_Y)}>
        <PageHeader accent="Trust" title="& safety" subtitle="Reports, the safety queue, users and generated media." />
        {!ready || (session && !me) ? (
          <div className="mt-8 space-y-3" aria-busy="true" aria-label="Loading">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        ) : !me?.isAdmin ? (
          <div className="mt-8">
            <EmptyState
              icon={<AdminIcon className="h-7 w-7" />}
              title="Admins only"
              body="Sign in with an admin account to see reports and the safety queue."
              action={
                <ButtonLink href="/" variant="secondary">
                  Back to home
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <>
            <div
              className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
              role="tablist"
              aria-label="Admin sections"
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  id={`admin-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls="admin-panel"
                  className={cx(
                    "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:active:scale-100",
                    tab === item.id
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className="mt-6">
              {tab === "reports" ? <ReportsTab /> : null}
              {tab === "queue" ? (
                <QueueTab
                  onOpenUser={(id) => {
                    setUserQuery(id);
                    setTab("users");
                  }}
                />
              ) : null}
              {tab === "users" ? <UsersTab initialQuery={userQuery} /> : null}
              {tab === "media" ? <MediaTab /> : null}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}

function ListState({ loading, error, empty, onRetry }: { loading: boolean; error: string | null; empty: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">
        {error}{" "}
        <button type="button" className="font-semibold underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (loading && empty) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }
  return null;
}

/* Reports */

function ReportsTab() {
  const [view, setView] = useState<"open" | "resolved">("open");
  const list = useAdminList<AdminReportDTO>(`/api/admin/reports?status=${view}`, "reports");
  const reports = list.items ?? [];

  return (
    <div>
      <div className="flex items-center gap-2">
        {(["open", "resolved"] as const).map((option) => (
          <Chip key={option} active={view === option} onClick={() => setView(option)}>
            {option === "open" ? "Open" : "Resolved"}
          </Chip>
        ))}
        <button type="button" className={buttonClass("ghost", "md", "ml-auto")} onClick={() => void list.reload()}>
          Refresh
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <ListState loading={list.loading} error={list.error} empty={!list.items} onRetry={() => void list.reload()} />
        {list.items && !reports.length ? (
          <EmptyState title={view === "open" ? "No open reports" : "Nothing resolved yet"} />
        ) : null}
        {reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            onChange={(updated) => list.setItems((items) => (items ?? []).map((item) => (item.id === updated.id ? updated : item)))}
            onDone={(id) => list.setItems((items) => (items ?? []).filter((item) => item.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}

function ReportCard({
  report,
  onChange,
  onDone,
}: {
  report: AdminReportDTO;
  onChange: (report: AdminReportDTO) => void;
  onDone: (id: string) => void;
}) {
  const api = useApi();
  const [note, setNote] = useState("");
  const [preserve, setPreserve] = useState(report.preserveByDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banned, setBanned] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const open = report.status === "open";
  const urgent = report.kind === "csam" || report.kind === "ncii";
  const target = report.resolved;
  const ownerId = target?.ownerId ?? null;
  const official = target?.type === "character" && target.ownerId === null;
  const canTakeDown =
    target !== null && !(target.type === "character" && target.deleted) && !(target.type === "media" && target.status === "blocked");

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const resolve = (status: "actioned" | "dismissed") =>
    run(
      () => {
        if (!note.trim()) throw new Error("Add a note saying what you did.");
        return api("/api/admin/reports", { method: "PATCH", json: { id: report.id, status, resolution: note.trim() } });
      },
      () => onDone(report.id),
    );

  const takeDown = () => {
    // Deleting files a child may be in destroys evidence: make it a deliberate choice.
    if (
      !preserve &&
      report.preserveByDefault &&
      !window.confirm("Delete these files for good? Only do this if you're sure no child is involved.")
    ) {
      return;
    }
    // The card stays, closed, saying what was kept and what was deleted.
    return run(async () => {
      const result = await api<AdminTakedownResult>("/api/admin/reports/takedown", {
        method: "POST",
        // Keeping can't cover an official character's unflagged media here, so
        // the server's own default applies (it would keep more, never less).
        json: { id: report.id, kind: report.kind, note: note.trim(), preserve: report.preserveScope === "all" ? preserve : undefined },
      });
      setOutcome(takedownSummary(result));
      onChange({ ...report, status: "actioned", overdue: false, resolution: result.resolution, resolvedAt: new Date().toISOString() });
    });
  };

  const reclassify = () =>
    run(async () => {
      const body = await api<{ report: AdminReportDTO }>("/api/admin/reports", {
        method: "PATCH",
        json: { id: report.id, kind: "csam" },
      });
      setPreserve(true);
      onChange(body.report);
    });

  const banOwner = () =>
    run(
      () =>
        api("/api/admin/users", {
          method: "PATCH",
          json: { id: ownerId, banned: true, reason: `Report ${report.id} (${report.kind})` },
        }),
      () => setBanned(true),
    );

  return (
    <article
      className={cx(card, report.overdue ? "border-red-400/60 bg-red-500/10" : "border-[var(--line)] bg-[var(--surface)]")}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cx(pill, urgent ? "bg-red-500/20 text-red-200" : "bg-white/10 text-[var(--ink)]")}>
          {KIND_LABEL[report.kind]}
        </span>
        {open ? (
          <span className={report.overdue ? "font-medium text-red-300" : "text-[var(--muted)]"}>
            {dueIn(report.dueAt)} · {when(report.dueAt)}
          </span>
        ) : (
          <span className="text-[var(--muted)]">
            {report.status} {report.resolvedAt ? `· ${when(report.resolvedAt)}` : ""}
          </span>
        )}
        <span className="ml-auto text-[var(--muted)]">Filed {when(report.createdAt)}</span>
      </div>

      <p className="mt-3 break-all text-sm font-semibold text-[var(--ink)]">{report.target}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {target
          ? target.type === "media"
            ? `Media · ${target.kind} · ${target.status}${target.ownerId ? ` · owner ${target.ownerId}` : ""}`
            : `Character · ${target.name}${target.deleted ? " · already removed" : ""}${target.ownerId ? ` · owner ${target.ownerId}` : " · official"}`
          : "Couldn't match this to a media id or character. Find it by hand."}
      </p>
      {target?.type === "media" ? (
        <a
          href={`/api/media/${target.id}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs font-semibold !text-[var(--accent)] underline underline-offset-2"
        >
          View media
        </a>
      ) : null}

      {report.details ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{report.details}</p> : null}
      <p className="mt-2 text-xs text-[var(--muted)]">
        From {report.reporterEmail ?? "no email"}
        {report.reporterUserId ? ` · user ${report.reporterUserId}` : ""}
      </p>

      {report.minorFlagged && open ? (
        <p className="mt-3 text-xs text-red-300">
          Moderation or a report has tied this content, or media made from it, to a minor.
        </p>
      ) : null}

      {report.kind === "csam" && open ? (
        <p className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
          If this is apparent CSAM: take it down with the files kept, ban the owner, and file a CyberTipline report
          with NCMEC (report.cybertip.org) as soon as possible. Kept files are blocked and held for one year instead of
          being deleted, as federal law requires. Don&apos;t download or share them.
        </p>
      ) : null}

      {open ? (
        <div className="mt-4 space-y-3">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Resolution note: what you found and what you did"
            className={cx(input, "resize-y py-3 leading-6")}
          />
          {canTakeDown && report.preserveScope === "flagged" ? (
            <p className="text-xs leading-5 text-[var(--muted)]">
              <span className="text-[var(--ink)]">Official character: most of its files will be deleted.</span> Its
              photos, videos and voice notes belong to every user who chats with it. A takedown keeps only the ones
              moderation tied to a minor, under legal hold for one year, and deletes the rest. If a child might be
              involved, reclassify this report as CSAM first: then you can keep all of them.
            </p>
          ) : canTakeDown ? (
            <label className="flex items-start gap-2 text-xs leading-5 text-[var(--muted)]">
              <input
                type="checkbox"
                checked={preserve}
                onChange={(event) => setPreserve(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="text-[var(--ink)]">Keep the files under legal hold</span> (blocked, not deleted, for one
                year). Keep them whenever a child might be involved.
                {official
                  ? " For this official character that means every user's photos, videos and voice notes of it, and none of those users can delete their account until the hold ends. Unchecked, only the ones tied to a minor are kept."
                  : ""}
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {canTakeDown ? (
              <button type="button" disabled={busy} className={danger} onClick={() => void takeDown()}>
                Take down
              </button>
            ) : null}
            <button type="button" disabled={busy} className={primary} onClick={() => void resolve("actioned")}>
              Mark actioned
            </button>
            <button type="button" disabled={busy} className={ghost} onClick={() => void resolve("dismissed")}>
              Dismiss
            </button>
            {ownerId ? (
              <button type="button" disabled={busy || banned} className={ghost} onClick={() => void banOwner()}>
                {banned ? "Owner banned" : "Ban owner"}
              </button>
            ) : null}
            {report.kind !== "csam" ? (
              <button type="button" disabled={busy} className={ghost} onClick={() => void reclassify()}>
                Reclassify as CSAM
              </button>
            ) : null}
          </div>
        </div>
      ) : report.resolution ? (
        <p className="mt-3 text-sm text-[var(--ink)]">{report.resolution}</p>
      ) : null}
      {outcome ? (
        <Notice tone="info" role="status" className="mt-3">
          {outcome}
        </Notice>
      ) : null}
      {error ? (
        <Notice role="alert" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </article>
  );
}

/* Safety queue */

function QueueTab({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const api = useApi();
  const list = useAdminList<AdminModerationEventDTO>("/api/admin/moderation", "events");
  const events = list.items ?? [];
  const reviewable = events.filter((event) => event.category !== AGE_LOCK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markReviewed(ids: number[]) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<AdminReviewResult>("/api/admin/moderation", { method: "PATCH", json: { ids } });
      const done = ids.filter((id) => !result.skipped.includes(id));
      list.setItems((items) => (items ?? []).filter((item) => !done.includes(item.id)));
      if (result.note) setError(result.note);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--muted)]">
          Age-check locks, people saying they&apos;re under 18, then blocked and flagged events nobody has reviewed yet.
        </p>
        <button
          type="button"
          disabled={busy || !reviewable.length}
          className={`${ghost} ml-auto`}
          onClick={() => void markReviewed(reviewable.map((event) => event.id))}
        >
          Mark all shown as reviewed
        </button>
      </div>
      {error ? (
        <Notice role="alert" className="mt-3">
          {error}
        </Notice>
      ) : null}
      <div className="mt-4 space-y-3">
        <ListState loading={list.loading} error={list.error} empty={!list.items} onRetry={() => void list.reload()} />
        {list.items && !events.length ? <EmptyState title="Queue is clear" body="The queue is empty." /> : null}
        {events.map((event) => (
          <article key={event.id} className={cx(card, "border-[var(--line)] bg-[var(--surface)]")}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cx(pill, event.action === "blocked" ? "bg-red-500/20 text-red-200" : "bg-[var(--accent-soft)] text-[var(--accent)]")}
              >
                {event.action}
              </span>
              <span className={cx(pill, "bg-white/10 text-[var(--ink)]")}>{event.category}</span>
              <span className="text-[var(--muted)]">
                {event.targetType}
                {event.targetId ? ` · ${event.targetId}` : ""}
              </span>
              <span className="ml-auto text-[var(--muted)]">{when(event.createdAt)}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {event.userId ? `${event.userName ?? "Unknown"} · ${event.userId}` : "No user"}
            </p>
            {event.details ? (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">
                {JSON.stringify(event.details, null, 2)}
              </pre>
            ) : null}
            {event.category === AGE_LOCK ? (
              <p className="mt-3 text-xs leading-5 text-red-200">
                The account is banned and locked for age review. Check the user, then close this by unbanning them in
                the Users tab; they&apos;ll have to verify their age again. Leave them banned if they&apos;re a minor.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {event.category === AGE_LOCK ? (
                event.userId ? (
                  <button type="button" className={ghost} onClick={() => onOpenUser(event.userId!)}>
                    Open in Users
                  </button>
                ) : null
              ) : (
                <button type="button" disabled={busy} className={ghost} onClick={() => void markReviewed([event.id])}>
                  Mark reviewed
                </button>
              )}
              {(event.targetType === "image" || event.targetType === "video") && event.targetId ? (
                <a href={`/api/media/${event.targetId}`} target="_blank" rel="noreferrer" className={ghost}>
                  View media
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* Users */

function UsersTab({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  // Accounts whose explicit content is on hold because they said they're under 18.
  const [holdsOnly, setHoldsOnly] = useState(false);
  const list = useAdminList<AdminUserDTO>(
    `/api/admin/users?q=${encodeURIComponent(submitted)}${holdsOnly ? "&hold=1" : ""}`,
    "users",
  );
  const users = list.items ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip active={!holdsOnly} onClick={() => setHoldsOnly(false)}>
          All users
        </Chip>
        <Chip active={holdsOnly} onClick={() => setHoldsOnly(true)}>
          On explicit hold
        </Chip>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="User id, login id or display name"
          className={cx(input, "h-10")}
        />
        <button type="submit" className={primary}>
          Search
        </button>
      </form>
      <div className="mt-4 space-y-3">
        <ListState loading={list.loading} error={list.error} empty={!list.items} onRetry={() => void list.reload()} />
        {list.items && !users.length ? (
          <EmptyState title={holdsOnly ? "No accounts on an explicit hold" : "No users match"} />
        ) : null}
        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            onChange={(updated) => list.setItems((items) => (items ?? []).map((item) => (item.id === updated.id ? updated : item)))}
          />
        ))}
      </div>
    </div>
  );
}

function UserRow({ user, onChange }: { user: AdminUserDTO; onChange: (user: AdminUserDTO) => void }) {
  const api = useApi();
  const { me } = useSession();
  const [reason, setReason] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearHold() {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ user: AdminUserDTO }>("/api/admin/users", {
        method: "PATCH",
        json: { id: user.id, explicitHold: false, reason: holdReason.trim() },
      });
      onChange(body.user);
      setHoldReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setBan(banned: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ user: AdminUserDTO }>("/api/admin/users", {
        method: "PATCH",
        json: { id: user.id, banned, reason: reason.trim() },
      });
      onChange(body.user);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={cx(card, user.bannedAt ? "border-red-400/40 bg-red-500/5" : "border-[var(--line)] bg-[var(--surface)]")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-[var(--ink)]">{user.displayName}</p>
        {user.isAdmin ? <span className={cx(pill, "bg-[var(--accent-soft)] text-[var(--accent)]")}>admin</span> : null}
        {user.bannedAt ? <span className={cx(pill, "bg-red-500/20 text-red-200")}>banned {when(user.bannedAt)}</span> : null}
        {user.ageLocked ? <span className={cx(pill, "bg-red-500/20 text-red-200")}>age check: under 18</span> : null}
        {user.explicitHoldAt ? (
          <span className={cx(pill, "bg-sky-400/15 text-sky-200")}>explicit hold {when(user.explicitHoldAt)}</span>
        ) : null}
      </div>
      <p className="mt-1 break-all text-xs text-[var(--muted)]">
        {user.id} · {user.privyId}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        ID check: {user.ageStatus} · age confirmed: {user.ageAttestedAt ? when(user.ageAttestedAt) : "no"} ·{" "}
        {user.balance.toLocaleString()} credits · joined {when(user.createdAt)} · last seen {when(user.lastSeenAt)}
      </p>
      {user.explicitHoldAt ? (
        <div className="mt-3 rounded-xl border border-sky-400/30 bg-sky-400/[0.06] p-3">
          <p className="text-xs leading-5 text-sky-100">
            They said they&apos;re under 18, in chat or when confirming their age, so explicit content is off. Read the
            safety queue and their chats first. Clear the hold only if you&apos;re satisfied they&apos;re an adult; if
            they&apos;re a minor, keep it and ban the account.
          </p>
          {user.id !== me?.id ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                placeholder="Why it's safe to clear (kept in the audit log)"
                maxLength={500}
                className={cx(input, "h-10 sm:max-w-sm")}
              />
              <button type="button" disabled={busy || !holdReason.trim()} className={ghost} onClick={() => void clearHold()}>
                Clear hold
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {user.ageLocked ? (
        <p className="mt-2 text-xs leading-5 text-red-200">
          An age check read a birth date under 18. Unbanning is the review: it closes the finding, and they have to
          verify their age again. Keep the ban if they&apos;re a minor.
        </p>
      ) : null}
      {user.id !== me?.id ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {user.bannedAt ? (
            <button type="button" disabled={busy} className={ghost} onClick={() => void setBan(false)}>
              Unban
            </button>
          ) : user.isAdmin ? null : (
            <>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason (kept in the audit log)"
                maxLength={500}
                className={cx(input, "h-10 sm:max-w-sm")}
              />
              <button type="button" disabled={busy} className={danger} onClick={() => void setBan(true)}>
                Ban
              </button>
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <Notice role="alert" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </article>
  );
}

/* Media */

function MediaTab() {
  const [status, setStatus] = useState<"" | "blocked" | "ready" | "failed" | "pending">("");
  const list = useAdminList<AdminMediaDTO>(`/api/admin/media${status ? `?status=${status}` : ""}`, "media");
  const media = list.items ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {(["", "blocked", "ready", "failed", "pending"] as const).map((option) => (
          <Chip key={option || "all"} active={status === option} className="capitalize" onClick={() => setStatus(option)}>
            {option || "All"}
          </Chip>
        ))}
        <button type="button" className={buttonClass("ghost", "md", "ml-auto")} onClick={() => void list.reload()}>
          Refresh
        </button>
      </div>
      <div className="mt-4">
        <ListState loading={list.loading} error={list.error} empty={!list.items} onRetry={() => void list.reload()} />
        {list.items && !media.length ? <EmptyState title="No generated media yet" /> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
              <MediaThumb item={item} />
              <div className="p-4 text-xs text-[var(--muted)]">
                <p className="font-semibold text-[var(--ink)]">
                  {item.kind} · {item.purpose} ·{" "}
                  <span className={item.status === "blocked" ? "text-red-300" : ""}>{item.status}</span>
                </p>
                <p className="mt-1 break-all">
                  {item.userName ?? "No user"} {item.userId ? `· ${item.userId}` : ""}
                </p>
                <p className="mt-1">{when(item.createdAt)}</p>
                {item.prompt ? <p className="mt-2 line-clamp-3">{item.prompt}</p> : null}
                {item.moderation ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[var(--ink)]">Moderation result</summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--bg)] p-2">
                      {JSON.stringify(item.moderation, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <p className="mt-2">No moderation result recorded.</p>
                )}
                <p className="mt-2 break-all">id {item.id}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

// Blurred until clicked, so reviewers choose when to look.
function MediaThumb({ item }: { item: AdminMediaDTO }) {
  const [shown, setShown] = useState(false);
  if (item.status !== "ready") {
    return (
      <div className="flex aspect-[3/4] items-center justify-center bg-black/30">
        <span className="px-4 text-center text-xs text-[var(--muted)]">
          {item.status}
          {item.error ? ` · ${item.error}` : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="relative aspect-[3/4] overflow-hidden bg-black/30">
      {item.kind === "video" ? (
        <video
          src={item.url}
          controls={shown}
          preload="none"
          className={`h-full w-full object-cover ${shown ? "" : "blur-2xl"}`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt="" loading="lazy" className={`h-full w-full object-cover ${shown ? "" : "blur-2xl"}`} />
      )}
      {shown ? null : (
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center bg-black/30"
          onClick={() => setShown(true)}
        >
          <span className={buttonClass("secondary", "sm", "pointer-events-none")}>Show {item.kind}</span>
        </button>
      )}
    </div>
  );
}
