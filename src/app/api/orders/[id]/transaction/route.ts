import { z } from "zod";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { findOrder, ownerOf, payable } from "@/server/solana/orders";
import { buildPaymentTransaction, transactionRequestLabel } from "@/server/solana/transaction";
import { MIN_REMAINING_MS } from "@/lib/checkout";

// Solana Pay transaction request. Wallets call this directly, without our auth,
// so the unguessable order id in the path is the only capability: it builds a
// transaction that pays us, and only for an open order.
type Ctx = { params: Promise<{ id: string }> };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function respond(work: () => Promise<Response>) {
  let response: Response;
  try {
    response = await work();
  } catch (error) {
    const base = errorResponse(error);
    // Solana Pay wallets read `message` from error bodies; our clients read `error`.
    const body = (await base.json()) as { error: string; code?: string };
    response = Response.json({ ...body, message: body.error }, { status: base.status });
  }
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function openOrder(id: string) {
  const order = await findOrder(id);
  if (!order) throw new HttpError(404, "This checkout doesn't exist.", "not_found");
  // A blockhash lives for about a minute; don't hand out a transaction that
  // would land after the order closes.
  if (!payable(order, await ownerOf(order), Date.now() + MIN_REMAINING_MS)) {
    throw new HttpError(410, "This checkout has closed. Start a new one in Simulust.", "order_closed");
  }
  return order;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export const GET = (_request: Request, ctx: Ctx) =>
  respond(async () => {
    const { id } = await ctx.params;
    await openOrder(id);
    return Response.json(transactionRequestLabel());
  });

const body = z.object({ account: z.string().trim().min(32).max(44) });

export const POST = (request: Request, ctx: Ctx) =>
  respond(async () => {
    const { id } = await ctx.params;
    const { account } = await readJson(request, body);
    const order = await openOrder(id);
    // Building a transaction costs RPC calls, and sponsored fees cost us SOL.
    await rateLimit(`orders:tx:${order.id}`, 20, 10 * 60);
    return Response.json(await buildPaymentTransaction(order, account));
  });
