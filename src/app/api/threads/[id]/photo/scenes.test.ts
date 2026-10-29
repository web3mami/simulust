import { describe, expect, it } from "vitest";
import { checkImagePrompt } from "@/server/safety/text";
import { EXPLICIT_PHOTO_IDEAS, PHOTO_IDEAS } from "@/components/chat/format";
import { PRESET_SCENES, presetScene, wantsClothed, wantsNudity } from "./scenes";

const CLOTHED_REQUESTS = [
  "No nudity, please; a cozy sweater",
  "A clothed photo, not naked",
  "Keep your shirt on, nothing topless",
  "Don't send me nudes, just a selfie",
  "Please do not be naked",
  "No nude or topless photos",
  "Avoid showing your breasts",
  "Nothing too explicit, please",
  "In the shower without any nudity",
  "Fully clothed in a red dress",
  "Keep your clothes on",
  "A non-nude photo",
  "Something safe for work",
];

describe("wantsNudity", () => {
  it("reads a request for nudity", () => {
    for (const hint of [
      "Send me a nude",
      "send nudes",
      "nud3s please",
      "topless by the pool",
      "completely naked on the bed",
      "with no clothes on",
      "show me your tits",
      "something nsfw",
      "strip down for me",
      "nude, not fully clothed",
      "not only topless, fully nude",
      "naked with no underwear",
    ]) {
      expect(wantsNudity(hint), hint).toBe(true);
    }
  });

  it.each(CLOTHED_REQUESTS)("honours a clothing preference: %s", (hint) => {
    expect(wantsClothed(hint)).toBe(true);
    expect(wantsNudity(hint)).toBe(false);
  });

  it("leaves clothed and implied requests alone", () => {
    for (const hint of [
      "in lace lingerie on the bed",
      "in the shower",
      "a sexy red dress",
      "nothing explicit, just a selfie",
      "at the beach in a bikini",
      "a strip of sunlight across the sheets",
      "",
      null,
    ]) {
      expect(wantsNudity(hint), String(hint)).toBe(false);
    }
  });
});

describe("presetScene", () => {
  it("has a scene for each explicit quick action", () => {
    for (const idea of EXPLICIT_PHOTO_IDEAS) expect(presetScene(idea.hint, true), idea.label).toBeTruthy();
    expect(presetScene(EXPLICIT_PHOTO_IDEAS[0].hint, true)).toContain("nude");
    expect(presetScene(EXPLICIT_PHOTO_IDEAS[1].hint, true)).toContain("topless");
    expect(presetScene(EXPLICIT_PHOTO_IDEAS[3].hint, true)).toContain("shower");
  });

  it("keeps the clothed fallbacks clothed, and has none for nude requests", () => {
    expect(presetScene("in lace lingerie", false)).toContain("lingerie");
    expect(wantsNudity(presetScene("in lace lingerie", false))).toBe(false);
    expect(wantsNudity(presetScene("in the shower", false))).toBe(false);
    expect(presetScene("Send me a nude", false)).toBeNull();
    expect(presetScene("topless", false)).toBeNull();
    expect(presetScene("a casual selfie right now", true)).toBeNull();
    expect(presetScene(undefined, true)).toBeNull();
  });

  it("only ever writes scenes that pass the image prompt check", () => {
    for (const scene of PRESET_SCENES) expect(checkImagePrompt(scene), scene).toEqual({ ok: true });
  });

  it.each(CLOTHED_REQUESTS)("never substitutes a nude preset for: %s", (hint) => {
    for (const gender of ["Woman", "Man", "Non-binary"]) {
      const scene = presetScene(hint, true, gender);
      expect(wantsNudity(scene), `${gender}: ${scene}`).toBe(false);
    }
  });
});

describe("photo quick actions", () => {
  it("pass the image prompt check", () => {
    for (const idea of [...PHOTO_IDEAS, ...EXPLICIT_PHOTO_IDEAS]) expect(checkImagePrompt(idea.hint), idea.label).toEqual({ ok: true });
  });

  it("ask for nudity only in the explicit ones that should", () => {
    for (const idea of PHOTO_IDEAS) expect(wantsNudity(idea.hint), idea.label).toBe(false);
    const nude = EXPLICIT_PHOTO_IDEAS.filter((idea) => wantsNudity(idea.hint)).map((idea) => idea.label);
    expect(nude).toEqual(["Send me a nude", "Topless", "In the shower"]);
  });
});
