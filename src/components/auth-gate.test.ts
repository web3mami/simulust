// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "./auth-gate";

const { refresh, writeDevUser } = vi.hoisted(() => ({ refresh: vi.fn(), writeDevUser: vi.fn() }));
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/age-gate", () => ({ AGE_REFUSED_EVENT: "age-refused", isOpenPath: () => false }));
vi.mock("@/components/login-screen", () => ({ LoginScreen: () => null }));
vi.mock("@/components/privy-app", () => ({ isPrivyConfigured: () => false }));
vi.mock("@/components/wallet-sync", () => ({ WalletSync: () => null }));
vi.mock("@/lib/dev-user", () => ({ writeDevUser }));

const { AuthProvider, useSession } = await import("./auth-gate");

const me = { id: "account-a", username: "alice", displayName: "Alice" };
let auth: AuthValue;
let root: Root;
let container: HTMLDivElement;
const logout = vi.fn<() => Promise<Response>>();

function Probe() {
  const current = useSession();
  useEffect(() => { auth = current; }, [current]);
  return createElement("span", { "data-testid": "account" }, current.me?.id ?? "signed-out");
}

async function mount(response = Response.json({ me, features: {} })) {
  vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/auth/logout" ? logout() : Promise.resolve(response)));
  await act(async () => root.render(createElement(AuthProvider, null, createElement(Probe))));
}

function retry() {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Try again");
  expect(button).toBeDefined();
  button!.click();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refresh.mockClear();
  writeDevUser.mockClear();
  logout.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AuthProvider logout", () => {
  it("retains the account until the server confirms logout and deduplicates clicks", async () => {
    let finish!: (response: Response) => void;
    logout.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await mount();

    await act(async () => { auth.signOut(); auth.signOut(); });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(auth.me?.id).toBe(me.id);
    expect(writeDevUser).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => finish(new Response(null, { status: 204 })));
    expect(auth.me).toBeNull();
    expect(auth.session).toBeNull();
    expect(writeDevUser).toHaveBeenCalledWith(null);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each(["network", "server"])("keeps the session after a %s failure and offers a working retry", async (failure) => {
    if (failure === "network") logout.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else logout.mockResolvedValueOnce(new Response(null, { status: 500 }));
    logout.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount();

    await act(async () => auth.signOut());
    expect(auth.me?.id).toBe(me.id);
    expect(auth.session).not.toBeNull();
    expect(writeDevUser).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Couldn't log out");

    await act(async () => retry());
    expect(logout).toHaveBeenCalledTimes(2);
    expect(auth.session).toBeNull();
    expect(writeDevUser).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("retains suspension after a logout failure and restores scrolling after retry", async () => {
    logout.mockResolvedValueOnce(new Response(null, { status: 503 }));
    logout.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount(Response.json({ code: "age_locked" }, { status: 403 }));
    expect(auth.suspended).toBe(true);

    await act(async () => auth.signOut());
    expect(auth.suspended).toBe(true);
    expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(container.textContent).toContain("Couldn't log out");
    expect(document.documentElement.style.overflow).toBe("hidden");

    await act(async () => retry());
    expect(auth.suspended).toBe(false);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("returns to the suspended-account notice when the logout error is closed", async () => {
    logout.mockResolvedValue(new Response(null, { status: 500 }));
    await mount(Response.json({ code: "age_locked" }, { status: 403 }));
    await act(async () => auth.signOut());
    const close = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === "Close");
    await act(async () => close!.click());
    expect(auth.suspended).toBe(true);
    expect(container.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(container.textContent).toContain("This account is locked");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(writeDevUser).not.toHaveBeenCalled();
  });
});
