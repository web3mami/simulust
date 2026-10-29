import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/api-types";
import type { WalletStatus } from "@/components/wallet-sync";

// The live wallet status is scripted per test; the rest of wallet-sync is real,
// so the card's choice of wallet is the one the app makes.
const state = vi.hoisted(() => ({ live: { state: "none", address: null, userId: null } as WalletStatus }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: vi.fn(), useSubscribeToJwtAuthWithFlag: vi.fn() }));
vi.mock("@privy-io/react-auth/solana", () => ({ useCreateWallet: vi.fn() }));
vi.mock("@/components/auth-gate", () => ({ useSession: vi.fn() }));
vi.mock("@/components/wallet-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/wallet-sync")>()),
  useWalletStatus: () => state.live,
}));
vi.mock("@/components/account-menu", () => ({ AGE_DOT: { ok: "", hold: "", pending: "", todo: "" } }));

const { AccountCard } = await import("./account-card");

const ID = "0b9f6c1e-4d2a-4f5b-9a63-2c1d8e7f6a50";

function account(overrides: Partial<Me> = {}): Me {
  return {
    id: ID,
    username: "alice",
    displayName: "Alice",
    isAdmin: false,
    ageStatus: "none",
    ageVerified: true,
    ageAttested: true,
    explicitHold: false,
    memberUntil: null,
    isMember: false,
    settings: { unpromptedMedia: false },
    balance: 10,
    freeMessagesLeft: 5,
    ...overrides,
  };
}

const render = (me: Me | null) =>
  renderToStaticMarkup(
    createElement(AccountCard, { session: { display: "Alice", detail: "@alice" }, me, onSignOut() {} }),
  );

describe("Profile account card", () => {
  // AC-6: operators fill ADMIN_USER_IDS with it, so it's there to copy.
  it("shows the account ID with a Copy button", () => {
    const html = render(account());
    expect(html).toMatch(/>Account ID</);
    expect(html).toContain(ID);
    expect(html).toContain('aria-label="Copy account ID"');
    // After the everyday rows, not before them.
    expect(html.indexOf("Account ID")).toBeGreaterThan(html.indexOf("@alice"));
  });

  it("waits for the account before showing an ID", () => {
    expect(render(null)).not.toMatch(/Account ID/);
  });
});

// CA-V1: right after a switch from account A to account B, the live status can
// still be A's. B's card shows only B's own wallet, or B's own setting-up.
describe("Profile account card, wallet", () => {
  const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const OTHER = "9b2d4c3e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

  afterEach(() => {
    state.live = { state: "none", address: null, userId: null };
  });

  it("shows the live wallet once it's this account's", () => {
    state.live = { state: "ready", address: ADDRESS, userId: ID };
    expect(render(account())).toContain(`title="${ADDRESS}"`);
    state.live = { state: "setting-up", address: null, userId: ID };
    expect(render(account())).toContain("Setting up your wallet");
  });

  it("never shows another account's wallet or its setting-up", () => {
    state.live = { state: "ready", address: ADDRESS, userId: OTHER };
    const html = render(account());
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toMatch(/Solana wallet/);
    state.live = { state: "setting-up", address: null, userId: OTHER };
    expect(render(account())).not.toMatch(/Setting up your wallet|Solana wallet/);
    // Nor anyone's before the account has loaded.
    state.live = { state: "ready", address: ADDRESS, userId: ID };
    expect(render(null)).not.toContain(ADDRESS);
  });

  it("prefers the address the server has for this account", () => {
    const saved = "4Nd1mYQf2b8m3yqk3oH4GzQ5yKXxW9d1q6bH8e7rC2sT";
    state.live = { state: "ready", address: ADDRESS, userId: OTHER };
    const html = render({ ...account(), walletAddress: saved } as Me);
    expect(html).toContain(`title="${saved}"`);
    expect(html).not.toContain(ADDRESS);
  });
});
