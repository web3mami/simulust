import { requireUser } from "@/server/auth";
import { HttpError, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { awaitingPayment, findOrder, requireOwnOrder, toOrderDTO } from "@/server/solana/orders";
import { syncOrder } from "@/server/solana/reconcile";

// Same shape as RouteContext<"/api/orders/[id]">, spelled out so it typechecks
// before `next typegen` has seen this route.
type Ctx = { params: Promise<{ id: string }> };

// The checkout polls this every two seconds. Each poll may look at the chain,
// but chain lookups are capped so a stuck tab can't burn our RPC quota.
async function mayCheckChain(orderId: string, userId: string) {
  try {
    await rateLimit(`orders:check:${orderId}`, 20, 60);
    await rateLimit(`orders:check-user:${userId}`, 60, 60);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) return false;
    throw error;
  }
}

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser(request);
  let order = await requireOwnOrder(user, id);

  // Covers the open window, a stale checkout that should now read as expired,
  // the hour after it closed, and a payment waiting on screening. Each check
  // reads only a few transactions, and remembers the ones that pay nothing.
  if (awaitingPayment(order) && (await mayCheckChain(order.id, user.id))) {
    try {
      if (await syncOrder(order)) order = (await findOrder(order.id)) ?? order;
    } catch (error) {
      // A slow RPC shouldn't break the checkout; the next poll retries.
      console.error(`Order check failed for ${order.id}`, error);
    }
  }
  // watching: a payment could still be credited, so the checkout keeps polling.
  return Response.json({ order: toOrderDTO(order, user), watching: awaitingPayment(order) });
});
