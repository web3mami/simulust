import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const visit = (headers: Record<string, string>, path = "/api/me") =>
  proxy(new NextRequest(`http://localhost${path}`, { headers }));

describe("region block", () => {
  it("blocks by the platform's country header", async () => {
    expect(visit({ "x-vercel-ip-country": "IR" }).status).toBe(451);
    expect(visit({ "x-vercel-ip-country": "ir" }, "/").status).toBe(451);
    expect(visit({ "x-vercel-ip-country": "US" }).status).toBe(200);
  });

  it("ignores country headers a client can set itself", async () => {
    expect(visit({ "x-vercel-ip-country": "IR", "cf-ipcountry": "US" }).status).toBe(451);
    expect(visit({ "x-vercel-ip-country": "IR", "cf-ipcountry": "" }).status).toBe(451);
  });

  it("blocks no state or province by default", async () => {
    expect(visit({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "TX" }).status).toBe(200);
  });
});

// Env is read at import, so each case loads the proxy afresh.
async function proxyWith(overrides: Record<string, string>) {
  for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value);
  vi.resetModules();
  const { proxy: fresh } = await import("@/proxy");
  return (headers: Record<string, string>, path = "/api/me") =>
    fresh(new NextRequest(`http://localhost${path}`, { headers }));
}

describe("BLOCKED_REGIONS", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks a listed state with 451, as a blocked country is", async () => {
    const regionVisit = await proxyWith({ BLOCKED_REGIONS: "US-TX,US-UT" });
    const api = regionVisit({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "TX" });
    expect(api.status).toBe(451);
    expect(await api.json()).toMatchObject({ code: "region_blocked" });
    const page = regionVisit({ "x-vercel-ip-country": "us", "x-vercel-ip-country-region": "ut" }, "/");
    expect(page.status).toBe(451);
    expect(page.headers.get("content-type")).toContain("text/html");
    // Countries are still blocked too.
    expect(regionVisit({ "x-vercel-ip-country": "IR" }).status).toBe(451);
  });

  it("lets other states, and the same code in another country, through", async () => {
    const regionVisit = await proxyWith({ BLOCKED_REGIONS: "US-TX" });
    expect(regionVisit({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "CA" }).status).toBe(200);
    expect(regionVisit({ "x-vercel-ip-country": "MX", "x-vercel-ip-country-region": "TX" }).status).toBe(200);
    expect(regionVisit({ "x-vercel-ip-country": "US" }).status).toBe(200);
    // A region with no country to pair it with matches nothing.
    expect(regionVisit({ "x-vercel-ip-country-region": "TX" }).status).toBe(200);
  });

  it("accepts a full country-region code in the header", async () => {
    const regionVisit = await proxyWith({ BLOCKED_REGIONS: "US-TX" });
    expect(regionVisit({ "x-vercel-ip-country-region": "US-TX" }).status).toBe(451);
  });

  it("reads only the configured region header", async () => {
    const vercel = await proxyWith({ BLOCKED_REGIONS: "US-TX" });
    // Headers the client could set itself are ignored.
    expect(vercel({ "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "CA", "cf-region-code": "TX" }).status).toBe(200);
    expect(vercel({ "x-vercel-ip-country": "US", "x-region": "TX" }).status).toBe(200);

    const cloudflare = await proxyWith({
      BLOCKED_REGIONS: "US-TX",
      GEO_COUNTRY_HEADER: "cf-ipcountry",
      GEO_REGION_HEADER: "cf-region-code",
    });
    expect(cloudflare({ "cf-ipcountry": "US", "cf-region-code": "TX" }).status).toBe(451);
    expect(cloudflare({ "cf-ipcountry": "US", "cf-region-code": "CA", "x-vercel-ip-country-region": "TX" }).status).toBe(200);
  });
});

describe("cross-site requests", () => {
  const send = (method: string, path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: "localhost:3000", ...headers } }));

  it("refuses an API change sent from another site", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const response = send(method, "/api/me", { origin: "https://evil.example" });
      expect(response.status, method).toBe(403);
      expect(await response.json()).toMatchObject({ code: "cross_site" });
    }
    // An opaque origin (a sandboxed frame, a data: page) is another site too.
    expect(send("POST", "/api/auth/login", { origin: "null" }).status).toBe(403);
    // The same host on another port is another origin.
    expect(send("POST", "/api/auth/login", { origin: "http://localhost:4000" }).status).toBe(403);
  });

  it("lets the app's own pages through", () => {
    expect(send("POST", "/api/auth/login", { origin: "http://localhost:3000" }).status).toBe(200);
    // Behind a proxy that forwards the public host.
    expect(
      send("POST", "/api/auth/signup", { origin: "https://simulust.example", "x-forwarded-host": "simulust.example" }).status,
    ).toBe(200);
  });

  it("lets reads and requests without an Origin through", () => {
    expect(send("GET", "/api/me", { origin: "https://evil.example" }).status).toBe(200);
    expect(send("OPTIONS", "/api/me", { origin: "https://evil.example" }).status).toBe(200);
    // Server-to-server: the cron, and webhooks (which the matcher leaves out anyway).
    expect(send("POST", "/api/cron/reconcile", { authorization: "Bearer cron" }).status).toBe(200);
    expect(send("POST", "/api/webhooks/helius").status).toBe(200);
  });

  it("leaves pages alone", () => {
    expect(send("POST", "/date/mira", { origin: "https://evil.example" }).status).toBe(200);
  });

  it("lets wallets post the Solana Pay transaction request from their own origin", async () => {
    // It takes no auth and reads no cookies, so there's no session to forge.
    for (const origin of ["https://phantom.app", "chrome-extension://bfnaelmomeimhlpmgjnjophhpkkoljpa", "null"]) {
      expect(send("POST", "/api/orders/3f0c2a4e-order/transaction", { origin }).status, origin).toBe(200);
    }
    expect(send("OPTIONS", "/api/orders/3f0c2a4e-order/transaction", { origin: "https://phantom.app" }).status).toBe(200);
    // Only that exact route: the order itself and anything below it stay guarded.
    for (const path of [
      "/api/orders/3f0c2a4e-order",
      "/api/orders/3f0c2a4e-order/dev-settle",
      "/api/orders/3f0c2a4e-order/transaction/x",
      "/api/orders/a/b/transaction",
      "/api/orders",
    ]) {
      const response = send("POST", path, { origin: "https://phantom.app" });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ code: "cross_site" });
    }
    // A blocked region is still blocked there.
    expect(send("POST", "/api/orders/3f0c2a4e-order/transaction", { "x-vercel-ip-country": "IR" }).status).toBe(451);
  });
});
