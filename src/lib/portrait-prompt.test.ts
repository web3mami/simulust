import { describe, expect, it } from "vitest";
import { checkText } from "@/server/safety/text";
import { SEED_CHARACTERS } from "@/lib/characters";
import {
  appearanceText,
  buildImagePrompt,
  OTHER_PEOPLE_NEGATIVE,
  portraitPrompt,
  portraitRequest,
  type ImageSubject,
  type PortraitRequest,
} from "@/lib/portrait-prompt";

const girl = {
  section: "girls",
  style: "realistic",
  ethnicity: "Latina",
  age: 27,
  hair: "Brunette",
  hairStyle: "Wavy",
  eyeColor: "Brown",
  body: "Curvy",
  breast: "Medium",
  personality: "Sweet",
  role: "Girlfriend",
  occupation: "Nurse",
  kinks: ["Praise"],
};

const guy = {
  section: "guys",
  style: "realistic",
  ethnicity: "Black",
  age: 31,
  hair: "Black",
  hairStyle: "Buzz",
  eyeColor: "Brown",
  body: "Athletic",
  personality: "Dominant",
  role: "Boyfriend",
  occupation: "Chef",
  kinks: [],
};

function request(overrides: Record<string, unknown>) {
  const parsed = portraitRequest({ ...girl, ...overrides });
  if (!parsed) throw new Error("expected a valid request");
  return parsed;
}

describe("portraitRequest", () => {
  it("accepts complete choices", () => {
    expect(portraitRequest(girl)).toMatchObject({ section: "girls", age: 27, breast: "Medium" });
    expect(portraitRequest(guy)).toMatchObject({ section: "guys", breast: undefined });
  });

  it("refuses anyone under 18", () => {
    expect(portraitRequest({ ...girl, age: 17 })).toBeNull();
    expect(portraitRequest({ ...girl, age: 0 })).toBeNull();
    expect(portraitRequest({ ...girl, age: -20 })).toBeNull();
    expect(portraitRequest({ ...girl, age: 17.9 })).toBeNull();
    expect(portraitRequest({ ...girl, age: "17" })).toBeNull();
    expect(portraitRequest({ ...girl, age: 18 })).not.toBeNull();
  });

  it("only accepts values from the creator's lists", () => {
    expect(portraitRequest({ ...girl, hair: "pigtails like a child" })).toBeNull();
    expect(portraitRequest({ ...girl, occupation: "Student" })).toBeNull();
    expect(portraitRequest({ ...girl, body: "Muscular" })).toBeNull();
    expect(portraitRequest({ ...girl, kinks: ["Praise", "Teasing", "Lingerie", "Dominance"] })).toBeNull();
    expect(portraitRequest({ ...girl, breast: undefined })).toBeNull();
    expect(portraitRequest(null)).toBeNull();
  });
});

describe("portraitPrompt", () => {
  it("anchors realistic portraits to an adult", () => {
    const { prompt, negativePrompt } = portraitPrompt(request({}));
    expect(prompt).toContain("adult, 27-year-old Latina woman");
    expect(prompt).toContain("mature adult features");
    for (const word of ["child", "teen", "underage", "loli", "shota", "chibi", "school uniform", "childlike proportions", "young-looking"]) {
      expect(negativePrompt).toContain(word);
    }
  });

  it("anchors anime portraits to an adult", () => {
    const { prompt, negativePrompt } = portraitPrompt(request({ style: "anime", body: "Curvy", breast: "Large" }));
    expect(prompt).toContain("adult anime character, tall adult proportions, mature face");
    expect(prompt).toContain("27-year-old");
    expect(prompt).not.toContain("mature female");
    expect(negativePrompt).toContain("chibi");
    expect(negativePrompt).toContain("big head");
  });

  it("strengthens the anchors for anime with petite or small options", () => {
    for (const overrides of [{ body: "Petite" }, { breast: "Small" }]) {
      const { prompt } = portraitPrompt(request({ style: "anime", age: 19, ...overrides }));
      expect(prompt).toContain("mature female");
      expect(prompt).toContain("25-year-old");
      expect(prompt).not.toContain("19-year-old");
      expect(prompt).toContain("clearly adult body");
    }
  });

  it("keeps portraits clothed unless the user may see suggestive images", () => {
    const choice = request({ kinks: ["Lingerie"] });
    expect(portraitPrompt(choice).prompt).not.toContain("lingerie");
    expect(portraitPrompt(choice).negativePrompt).toContain("nude");
    expect(portraitPrompt(choice, { suggestive: true }).prompt).toContain("lingerie");
    expect(portraitPrompt(choice, { suggestive: true }).negativePrompt).toContain("nude");
  });

  it("never trips the text blocklist for any combination of choices", () => {
    const options = {
      style: ["realistic", "anime"],
      ethnicity: ["Caucasian", "Asian", "Latina", "Black"],
      hairStyle: ["Straight", "Ponytail", "Bun", "Short"],
      body: ["Petite", "Athletic", "Curvy", "Thick"],
      breast: ["Small", "Medium", "Large"],
      kinks: [["Lingerie"], ["Praise", "Teasing"]],
    };
    let checked = 0;
    for (const style of options.style)
      for (const ethnicity of options.ethnicity)
        for (const hairStyle of options.hairStyle)
          for (const body of options.body)
            for (const breast of options.breast)
              for (const kinks of options.kinks) {
                const choice = request({ style, ethnicity, hairStyle, body, breast, kinks, age: 18 }) as PortraitRequest;
                for (const suggestive of [false, true]) {
                  const { prompt } = portraitPrompt(choice, { suggestive });
                  expect(checkText(prompt), prompt).toEqual({ ok: true });
                  checked++;
                }
              }
    expect(checked).toBeGreaterThan(500);
    const male = portraitRequest({ ...guy, style: "anime", body: "Slim" })!;
    expect(checkText(portraitPrompt(male).prompt)).toEqual({ ok: true });
    expect(portraitPrompt(male).prompt).toContain("mature male");
  });
});

