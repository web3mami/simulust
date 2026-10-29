import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/components/auth-gate", () => ({
  useSession: () => ({ getToken: async () => null, refreshMe: async () => {} }),
}));

const { AGE_REFUSED_EVENT, AgeGate, AgeRefusedScreen, isDeviceRefused, isOpenPath, localToday, refuseDevice } =
  await import("./age-gate");

// A small stand-in for Storage.
function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("localToday", () => {
  it("is the person's own calendar day, as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

describe("isOpenPath", () => {
  it("opens the legal and report pages only", () => {
    for (const path of ["/terms", "/privacy", "/content-policy", "/safety", "/dmca", "/2257", "/report"]) {
      expect(isOpenPath(path)).toBe(true);
    }
    expect(isOpenPath("/")).toBe(false);
    expect(isOpenPath("/settings")).toBe(false);
    expect(isOpenPath("/terms-of-fun")).toBe(false);
  });
});

describe("refuseDevice", () => {
  let local: ReturnType<typeof storage>;
  let session: ReturnType<typeof storage>;
  let attributes: Set<string>;
  let events: string[];
  let page: { cookie: string };
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    local = storage({ "simulust-age-ok": "1" });
    session = storage({ "simulust-age-ok": "1" });
    attributes = new Set(["data-age-ok"]);
    events = [];
    const target = new EventTarget();
    target.addEventListener(AGE_REFUSED_EVENT, () => events.push(AGE_REFUSED_EVENT));
    vi.stubGlobal("window", {
      localStorage: local,
      sessionStorage: session,
      location: { protocol: "http:" },
      dispatchEvent: (event: Event) => target.dispatchEvent(event),
    });
    // Holds the last cookie written, attributes and all, which is enough here.
    page = { cookie: "" };
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (name: string) => attributes.add(name),
        removeAttribute: (name: string) => attributes.delete(name),
        hasAttribute: (name: string) => attributes.has(name),
      },
      get cookie() {
        return page.cookie;
      },
      set cookie(value: string) {
        page.cookie = value;
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the refusal on the device and forgets the pass", () => {
    refuseDevice();
    expect(local.data.get("simulust-age-refused")).toBe("1");
    expect(local.data.has("simulust-age-ok")).toBe(false);
    expect(session.data.has("simulust-age-ok")).toBe(false);
    // For the boot script and the CSS that shows the refusal before hydration.
    expect(attributes.has("data-age-refused")).toBe(true);
    expect(attributes.has("data-age-ok")).toBe(false);
    expect(events).toEqual([AGE_REFUSED_EVENT]);
  });

  // AGE-2: a signed-in account on this device is held too.
  it("tells the server, same origin, with today's date and never the birth date", () => {
    refuseDevice();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/age/refused");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ today: localToday() });
  });

  it("still refuses when storage and the network are blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
      dispatchEvent: () => true,
    });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => refuseDevice()).not.toThrow();
    expect(attributes.has("data-age-refused")).toBe(true);
    // The cookie still carries it to the server.
    expect(page.cookie).toMatch(/^simulust-age-refused=1;/);
  });

  // AC-1: the server sees the refusal too, so sign-up on an open page (where
  // the gate doesn't stand) can't make an account on this device.
  it("sets a year-long, site-wide cookie the server can read", () => {
    refuseDevice();
    const parts = page.cookie.split(";").map((part) => part.trim());
    expect(parts[0]).toBe("simulust-age-refused=1");
    expect(parts).toContain("Path=/");
    expect(parts).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(parts).toContain("SameSite=Lax");
    // Not httpOnly (a page can't set that), and only Secure over https.
    expect(parts).not.toContain("HttpOnly");
    expect(parts).not.toContain("Secure");
  });

  it("marks the cookie Secure over https", () => {
    vi.stubGlobal("window", {
      localStorage: local,
      sessionStorage: session,
      location: { protocol: "https:" },
      dispatchEvent: () => true,
    });
    refuseDevice();
    expect(page.cookie.split(";").map((part) => part.trim())).toContain("Secure");
  });

  it("is what isDeviceRefused reads back, from storage, the mark on <html> or the cookie alone", () => {
    expect(isDeviceRefused()).toBe(false);
    refuseDevice();
    expect(isDeviceRefused()).toBe(true);

    // Storage cleared and no mark: the cookie still says so.
    local.data.clear();
    attributes.clear();
    page.cookie = "other=1; simulust-age-refused=1";
    expect(isDeviceRefused()).toBe(true);

    // The boot script's mark alone.
    page.cookie = "";
    attributes.add("data-age-refused");
    expect(isDeviceRefused()).toBe(true);

    attributes.clear();
    page.cookie = "simulust-age-refused=0; xsimulust-age-refused=1";
    expect(isDeviceRefused()).toBe(false);
  });

  it("is never refused on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(isDeviceRefused()).toBe(false);
  });
});

describe("AgeRefusedScreen", () => {
  // AGE-8: not a dead end.
  it("keeps Terms, Privacy and Report in reach, and says how to fix a wrong year", () => {
    const html = renderToStaticMarkup(createElement(AgeRefusedScreen));
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/report"');
    expect(html).toMatch(/wrong year/);
    expect(html).not.toContain("<form");
  });
});

describe("AgeGate", () => {
  afterEach(() => {
    nav.pathname = "/";
  });

  it("sends the check, the refusal and the app before storage is read, for the boot script to pick", () => {
    nav.pathname = "/";
    const html = renderToStaticMarkup(createElement(AgeGate, null, createElement("p", null, "the app")));
    expect(html).toContain("age-pending-gate");
    expect(html).toContain("age-gate-form");
    expect(html).toContain("age-gate-refused");
    expect(html).toContain("age-pending-app");
    expect(html).toContain("the app");
    expect(html).not.toMatch(/explicit mode/i);
  });

  it("never gates the legal pages", () => {
    nav.pathname = "/privacy";
    const html = renderToStaticMarkup(createElement(AgeGate, null, createElement("p", null, "the policy")));
    expect(html).not.toContain("age-pending-gate");
    expect(html).toContain("the policy");
  });
});
