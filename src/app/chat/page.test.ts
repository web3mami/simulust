import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Character } from "@/lib/characters";

// "Start a new chat" comes from the live catalogue, so a confirmed adult sees
// the same 18+ card art there as on Home and Discover, and only official
// characters of the lane are suggested.

const catalogue = vi.hoisted(() => ({ characters: [] as Character[] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {} }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  useLane: () => ({ lane: "girls", setLane() {} }),
}));
vi.mock("@/components/auth-gate", () => ({ useSession: () => ({ ready: true, session: null, me: null }) }));
vi.mock("@/components/chat/conversation-list", () => ({ ConversationList: () => null }));
vi.mock("@/components/home/catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/home/catalogue")>()),
  useCatalogue: () => ({ characters: catalogue.characters, status: "ready" }),
}));

describe("the chat page's suggestions", () => {
  it("show the lane's official characters from the catalogue, with the art it sent", async () => {
    const { SEED_CHARACTERS, laneOf } = await import("@/lib/characters");
    const { featuredIn } = await import("@/components/home/catalogue");
    const official = SEED_CHARACTERS.map((person) => ({ ...person, explicitImage: `/api/characters/${person.id}/explicit-image?v=1` }));
    const mine: Character = { ...SEED_CHARACTERS.find((person) => laneOf(person) === "girls")!, id: "my-own", name: "Ownie", own: true };
    catalogue.characters = [mine, ...official];

    const ChatPage = (await import("./page")).default;
    const html = renderToStaticMarkup(createElement(ChatPage));
    const expected = featuredIn(catalogue.characters, "girls").slice(0, 4);
    expect(expected).toHaveLength(4);
    for (const person of expected) {
      expect(html).toContain(`href="/date/${person.id}"`);
      expect(html).toContain(`/api/characters/${person.id}/explicit-image`);
    }
    expect(html).not.toContain("/date/my-own");
    const otherLane = official.find((person) => laneOf(person) !== "girls")!;
    expect(html).not.toContain(`/date/${otherLane.id}"`);
  });
});
