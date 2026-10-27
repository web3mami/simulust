import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { balanceOf } from "@/server/credits";
import { db } from "@/server/db";
import { creditLedger } from "@/server/db/schema";
import { route } from "@/server/http";
import type { LedgerEntryDTO } from "@/lib/api-types";

export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  const database = await db();
  const rows = await database
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(50);
  const ledger: LedgerEntryDTO[] = rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));
  return Response.json({ balance: await balanceOf(user.id), ledger });
});
