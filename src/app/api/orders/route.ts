import { z } from "zod";
import { requireUser } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { createOrder, listOrders, toOrderDTO } from "@/server/solana/orders";
import { ALL_PRODUCTS, type ProductId } from "@/lib/pricing";

const body = z.object({
  productId: z.enum(ALL_PRODUCTS.map((product) => product.id) as [ProductId, ...ProductId[]]),
  currency: z.enum(["USDC", "SOL"]),
});

export const POST = route(async (request: Request) => {
  const user = await requireUser(request);
  const input = await readJson(request, body);
  await rateLimit(`orders:create:${user.id}`, 20, 60 * 60);
  const order = await createOrder(user, input.productId, input.currency);
  return Response.json({ order: toOrderDTO(order, user) });
});

export const GET = route(async (request: Request) => {
  const user = await requireUser(request);
  const orders = await listOrders(user.id);
  return Response.json({ orders: orders.map((order) => toOrderDTO(order, user)) });
});
