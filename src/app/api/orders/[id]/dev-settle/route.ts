import { requireUser } from "@/server/auth";
import { isProduction } from "@/server/env";
import { HttpError, notFound, route } from "@/server/http";
import { awaitingPayment, findOrder, requireOwnOrder, toOrderDTO } from "@/server/solana/orders";
import { settle } from "@/server/solana/settle";

type Ctx = { params: Promise<{ id: string }> };

// Development only: settles an order with a made-up signature so the checkout,
// credit grant and membership can be tried without a wallet. Settled straight to
// finalized so the reconcile job never looks the fake signature up on chain.
export const POST = route(async (request: Request, ctx: Ctx) => {
  if (isProduction) throw notFound();
  const { id } = await ctx.params;
  const user = await requireUser(request);
  const order = await requireOwnOrder(user, id);
  if (order.status !== "pending" && order.status !== "expired") {
    throw new HttpError(409, `This order is already ${order.status}.`, "not_payable");
  }
  const payer = user.walletAddress ?? "dev-wallet";
  await settle(
    order.id,
    {
      signature: `dev-${crypto.randomUUID()}`,
      payer,
      payers: [payer],
      received: order.amount,
      accounts: [order.reference],
      commitment: "finalized",
      paidAt: null,
    },
    { screen: async () => ({ blocked: false, source: "dev" }) },
  );
  const updated = (await findOrder(order.id)) ?? order;
  return Response.json({ order: toOrderDTO(updated, user), watching: awaitingPayment(updated) });
});
