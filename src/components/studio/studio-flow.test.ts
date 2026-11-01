// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/api-types";
import { SEED_CHARACTERS } from "@/lib/characters";
import type { StudioFrameResponse } from "@/app/api/studio/frame/route";

const mocks = vi.hoisted(() => ({
  me: null as Me | null,
  api: vi.fn(),
  refreshMe: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace() {} }),
  useSearchParams: () => new URLSearchParams({ character: "mira" }),
}));
vi.mock("@/components/auth-gate", () => ({
  useSession: () => ({
    ready: true,
    me: mocks.me,
    session: mocks.me ? { display: mocks.me.id, detail: mocks.me.id } : null,
    features: { video: true },
    refreshMe: mocks.refreshMe,
  }),
}));
vi.mock("@/components/home/catalogue", () => ({
  useCatalogue: () => ({ characters: SEED_CHARACTERS, status: "ready" }),
}));
// Character picking isn't involved here; the URL selects the official Mira.
vi.mock("./character-step", () => ({ CharacterStep: () => null }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  useApi: () => mocks.api,
  useAuthHeaders: () => async () => ({}),
}));

const { StudioFlow } = await import("./studio-flow");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const FRAME: StudioFrameResponse = {
  media: { id: "frame-a", kind: "image", status: "ready", url: "/api/media/frame-a" },
  balance: 80,
};
const CLIP = { media: { id: "clip-a", kind: "video", status: "pending" }, balance: 40 } as const;

let container: HTMLDivElement;
let root: Root;

async function account(id: string | null) {
  mocks.me = id ? ({ id, ageVerified: true, explicitHold: false, balance: 100 } as Me) : null;
  await act(async () => root.render(createElement(StudioFlow)));
}

async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(text));
  expect(button, `button beginning ${text}`).toBeDefined();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}

async function editDetails(text: string) {
  const field = container.querySelector("textarea")!;
  expect(field).not.toBeNull();
  await act(async () => {
    // React's controlled textarea observes the browser's native setter.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function createFrame() {
  mocks.api.mockResolvedValueOnce(FRAME);
  await click("Continue");
  await click("Create keyframe");
  expect(container.querySelector('img[src="/api/media/frame-a"]')).not.toBeNull();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  mocks.api.mockReset();
  mocks.refreshMe.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the studio's account boundary", () => {
  it.each(["b", "a"])("drops private details and finished media after logout and login as %s", async (nextAccount) => {
    await account("a");
    await editDetails("A's private scene details");
    await createFrame();
    expect(container.textContent).toContain("A's private scene details");

    await account(null);
    expect(container.querySelector('img[src="/api/media/frame-a"]')).toBeNull();
    await account(nextAccount);
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.textContent).not.toContain("A's private scene details");
    await click("Continue");
    expect(container.querySelector('img[src="/api/media/frame-a"]')).toBeNull();
    expect(container.textContent).toContain("Create keyframe");
  });

  it("also clears a take on a direct account switch", async () => {
    await account("a");
    await createFrame();
    await account("b");
    await click("Continue");
    expect(container.querySelector('img[src="/api/media/frame-a"]')).toBeNull();
    expect(container.textContent).toContain("Create keyframe");
  });

  it.each(["resolve", "reject"] as const)("ignores a frame request that %ss after switching accounts", async (outcome) => {
    const pending = deferred<StudioFrameResponse>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await account("a");
    await click("Continue");
    await click("Create keyframe");
    const signal = mocks.api.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await account("b");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") pending.resolve(FRAME);
      else pending.reject(new Error("The old account's request failed"));
    });
    expect(mocks.refreshMe).not.toHaveBeenCalled();
    await click("Continue");
    expect(container.querySelector('img[src="/api/media/frame-a"]')).toBeNull();
    expect(container.textContent).not.toContain("request failed");
    expect(container.textContent).toContain("Create keyframe");
  });

  it("does not refresh the shared session when an animation completes after logout", async () => {
    await account("a");
    await createFrame();
    mocks.refreshMe.mockClear();
    const pending = deferred<typeof CLIP>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await click("Animate");
    const signal = mocks.api.mock.calls.at(-1)![1].signal as AbortSignal;

    await account(null);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(CLIP));
    expect(mocks.refreshMe).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Log in");
  });

  it("aborts status polling and ignores a late failed clip from the previous account", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await account("a");
    await createFrame();
    mocks.api.mockResolvedValueOnce(CLIP);
    await click("Animate");
    mocks.refreshMe.mockClear();
    const pending = deferred<{ media: { id: string; kind: "video"; status: "failed"; error: string } }>();
    mocks.api.mockReturnValueOnce(pending.promise);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    const poll = mocks.api.mock.calls.find(([path]) => path === "/api/media/clip-a/status");
    expect(poll).toBeDefined();

    await account("b");
    expect((poll![1].signal as AbortSignal).aborted).toBe(true);
    await act(async () => pending.resolve({ media: { id: "clip-a", kind: "video", status: "failed", error: "Old clip failed" } }));
    expect(mocks.refreshMe).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Old clip failed");
  });
});
