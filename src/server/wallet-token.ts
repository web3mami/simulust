import "server-only";
import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { calculateJwkThumbprint, exportJWK, SignJWT, type JWK } from "jose";
import { env, isProduction, p256PrivateKey } from "@/server/env";

// Privy has no username and password login of its own, so it trusts ours: the
// browser asks for a short-lived ES256 JWT naming the account (sub = users.id)
// and hands it to Privy (JWT-based auth), which checks it against
// /api/auth/jwks and gives the account its embedded Solana wallet.
export const WALLET_TOKEN_ISSUER = "simulust";
const LIFETIME = "10m";

type SigningKey = { privateKey: KeyObject; publicJwk: JWK & { kid: string } };

let configured: Promise<SigningKey> | undefined;
// Development without AUTH_JWT_PRIVATE_KEY signs with a key made once per
// process, kept across hot reloads so tokens and the JWKS keep matching.
const ephemeral = globalThis as { __simulustWalletKey?: Promise<SigningKey> };

async function withPublicJwk(privateKey: KeyObject): Promise<SigningKey> {
  const jwk = await exportJWK(createPublicKey(privateKey));
  const kid = await calculateJwkThumbprint(jwk);
  return { privateKey, publicJwk: { ...jwk, kid, alg: "ES256", use: "sig" } };
}

function signingKey(): Promise<SigningKey> {
  if (env.authJwtPrivateKey) {
    configured ??= (async () => {
      const key = p256PrivateKey(env.authJwtPrivateKey!);
      if (!key) throw new Error("AUTH_JWT_PRIVATE_KEY must be an EC P-256 private key (PKCS8 PEM).");
      return withPublicJwk(key);
    })();
    return configured;
  }
  if (isProduction) return Promise.reject(new Error("AUTH_JWT_PRIVATE_KEY is not set."));
  ephemeral.__simulustWalletKey ??= withPublicJwk(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey);
  return ephemeral.__simulustWalletKey;
}

export async function walletToken(userId: string) {
  const { privateKey, publicJwk } = await signingKey();
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: publicJwk.kid, typ: "JWT" })
    .setSubject(userId)
    .setAudience(env.privyAppId!)
    .setIssuer(WALLET_TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(LIFETIME)
    .sign(privateKey);
}

export async function walletJwks() {
  const { publicJwk } = await signingKey();
  return { keys: [publicJwk] };
}
