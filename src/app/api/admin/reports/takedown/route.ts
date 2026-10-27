import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { HttpError, notFound, readJson, route } from "@/server/http";
import { clearCsamSignals, preserveDefaults, requireAdminUser, resolveTarget, takeDown } from "../../_lib/server";
import type { AdminTakedownResult } from "../../_lib/types";

const body = z.object({
  id: z.uuid(),
  note: z.string().trim().max(2000).default(""),
  // Keep the files under a legal hold instead of deleting them. Left out, it
  // follows the report's default (see preserveDefaults).
  preserve: z.boolean().optional(),
  // The kind the admin was looking at. If the report has been reclassified
  // since, nothing is taken down so they can choose again.
  kind: z.enum(["ncii", "csam", "real_person", "copyright", "other"]).optional(),
});

const closed = () => new HttpError(409, "That report is already closed.", "already_resolved");

// Removes the media or character a report points at and closes the report as
// actioned.
export const POST = route(async (request: Request) => {
  const admin = await requireAdminUser(request);
  const { id, note, preserve, kind } = await readJson(request, body);
  const database = await db();
  const [report] = await database.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!report) throw notFound("That report doesn't exist.");
  if (report.status !== "open") throw closed();

  const target = await resolveTarget(report.target);
  if (!target) {
    throw new HttpError(
      422,
      "This report doesn't point to a media id or character we can find. Remove the content by hand, then mark the report actioned.",
      "target_unknown",
    );
  }

  // Claimed before any file is touched. A reclassification or dismissal racing
  // this takedown either lands first, and its kind decides what's kept, or
  // finds the report closed.
  const [claimed] = await database
    .update(reports)
    .set({ status: "actioned", resolution: "Takedown in progress.", resolvedAt: new Date(), resolvedBy: admin.id })
    .where(and(eq(reports.id, id), eq(reports.status, "open"), kind ? eq(reports.kind, kind) : undefined))
    .returning();
  if (!claimed) {
    const [current] = await database.select({ status: reports.status }).from(reports).where(eq(reports.id, id)).limit(1);
    if (current?.status !== "open") throw closed();
    throw new HttpError(
      409,
      "This report was reclassified while you had it open. Reload it and check whether to keep the files.",
      "report_changed",
    );
  }

  const keep = preserve ?? (await preserveDefaults([{ kind: claimed.kind, target }]))[0].preserve;
  let done;
  try {
    done = await takeDown(target, { reportId: claimed.id, adminId: admin.id, preserve: keep, kind: claimed.kind });
  } catch (error) {
    // Open again for another try; whatever was already removed stays removed.
    await database
      .update(reports)
      .set({ status: "open", resolution: null, resolvedAt: null, resolvedBy: null })
      .where(eq(reports.id, claimed.id));
    throw error;
  }
  // Deleting the files is the admin's call that no child is involved.
  if (!keep) await clearCsamSignals(claimed.id);
  const resolution = note ? `${done.note} ${note}` : done.note;
  await database.update(reports).set({ resolution, resolvedAt: new Date() }).where(eq(reports.id, claimed.id));
  const result: AdminTakedownResult = {
    ok: true,
    resolution,
    // Whether every file it covered was kept, not just whether that was asked for.
    preserved: done.deleted === 0 && (keep || done.held > 0),
    held: done.held,
    deleted: done.deleted,
  };
  return Response.json(result);
});
