import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/report", useRouter: () => ({ refresh() {}, replace() {} }) }));
vi.mock("@/components/auth-gate", () => ({
  useSession: () => ({ ready: true, session: null, me: null, signOut() {}, openLogin() {}, openSignup() {} }),
}));
vi.mock("@/components/login-screen", () => ({ preloadLoginArt() {} }));
vi.mock("@/components/wallet-sync", () => ({ useWalletStatus: () => ({ state: "none", address: null, userId: null }) }));

const { AccountMenu } = await import("./account-menu");

const render = () => renderToStaticMarkup(createElement(AccountMenu, { lane: "girls" }));

describe("AccountMenu, signed out", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers Log in and Join", () => {
    const html = render();
    expect(html).toMatch(/>Log in</);
    expect(html).toMatch(/Join free/);
  });

  // AC-1: the open pages (report, policies) still show the top bar on a
  // device the age check turned away; it offers no way back in.
  it("offers neither on a device the age check turned away", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => (key === "simulust-age-refused" ? "1" : null) },
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal("document", { documentElement: { hasAttribute: () => false }, cookie: "" });
    const html = render();
    expect(html).not.toMatch(/Log in|Join free|Create free account/);
  });
});