describe("buildImagePrompt", () => {
  const subject: ImageSubject = {
    name: "Mira",
    age: 27,
    gender: "Woman",
    style: "realistic",
    ethnicity: "Latina",
    body: "Curvy",
    hair: "Brunette",
    hairStyle: "Wavy",
    eyeColor: "Brown",
    breast: "Medium",
  };

  it("describes the character in the scene with adult anchors", () => {
    const { prompt, negativePrompt } = buildImagePrompt({ subject, scene: "on a rooftop bar at night, red dress", explicit: false });
    expect(prompt).toContain("adult, 27-year-old woman");
    expect(prompt).toContain("mature adult features");
    expect(prompt).toContain("brunette wavy hair");
    expect(prompt).toContain("on a rooftop bar at night, red dress");
    expect(prompt).toContain("no nudity");
    expect(negativePrompt).toContain("nude");
    expect(negativePrompt).toContain("underage");
  });

  it("allows nudity only when explicit", () => {
    const { prompt, negativePrompt } = buildImagePrompt({ subject, scene: "in bed, morning light", explicit: true });
    expect(prompt).toContain("nudity allowed");
    expect(negativePrompt).not.toMatch(/\bnude\b/);
    expect(negativePrompt).toContain("child");
    expect(negativePrompt).toContain("loli");
  });

  it("uses strong anime anchors for petite characters", () => {
    const { prompt } = buildImagePrompt({
      subject: { ...subject, style: "anime", body: "Petite", age: 20 },
      scene: "at a cafe",
      explicit: false,
    });
    expect(prompt).toContain("adult anime character, tall adult proportions, mature face");
    expect(prompt).toContain("mature female");
    expect(prompt).toContain("25-year-old");
  });

  it("never states an age under 18, whatever the record says", () => {
    const { prompt } = buildImagePrompt({ subject: { ...subject, age: 12 }, scene: "at home", explicit: false });
    expect(prompt).toContain("18-year-old");
    expect(prompt).not.toContain("12");
  });

  it("only puts list values from the stored look into the prompt", () => {
    expect(appearanceText({ ...subject, hair: " red ", hairStyle: "Slicked back" })).toBe(
      "latina, red slicked back hair, brown eyes, curvy, medium bust",
    );
    // A minor-coded look saved as free text, which character creation allowed
    // before it checked the lists.
    const minorCoded = {
      ...subject,
      style: "anime" as const,
      body: "Flat-chested tiny childish frame",
      hairStyle: "Pigtails with hair ribbons",
      eyeColor: "big innocent eyes",
      breast: "Red<script>",
    };
    expect(appearanceText(minorCoded)).toBe("latina, brunette hair");
    for (const explicit of [false, true]) {
      const { prompt } = buildImagePrompt({ subject: minorCoded, scene: "at a cafe", explicit });
      for (const word of ["flat", "tiny", "childish", "pigtails", "ribbons", "innocent", "script"]) {
        expect(prompt).not.toContain(word);
      }
    }
  });

  it("keeps the official catalog's looks", () => {
    for (const person of SEED_CHARACTERS) {
      const looks = appearanceText({ ...person, style: "realistic" });
      expect(looks, person.id).toContain(person.ethnicity.toLowerCase());
      expect(looks, person.id).toContain(person.body.toLowerCase());
    }
  });

  it("never puts the character's name into the prompt", () => {
    const { prompt } = buildImagePrompt({ subject: { ...subject, name: "Yuki" }, scene: "at a cafe", explicit: true });
    expect(prompt).not.toMatch(/yuki/i);
  });
});

