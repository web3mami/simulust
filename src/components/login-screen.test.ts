import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usernameProblem } from "@/lib/session";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh() {}, replace() {} }) }));
vi.mock("@/components/app-shell", () => ({ useLane: () => ({ lane: "girls", setLane() {} }) }));
vi.mock("@/components/auth-gate", () => ({
  useSession: () => ({ getToken: async () => null, refreshMe: async () => {} }),
}));

const { LoginScreen, isRefusal, signupRequest } = await import("./login-screen");

const render = (intent: "login" | "signup") => renderToStaticMarkup(createElement(LoginScreen, { embedded: true, intent }));

// A browser device, refused one way or another (or not at all).
function device({ stored = false, marked = false, cookie = "" } = {}) {
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => (stored && key === "simulust-age-refused" ? "1" : null) },
    // next/image reads it in development.
    location: { href: "http://localhost:3000/report" },
  });
  vi.stubGlobal("document", {
    documentElement: { hasAttribute: (name: string) => marked && name === "data-age-refused" },
    cookie,
  });
}

describe("LoginScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("logs in with a username and password, nothing else", () => {
    const html = render("login");
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toMatch(/Forgot password\?/);
    expect(html).toMatch(/aria-label="Show password"/);
    // No email, Google, X or wallet login anywhere.
    expect(html).not.toMatch(/Continue with|Google|Connect Solana wallet|type="email"/);
  });

  it("signs up with a username, a new password, a date of birth and one consent tick", () => {
    const html = render("signup");
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="new-password"');
    for (const part of ["bday-day", "bday-month", "bday-year"]) expect(html).toContain(`autoComplete="${part}"`);
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).toMatch(/I&#x27;m 18 or older, I agree to the/);
    expect(html).toMatch(/everything here is uncensored/);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/content-policy"');
    expect(html).toMatch(/Create free account/);
    expect(html).not.toMatch(/explicit mode|Google|type="email"/i);
  });

  it("shows the forms on a device that was never turned away", () => {
    device();
    expect(render("signup")).toContain("<form");
    expect(render("login")).toContain("<form");
  });

  // AC-1: a device refused at the gate (or at sign-up) can't sign up again on
  // an open page, like /report, where the gate doesn't stand.
  it.each([
    ["storage", { stored: true }],
    ["the mark on <html>", { marked: true }],
    ["the cookie alone", { cookie: "theme=dark; simulust-age-refused=1" }],
  ])("opens on the refusal, never a form, for a device refused by %s", (_, how) => {
    device(how);
    for (const intent of ["signup", "login"] as const) {
      const html = render(intent);
      expect(html).toMatch(/Simulust is for adults\./);
      expect(html).toContain('href="/report"');
      expect(html).not.toContain("<form");
      expect(html).not.toMatch(/new-password|current-password|bday-year|Create free account|Sign up/);
    }
  });
});

describe("isRefusal", () => {
  it("turns the device away for an under-18 date or a device the server knows was refused", () => {
    expect(isRefusal(403, "under_18")).toBe(true);
    expect(isRefusal(403, "device_refused")).toBe(true);
  });

  it("leaves every other failure to the form", () => {
    expect(isRefusal(403, "forbidden")).toBe(false);
    expect(isRefusal(403, "age_locked")).toBe(false);
    expect(isRefusal(403, undefined)).toBe(false);
    expect(isRefusal(400, "device_refused")).toBe(false);
    expect(isRefusal(null, undefined)).toBe(false);
  });
});

describe("signupRequest", () => {
  // AC-5: the server logs in with the lower-case name and shows the typed one.
  it("sends the username as typed, only trimmed", () => {
    const body = signupRequest(
      { username: "  Night_Owl ", password: "correct horse", birthDate: "1990-04-02" },
      new Date(2026, 9, 28, 12),
    );
    expect(body).toEqual({
      username: "Night_Owl",
      password: "correct horse",
      birthDate: "1990-04-02",
      today: "2026-10-28",
      consent: true,
    });
  });

  it("is checked in the lower-case form, so mixed case is a valid username", () => {
    expect(usernameProblem(signupRequest({ username: " Night_Owl ", password: "", birthDate: "" }).username)).toBeNull();
  });
});
