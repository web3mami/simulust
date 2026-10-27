// Shapes returned by /api/admin/*, shared with the admin console.

export type ReportKind = "ncii" | "csam" | "real_person" | "copyright" | "other";

export type ReportTarget =
  | {
      type: "media";
      id: string;
      kind: "image" | "audio" | "video";
      status: "pending" | "ready" | "failed" | "blocked";
      ownerId: string | null;
    }
  | { type: "character"; id: string; name: string; ownerId: string | null; deleted: boolean };

export type AdminReportDTO = {
  id: string;
  kind: ReportKind;
  target: string;
  resolved: ReportTarget | null;
  // Moderation has tied the target (or media made from it) to a minor.
  minorFlagged: boolean;
  // What a takedown does with the files when the admin doesn't say: keep them
  // under legal hold (true) or delete them.
  preserveByDefault: boolean;
  // What keeping the files covers. "all": the item and its copies, or all of a
  // character's media. "flagged": an official character with no child-abuse
  // report or minor signal on the character itself, whose takedown keeps only
  // the media tied to a minor and deletes the rest of every user's media of it
  // whatever the admin chooses. Reclassifying the report as CSAM makes it "all".
  preserveScope: "all" | "flagged";
  details: string;
  reporterEmail: string | null;
  reporterUserId: string | null;
  status: "open" | "actioned" | "dismissed";
  dueAt: string;
  overdue: boolean;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string;
};

// POST /api/admin/reports/takedown. held and deleted count the media items
// kept under legal hold and those blocked with their files deleted; preserved is
// true only when nothing was deleted.
export type AdminTakedownResult = { ok: true; resolution: string; preserved: boolean; held: number; deleted: number };

export type AdminModerationEventDTO = {
  id: number;
  userId: string | null;
  userName: string | null;
  targetType: string;
  targetId: string | null;
  category: string;
  action: "blocked" | "flagged" | "allowed" | "escalated";
  details: Record<string, unknown> | null;
  reviewedAt: string | null;
  createdAt: string;
};

// PATCH /api/admin/moderation. Age-check findings in the request are skipped:
// they close only through the user's unban.
export type AdminReviewResult = { ok: true; reviewed: number; skipped: number[]; note?: string };

export type AdminUserDTO = {
  id: string;
  displayName: string;
  privyId: string;
  isAdmin: boolean;
  ageStatus: "none" | "pending" | "approved" | "declined";
  bannedAt: string | null;
  // Banned by an age check that read an under-18 birth date; the unban is its review.
  ageLocked: boolean;
  balance: number;
  createdAt: string;
  lastSeenAt: string;
};

export type AdminMediaDTO = {
  id: string;
  userId: string | null;
  userName: string | null;
  characterId: string | null;
  kind: "image" | "audio" | "video";
  purpose: string;
  status: "pending" | "ready" | "failed" | "blocked";
  prompt: string | null;
  moderation: Record<string, unknown> | null;
  error: string | null;
  url: string;
  createdAt: string;
};