// Every image shows one person: chat photos, studio frames, nude portraits and
// creator portraits all carry the other-people negatives, in words the worker
// accepts (never naming an adult or an age).
describe("other people in the negative prompt", () => {
  const subject: ImageSubject = { name: "Mira", age: 27, gender: "Woman", style: "realistic" };
  const negatives = [
    ...[false, true].flatMap((explicit) =>
      (["realistic", "anime"] as const).flatMap((style) =>
        ["Woman", "Man", "Non-binary"].map((gender) => buildImagePrompt({ subject: { ...subject, style, gender }, scene: "in bed", explicit }).negativePrompt),
      ),
    ),
    portraitPrompt(request({})).negativePrompt,
    portraitPrompt(request({ style: "anime" }), { suggestive: true }).negativePrompt,
    portraitPrompt(portraitRequest(guy)!).negativePrompt,
  ];

  it("are in every image prompt", () => {
    for (const negativePrompt of negatives) {
      for (const term of OTHER_PEOPLE_NEGATIVE) expect(negativePrompt, term).toContain(term);
    }
  });

  it("never name an adult", () => {
    for (const term of OTHER_PEOPLE_NEGATIVE) {
      expect(term).not.toMatch(/\b(?:woman|women|man|men|adult|mature|lady|ladies|mother|wife|older)\b|\d+\s*-?\s*(?:yo|years?)/);
    }
  });
});

// Roughly how many CLIP tokens text uses: one per word and one per punctuation
// mark, with each digit on its own as CLIP splits numbers. Real BPE never uses
// fewer and splits rare words (shota, genitals) into several, so the checks
// below leave 10 tokens of headroom under the 75 that SDXL's encoders read.
const CLIP_BUDGET = 65;

function clipTokensThrough(prompt: string, tag: string) {
  const tags = prompt.split(", ");
  const at = tags.indexOf(tag);
  expect(at, `"${tag}" in ${prompt}`).toBeGreaterThanOrEqual(0);
  return (tags.slice(0, at + 1).join(", ").match(/\p{L}+|\p{N}|[^\s\p{L}\p{N}]/gu) ?? []).length;
}

describe("anime prompts within SDXL's token window", () => {
  const MINOR_TERMS = [
    "petite child",
    "small child",
    "female child",
    "male child",
    "huge eyes",
    "big head",
    "short limbs",
    "child",
    "teen",
    "underage",
    "loli",
    "shota",
    "chibi",
    "aged down",
    "school uniform",
    "childlike proportions",
    "baby face",
    "young-looking",
  ];
  const NUDITY_TERMS = ["nude", "nudity", "naked", "topless", "nipples", "genitals", "sex", "explicit"];

  // Petite and small get the longest anchors, and two-digit ages the most tokens.
  const petite = request({ style: "anime", body: "Petite", breast: "Small", age: 19, kinks: ["Lingerie"] });
  const subject: ImageSubject = { name: "Aya", age: 19, gender: "Woman", style: "anime", body: "Petite", breast: "Small" };
  const cases = [
    { label: "portrait", ...portraitPrompt(petite), rating: "safe", allowNudity: false },
    { label: "suggestive portrait", ...portraitPrompt(petite, { suggestive: true }), rating: "sensitive", allowNudity: false },
    { label: "male portrait", ...portraitPrompt(portraitRequest({ ...guy, style: "anime", body: "Slim" })!), rating: "safe", allowNudity: false },
    { label: "chat photo", ...buildImagePrompt({ subject, scene: "at a cafe", explicit: false }), rating: "sensitive", allowNudity: false },
    { label: "explicit chat photo", ...buildImagePrompt({ subject, scene: "in bed", explicit: true }), rating: "explicit", allowNudity: true },
  ];

  it.each(cases)("$label: rating tag first, then the adult anchors", ({ prompt, rating }) => {
    expect(prompt).toMatch(new RegExp(`^1(girl|boy), solo, ${rating}, adult anime character, `));
    expect(clipTokensThrough(prompt, "adult height")).toBeLessThanOrEqual(CLIP_BUDGET);
  });

  it.each(cases)("$label: minor and nudity terms first in the negative prompt", ({ negativePrompt, allowNudity }) => {
    expect(negativePrompt.startsWith("petite child, ")).toBe(true);
    for (const term of [...MINOR_TERMS, ...(allowNudity ? [] : NUDITY_TERMS)]) {
      expect(clipTokensThrough(negativePrompt, term), term).toBeLessThanOrEqual(CLIP_BUDGET);
    }
    if (allowNudity) expect(negativePrompt.split(", ")).not.toContain("nude");
  });
});
