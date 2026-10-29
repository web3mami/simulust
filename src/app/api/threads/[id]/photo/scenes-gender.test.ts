import { describe, expect, it } from "vitest";
import { checkImagePrompt } from "@/server/safety/text";
import { bringsOthers } from "@/server/studio";
import {
  EXPLICIT_PHOTO_IDEAS,
  EXPLICIT_PHOTO_IDEAS_MAN,
  explicitPhotoIdeas,
  photoIdeaLabel,
} from "@/components/chat/format";
import { PRESET_SCENES_BY_PERSON, presetScene, wantsNudity } from "./scenes";

// The photo quick actions and our own fallback scenes are worded for who the
// character is: a man is shirtless and in briefs, not topless in lace.

const GENDER = { woman: "Woman", man: "Man", person: "Non-binary" } as const;

describe("photo presets by gender", () => {
  it("dress a man as a man", () => {
    const shirtless = presetScene("shirtless, a teasing look over one shoulder", true, "Man");
    expect(shirtless).toContain("shirtless");
    expect(shirtless).toContain("bare chest");
    expect(shirtless).toContain("briefs");
    expect(shirtless).not.toMatch(/breasts|panties|lace/);
    // A man asking for "topless" gets the same.
    expect(presetScene("topless", true, "Man")).toBe(shirtless);
    expect(presetScene("in your boxers", true, "Man")).toContain("boxer briefs");
    expect(presetScene("in lace lingerie", true, "Man")).toContain("boxer briefs");
  });

  it("keep a woman's wording, and a neutral one for anyone else", () => {
    expect(presetScene("topless", true, "Woman")).toContain("bare breasts");
    expect(presetScene("in lace lingerie", true, "Woman")).toContain("lace lingerie");
    expect(presetScene("topless", true, "Non-binary")).toContain("bare chest");
    expect(presetScene("topless", true)).toBe(presetScene("topless", true, "Non-binary"));
  });

  it("keep a man's clothed fallback clothed", () => {
    const tasteful = presetScene("in your boxers", false, "Man");
    expect(tasteful).toContain("boxer briefs");
    expect(wantsNudity(tasteful)).toBe(false);
    expect(presetScene("shirtless", false, "Man")).toBeNull();
  });

  it("are one person, alone, and pass the image prompt check", () => {
    for (const { person, scene } of PRESET_SCENES_BY_PERSON) {
      expect(checkImagePrompt(scene), scene).toEqual({ ok: true });
      expect(bringsOthers(scene, GENDER[person]), `${person}: ${scene}`).toBeNull();
    }
  });

  it("read shirtless as nudity", () => {
    expect(wantsNudity("shirtless by the pool")).toBe(true);
    expect(wantsNudity("a shirt and jeans")).toBe(false);
  });
});

describe("explicit photo ideas by gender", () => {
  it("give a man shirtless and underwear", () => {
    expect(explicitPhotoIdeas("Man").map((idea) => idea.label)).toEqual(["Send me a nude", "Shirtless", "Underwear", "In the shower"]);
    expect(explicitPhotoIdeas("male")).toBe(EXPLICIT_PHOTO_IDEAS_MAN);
  });

  it("keep the list as it was for a woman and anyone else", () => {
    for (const gender of ["Woman", "Non-binary", "", null, undefined]) expect(explicitPhotoIdeas(gender)).toBe(EXPLICIT_PHOTO_IDEAS);
    expect(EXPLICIT_PHOTO_IDEAS.map((idea) => idea.label)).toEqual(["Send me a nude", "Topless", "Lingerie", "In the shower"]);
  });

  it("each have a scene of ours, pass the checks, and ask for nudity where they should", () => {
    for (const gender of ["Woman", "Man", "Non-binary"]) {
      for (const idea of explicitPhotoIdeas(gender)) {
        expect(presetScene(idea.hint, true, gender), `${gender}: ${idea.label}`).toBeTruthy();
        expect(checkImagePrompt(idea.hint), idea.label).toEqual({ ok: true });
        expect(bringsOthers(idea.hint, gender), `${gender}: ${idea.label}`).toBeNull();
      }
    }
    const nude = EXPLICIT_PHOTO_IDEAS_MAN.filter((idea) => wantsNudity(idea.hint)).map((idea) => idea.label);
    expect(nude).toEqual(["Send me a nude", "Shirtless", "In the shower"]);
  });

  it("show their label while the photo is taken", () => {
    expect(photoIdeaLabel(EXPLICIT_PHOTO_IDEAS_MAN[1].hint)).toBe("Shirtless");
    expect(photoIdeaLabel(EXPLICIT_PHOTO_IDEAS_MAN[2].hint)).toBe("Underwear");
    expect(photoIdeaLabel(EXPLICIT_PHOTO_IDEAS[1].hint)).toBe("Topless");
  });
});
