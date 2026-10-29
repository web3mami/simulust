import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, decodeProtectedHeader, importSPKI, jwtVerify, type JSONWebKeySet } from "jose";
import { currentUser } from "@/server/auth";

type Handler = (request: Request) => Promise<Response>;

// Env is read at import, so each case loads the routes afresh.
async function routes(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const { GET: token } = (await import("./route")) as { GET: Handler };
  const { GET: jwks } = (await import("../jwks/route")) as { GET: Handler };
  return { token, jwks };
}

const as = (handle: string | null) =>
  new Request("http://localhost/api/auth/wallet-token", { headers: handle ? { "x-dev-user": handle } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/auth/wallet-token and /api/auth/jwks", () => {
  it("don't exist without Privy", async () => {
    const { token, jwks } = await routes({ NEXT_PUBLIC_PRIVY_APP_ID: "", AUTH_JWT_PRIVATE_KEY: "" });
    expect((await token(as("wallet-none"))).status).toBe(404);
    expect((await jwks(as(null))).status).toBe(404);
  });

  it("need a signed-in account", async () => {
    const { token } = await routes({ NEXT_PUBLIC_PRIVY_APP_ID: "privy-app" });
    expect((await token(as(null))).status).toBe(401);
  });

  it("sign a 10-minute token for the account that the JWKS verifies, with a development key", async () => {
    const { token, jwks } = await routes({ NEXT_PUBLIC_PRIVY_APP_ID: "privy-app", AUTH_JWT_PRIVATE_KEY: "" });
    const user = (await currentUser(as("wallet-dev")))!;
    const response = await token(as("wallet-dev"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { token: jwt } = (await response.json()) as { token: string };

    const keysResponse = await jwks(as(null));
    expect(keysResponse.headers.get("cache-control")).toBe("public, max-age=300");
    const keys = (await keysResponse.json()) as JSONWebKeySet;
    expect(keys.keys).toHaveLength(1);
    expect(keys.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig", kid: expect.any(String) });
    // The public half only.
    expect(keys.keys[0]).not.toHaveProperty("d");

    const { payload, protectedHeader } = await jwtVerify(jwt, createLocalJWKSet(keys), {
      issuer: "simulust",
      audience: "privy-app",
      algorithms: ["ES256"],
    });
    expect(protectedHeader.kid).toBe(keys.keys[0].kid);
    expect(payload.sub).toBe(user.id);
    expect(payload.exp! - payload.iat!).toBe(600);

    // The same development key for the life of the process.
    const again = await routes({ NEXT_PUBLIC_PRIVY_APP_ID: "privy-app", AUTH_JWT_PRIVATE_KEY: "" });
    const sameKeys = (await (await again.jwks(as(null))).json()) as JSONWebKeySet;
    expect(sameKeys.keys[0].kid).toBe(keys.keys[0].kid);
  });

  it("sign with AUTH_JWT_PRIVATE_KEY when it's set, written with \\n escapes", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const { token, jwks } = await routes({
      NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
      AUTH_JWT_PRIVATE_KEY: pem.trim().replace(/\n/g, "\\n"),
    });
    const user = (await currentUser(as("wallet-configured")))!;
    const { token: jwt } = (await (await token(as("wallet-configured"))).json()) as { token: string };

    const spki = publicKey.export({ type: "spki", format: "pem" }).toString();
    const { payload } = await jwtVerify(jwt, await importSPKI(spki, "ES256"), { issuer: "simulust", audience: "privy-app" });
    expect(payload.sub).toBe(user.id);
    const keys = (await (await jwks(as(null))).json()) as JSONWebKeySet;
    expect(decodeProtectedHeader(jwt).kid).toBe(keys.keys[0].kid);
  });
});
