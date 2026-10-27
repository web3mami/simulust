import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { moderationEvents, reports, type User } from "@/server/db/schema";
import { HttpError, notFound, readJson, route } from "@/server/http";
import { clearCsamSignals, eventTargetType, preserveDefaults, requireAdminUser, resolveTarget } from "../_lib/server";
import type { AdminReportDTO } from "../_lib/types";

type ReportRow = typeof reports.$inferSelect;

const closed = () => new HttpError(409, "That report is already closed. Reload to see the latest.", "already_resolved");

async function toDTOs(rows: ReportRow[], now: Date): Promise<AdminReportDTO[]> {
  const targets = await Promise.all(rows.map((row) => resolveTarget(row.target).catch(() => null)));
  const defaults = await preserveDefaults(rows.map((row, i) => ({ kind: row.kind, target: targets[i] })));
  return rows.map((row, i) => ({
    id: row.id,
    kind: row.kind,
    target: row.target,
    resolved: targets[i],
    minorFlagged: defaults[i].minorFlagged,
    preserveByDefault: defaults[i].preserve,
    preserveScope: defaults[i].scope,
    details: row.details,
    reporterEmail: row.reporterEmail,
    reporterUserId: row.reporterUserId,
    status: row.status,
    dueAt: row.dueAt.toISOString(),
    overdue: row.status === "open" && row.dueAt < now,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
  }));
}

// Child abuse and intimate-image reports come first, so a pile of other reports
// can never push them out of the list.
const URGENCY = sql`case ${reports.kind} when 'csam' then 0 when 'ncii' then 1 else 2 end`;

// Open reports, most urgent kind first, then soonest due. ?status=resolved
// lists recent decisions.
export const GET = route(async (request: Request) => {
  await requireAdminUser(request);
  const resolved = new URL(request.url).searchParams.get("status") === "resolved";
  const database = await db();
  const rows = resolved
    ? await database.select().from(reports).where(ne(reports.status, "open")).orderBy(desc(reports.resolvedAt)).limit(100)
    : await database.select().from(reports).where(eq(reports.status, "open")).orderBy(URGENCY, asc(reports.dueAt)).limit(200);
  return Response.json({ reports: await toDTOs(rows, new Date()) });
});

const resolve = z.object({
  id: z.uuid(),
  status: z.enum(["actioned", "dismissed"]),
  resolution: z.string().trim().min(1, "Add a note saying what you did.").max(2000),
});

// Only ever towards CSAM: that moves the report to the top of the queue and
// makes its takedown keep the files.
const reclassify = z.object({ id: z.uuid(), kind: z.literal("csam", { error: "Reports can only be reclassified as CSAM." }) });

async function reclassifyAsCsam(admin: User, id: string): Promise<ReportRow> {
  const database = await db();
  const [report] = await database.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!report) throw notFound("That report doesn't exist.");
  if (report.status !== "open") throw closed();
  if (report.kind === "csam") return report;

  const target = await resolveTarget(report.target).catch(() => null);
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({ kind: "csam" })
      .where(and(eq(reports.id, id), eq(reports.status, "open")))
      .returning();
    if (!row) throw closed();
    // The same trail a CSAM report from the public leaves, so later reports on
    // this target default to keeping its files too.
    await tx.insert(moderationEvents).values({
      userId: report.reporterUserId,
      targetType: eventTargetType(target),
      targetId: target?.id ?? null,
      category: "report_csam",
      action: "escalated",
      details: { reportId: id, reclassifiedFrom: report.kind, adminId: admin.id },
    });
    return row;
  });
}

// Resolves a report ({ id, status, resolution }), or reclassifies an open one
// as CSAM ({ id, kind: "csam" }).
export const PATCH = route(async (request: Request) => {
  const admin = await requireAdminUser(request);
  const raw = await readJson(request, z.looseObject({}));
  if ("kind" in raw) {
    const { id } = reclassify.parse(raw);
    const [report] = await toDTOs([await reclassifyAsCsam(admin, id)], new Date());
    return Response.json({ report });
  }

  const input = resolve.parse(raw);
  const database = await db();
  const [row] = await database
    .update(reports)
    .set({ status: input.status, resolution: input.resolution, resolvedAt: new Date(), resolvedBy: admin.id })
    .where(and(eq(reports.id, input.id), eq(reports.status, "open")))
    .returning();
  if (!row) throw closed();
  if (row.status === "dismissed") await clearCsamSignals(row.id);
  const [report] = await toDTOs([row], new Date());
  return Response.json({ report });
});
