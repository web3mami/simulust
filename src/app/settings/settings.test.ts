import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Features, Me } from "@/lib/api-types";

// The session is scripted per test: a confirmed adult, an unconfirmed (older
// or dev) account, or a held one.
const state = vi.hoisted(() => ({ me: null as unknown, features: null as unknown }));
vi.mock("@/components/auth-gate", () => ({
  useSession: () => ({
    ready: true,
    session: state.me ? { display: "Alice", detail: "@alice" } : null,
    me: state.me,
    features: state.features,
    suspended: false,
    refreshMe: async () => {},
    getToken: async () => null,
    signOut() {},
    openLogin() {},
    openSignup() {},
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings", useRouter: () => ({ replace() {}, refresh() {} }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  useLane: () => ({ lane: "girls", setLane() {} }),
}));
vi.mock("@/components/wallet-sync", () => ({ useWalletStatus: () => ({ state: "none", address: null }) }));

const { default: SettingsPage } = await import("./page");
const { default: VerifyPage } = await import("../verify/page");

const FEATURES: Features = {
  payments: true,
  ageVerification: "gate",
  voice: false,
  video: true,
  images: "mock",
  solanaCluster: "devnet",
};

function account(overrides: Partial<Me> = {}): Me {
  return {
    id: "u1",
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

const render = (page: () => ReactNode) => renderToStaticMarkup(createElement(page));

describe("Settings", () => {
  beforeEach(() => {
    state.features = FEATURES;
  });

  it("has no explicit switch: one preference, the account and the data", () => {
    state.me = account();
    const html = render(SettingsPage);
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(html).toMatch(/Photos and voice notes without asking/);
    expect(html).not.toMatch(/explicit mode|turn on explicit|Uncensored/i);
    expect(html).toContain("@alice");
    expect(html).toMatch(/Age confirmed/);
    expect(html).toContain('href="/profile#password"');
    expect(html).toMatch(/Log out/);
    expect(html).toMatch(/Download my data/);
  });

  it("asks an unconfirmed account to confirm on /verify", () => {
    state.me = account({ ageVerified: false, ageAttested: false });
    const html = render(SettingsPage);
    expect(html).toMatch(/Confirm your age/);
    expect(html).toMatch(/href="\/verify">Confirm<\/a>/);
  });

  it("tells a held account it's paused, with no way to unlock it", () => {
    state.me = account({ ageVerified: false, ageAttested: false, explicitHold: true });
    const html = render(SettingsPage);
    expect(html).toMatch(/Paused while we review this account/);
    expect(html).toMatch(/Paused for review/);
    expect(html).not.toMatch(/>Confirm<|Confirm your age/);
  });
});

describe("Verify (date-of-birth confirmation)", () => {
  beforeEach(() => {
    state.features = FEATURES;
  });

  it("offers the date-of-birth form to an account that hasn't confirmed", () => {
    state.me = account({ ageVerified: false, ageAttested: false });
    const html = render(VerifyPage);
    expect(html).toContain('autoComplete="bday-year"');
    expect(html).toMatch(/Confirm my age/);
    expect(html).not.toMatch(/explicit mode/i);
  });

  it("has nothing left to do for a confirmed adult", () => {
    state.me = account();
    const html = render(VerifyPage);
    expect(html).toMatch(/You&#x27;re confirmed/);
    expect(html).not.toContain('autoComplete="bday-year"');
    expect(html).not.toMatch(/explicit mode/i);
  });

  it("keeps a held account paused, with no form", () => {
    state.me = account({ ageVerified: false, ageAttested: false, explicitHold: true });
    const html = render(VerifyPage);
    expect(html).toMatch(/Paused while we review this account/);
    expect(html).not.toContain('autoComplete="bday-year"');
  });
});

describe("Verify (ID check)", () => {
  // AC-4: a held account gets the same pause as with the date-of-birth gate,
  // whatever its ID check says: nothing to start, nothing unlocked.
  it.each(["veriff", "dev"] as const)("keeps a held account paused in %s mode, with no check to start", (mode) => {
    state.features = { ...FEATURES, ageVerification: mode };
    for (const ageStatus of ["none", "declined", "approved"] as const) {
      state.me = account({ ageVerified: false, ageAttested: true, explicitHold: true, ageStatus });
      const html = render(VerifyPage);
      expect(html).toMatch(/Paused while we review this account/);
      expect(html).not.toMatch(/Start verification|Try again|Start a new check|Approve \(dev\)|Decline \(dev\)/);
      expect(html).not.toMatch(/You&#x27;re verified|Start exploring|Everything on Simulust is open to you/);
      expect(html).not.toContain('autoComplete="bday-year"');
      expect(html).not.toContain("(done)");
    }
  });

  it("still offers the check to an account that isn't held", () => {
    state.features = { ...FEATURES, ageVerification: "veriff" };
    state.me = account({ ageVerified: false, ageAttested: false, ageStatus: "none" });
    expect(render(VerifyPage)).toMatch(/Start verification/);
    state.me = account({ ageVerified: true, ageStatus: "approved" });
    expect(render(VerifyPage)).toMatch(/You&#x27;re verified/);
  });
});
