import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: vi.fn(), useSubscribeToJwtAuthWithFlag: vi.fn() }));
vi.mock("@privy-io/react-auth/solana", () => ({ useCreateWallet: vi.fn() }));
vi.mock("@/components/auth-gate", () => ({ useSession: vi.fn() }));

const { customUserId, embeddedSolanaAddress, payingWallet, walletStatusFor, walletStatusOf, walletToken } = await import("./wallet-sync");

type Accounts = Parameters<typeof embeddedSolanaAddress>[0];
const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("walletToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands Privy our token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ token: "jwt.for.privy" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(walletToken()).resolves.toBe("jwt.for.privy");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/wallet-token", { cache: "no-store" });
  });

  // A throw would sign Privy out mid-session, so every failure is "no token".
  it("never throws: signed out, Privy off, junk or offline all mean no token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Sign in first." }, { status: 401 })));
    await expect(walletToken()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(walletToken()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(walletToken()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: 42 })));
    await expect(walletToken()).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(walletToken()).resolves.toBeUndefined();
  });
});

describe("Privy user", () => {
  const user = (linkedAccounts: unknown[]) => ({ linkedAccounts }) as unknown as Accounts;

  it("reads our account id from the JWT account", () => {
    expect(customUserId(user([{ type: "custom_auth", customUserId: "u1" }]))).toBe("u1");
    expect(customUserId(user([{ type: "wallet", chainType: "solana", address: ADDRESS }]))).toBeNull();
  });

  it("finds only the embedded Solana wallet", () => {
    expect(
      embeddedSolanaAddress(
        user([
          { type: "wallet", chainType: "ethereum", walletClientType: "privy", address: "0xabc" },
          { type: "wallet", chainType: "solana", walletClientType: "phantom", address: "Phantom111" },
          { type: "wallet", chainType: "solana", walletClientType: "privy", address: ADDRESS },
        ]),
      ),
    ).toBe(ADDRESS);
    expect(
      embeddedSolanaAddress(user([{ type: "wallet", chainType: "solana", walletClientType: "phantom", address: "P" }])),
    ).toBeNull();
    expect(embeddedSolanaAddress(user([]))).toBeNull();
  });
});

describe("walletStatusFor", () => {
  const base = { userId: "u1", address: null, sync: "done", failed: false };

  it("says whose wallet it is, so nothing mixes accounts up", () => {
    expect(walletStatusFor({ ...base, address: ADDRESS })).toEqual({ state: "ready", address: ADDRESS, userId: "u1" });
    expect(walletStatusFor({ ...base, sync: "loading" })).toEqual({ state: "setting-up", address: null, userId: "u1" });
  });

  it("is none when signed out, and unavailable when Privy or the wallet failed", () => {
    expect(walletStatusFor({ ...base, userId: null, address: ADDRESS })).toEqual({ state: "none", address: null, userId: null });
    for (const sync of ["error", "not-enabled"]) {
      expect(walletStatusFor({ ...base, sync }).state).toBe("unavailable");
    }
    expect(walletStatusFor({ ...base, failed: true }).state).toBe("unavailable");
  });
});

// AC-2: right after switching from account A to account B, Privy can still
// hold A's embedded wallet. A checkout for B must never pay from it.
describe("payingWallet", () => {
  const OTHER = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
  const embedded = (address: string) => ({ address, standardWallet: { features: { "privy:": {}, "solana:signAndSendTransaction": {} } } });
  const external = (address: string) => ({ address, standardWallet: { features: { "solana:signAndSendTransaction": {} } } });
  const ready = walletStatusFor({ userId: "b", address: ADDRESS, sync: "done", failed: false });

  it("pays from the embedded wallet synced for the account signed in now", () => {
    expect(payingWallet([embedded(OTHER), embedded(ADDRESS)], ready, "b")?.address).toBe(ADDRESS);
  });

  it("never pays from the previous account's wallet while Privy catches up", () => {
    // Privy still lists A's wallet only.
    expect(payingWallet([embedded(OTHER)], ready, "b")).toBeUndefined();
    // The status is still A's: B is signed in now.
    const forA = walletStatusFor({ userId: "a", address: OTHER, sync: "done", failed: false });
    expect(payingWallet([embedded(OTHER)], forA, "b")).toBeUndefined();
  });

  it("waits until the sync is ready, and never uses a wallet Privy didn't make", () => {
    const settingUp = walletStatusFor({ userId: "b", address: null, sync: "loading", failed: false });
    expect(payingWallet([embedded(ADDRESS)], settingUp, "b")).toBeUndefined();
    expect(payingWallet([external(ADDRESS)], ready, "b")).toBeUndefined();
    expect(payingWallet([embedded(ADDRESS)], ready, null)).toBeUndefined();
  });
});

// CA-V1: the account card and menu show the live wallet only while it's for
// the account signed in now.
describe("walletStatusOf", () => {
  const forB = walletStatusFor({ userId: "b", address: ADDRESS, sync: "done", failed: false });
  const settingUpForA = walletStatusFor({ userId: "a", address: null, sync: "loading", failed: false });
  const none = { state: "none", address: null, userId: null };

  it("passes the account's own status through", () => {
    expect(walletStatusOf(forB, "b")).toEqual(forB);
    expect(walletStatusOf(settingUpForA, "a")).toEqual(settingUpForA);
  });

  it("is none for another account, including its setting-up, or before the account loads", () => {
    expect(walletStatusOf(forB, "a")).toEqual(none);
    expect(walletStatusOf(settingUpForA, "b")).toEqual(none);
    expect(walletStatusOf(forB, null)).toEqual(none);
    expect(walletStatusOf(forB, undefined)).toEqual(none);
    expect(walletStatusOf(walletStatusFor({ userId: null, address: null, sync: "done", failed: false }), null)).toEqual(none);
  });
});
