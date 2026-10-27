import { describe, expect, it } from "vitest";
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
});
