// Turns creator choices and character records into image prompts. Shared by the
// portrait and chat-photo routes, character creation and the creator page, so it
// has no server imports.
//
// Every prompt carries explicit adult anchors and every negative prompt names the
// things we never draw. These steer the model; they are not the safety check.
// Every generated image still goes through image moderation before it is stored.

// The creator's options. A character's look can only be one of these, because
// the look goes into every image prompt.
export const STYLES = ["realistic", "anime"] as const;
export const ETHNICITIES = ["Caucasian", "Asian", "Latina", "Latino", "Black"] as const;
export const HAIR_COLORS = ["Blonde", "Brunette", "Black", "Red"] as const;
export const HAIR_STYLES = [
  "Straight",
  "Wavy",
  "Curly",
  "Coily",
  "Long",
  "Short",
  "Ponytail",
  "Bun",
  "Medium",
  "Buzz",
  "Undercut",
  "Slicked back",
] as const;
export const EYE_COLORS = ["Brown", "Hazel", "Green", "Blue", "Gray", "Amber"] as const;
export const GIRL_BODIES = ["Petite", "Athletic", "Curvy", "Thick"] as const;
export const GUY_BODIES = ["Slim", "Athletic", "Muscular", "Soft"] as const;
export const BREASTS = ["Small", "Medium", "Large"] as const;
export const PERSONALITIES = ["Submissive", "Dominant", "Sweet", "Bratty", "Playful", "Cold"] as const;
export const ROLES = ["Girlfriend", "Boyfriend", "Stranger", "Exclusive", "Friends with benefits"] as const;
export const JOBS = ["Designer", "Bartender", "Nurse", "Model", "Chef", "Photographer", "Dancer", "Founder"] as const;
export const KINKS = ["Praise", "Teasing", "Dominance", "Submission", "Lingerie", "Possessive"] as const;

// Looks the official catalog uses that the creator doesn't offer.
const CATALOG_ETHNICITIES = ["East Asian", "South Asian", "Arab", "Mixed"];
const CATALOG_BODIES = ["Lean", "Tall"];

type Of<List extends readonly string[]> = List[number];

export type PortraitRequest = {
  section: "girls" | "guys";
  style: Of<typeof STYLES>;
  ethnicity: Of<typeof ETHNICITIES>;
  age: number;
  hair: Of<typeof HAIR_COLORS>;
  hairStyle: Of<typeof HAIR_STYLES>;
  eyeColor: Of<typeof EYE_COLORS>;
  body: Of<typeof GIRL_BODIES> | Of<typeof GUY_BODIES>;
  breast?: Of<typeof BREASTS>;
  personality: Of<typeof PERSONALITIES>;
  role: Of<typeof ROLES>;
  occupation: Of<typeof JOBS>;
  kinks: Of<typeof KINKS>[];
};

export type ImagePrompt = { prompt: string; negativePrompt: string };

export function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const MIN_AGE = 18;
export const MAX_AGE = 80;

// Anime models drift young, most of all with small or petite figures. In those
// cases the prompt states an older age than the slider and leans on mature tags.
const ANIME_STRONG_MIN_AGE = 25;

const ANIME_MOOD: Record<string, string> = {
  Submissive: "shy smile",
  Dominant: "confident look",
  Sweet: "warm smile",
  Bratty: "smirk",
  Playful: "playful smile",
  Cold: "cool expression",
};

const EXPRESSIONS: Record<string, string> = {
  Submissive: "soft expression, gentle eyes, slight shy smile",
  Dominant: "confident direct gaze, composed intense expression",
  Sweet: "warm genuine smile, kind eyes",
  Bratty: "teasing smirk, one eyebrow slightly raised",
  Playful: "bright playful smile, lively eyes",
  Cold: "cool distant expression, calm eyes",
};

const BODY_LOOK: Record<string, string> = {
  Petite: "petite adult frame",
  Athletic: "athletic toned build",
  Curvy: "curvy figure",
  Thick: "thick full figure",
  Slim: "slim build",
  Muscular: "muscular build",
  Soft: "soft build",
};

const BUST: Record<string, string> = {
  Small: "small bust",
  Medium: "medium bust",
  Large: "large bust",
};

// Anime models know skin tone better than ethnicity words.
const ANIME_SKIN: Record<string, string> = {
  black: "dark skin",
  latina: "tan skin",
  latino: "tan skin",
};

const QUALITY_NEGATIVE = [
  "lowres",
  "bad anatomy",
  "bad hands",
  "extra digits",
  "fewer digits",
  "missing fingers",
  "deformed",
  "blurry",
  "jpeg artifacts",
  "text",
  "watermark",
  "signature",
  "username",
  "logo",
  "worst quality",
  "low quality",
];

// What we never draw, in words the image models were trained on. Kept short so
// it fits the anime model's token window (see negative()).
const MINOR_NEGATIVE = [
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

const ANIME_MINOR_NEGATIVE = ["petite child", "small child", "female child", "male child", "huge eyes", "big head", "short limbs"];

const REAL_PERSON_NEGATIVE = ["celebrity", "famous person", "real person likeness"];

const NUDITY_NEGATIVE = ["nude", "nudity", "naked", "topless", "nipples", "genitals", "sex", "explicit"];

function list(...parts: (string | null | undefined | false)[]) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(", ");
}

// SDXL's text encoders read only the first 75 tokens unless the worker encodes
// long prompts, so the terms that matter most come first.
function negative(style: "realistic" | "anime", allowNudity: boolean) {
  return list(
    ...(style === "anime" ? ANIME_MINOR_NEGATIVE : []),
    ...(allowNudity ? [] : NUDITY_NEGATIVE),
    ...MINOR_NEGATIVE,
    ...REAL_PERSON_NEGATIVE,
    ...QUALITY_NEGATIVE,
  );
}

export function portraitRequest(input: unknown): PortraitRequest | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const { section, style, ethnicity, hair, hairStyle, eyeColor, body, breast, personality, role, occupation, kinks } = raw;
  const age = Number(raw.age);
  if (section !== "girls" && section !== "guys") return null;
  if (!oneOf(STYLES, style) || !Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return null;
  if (!oneOf(ETHNICITIES, ethnicity) || !oneOf(HAIR_COLORS, hair) || !oneOf(HAIR_STYLES, hairStyle)) return null;
  if (!oneOf(EYE_COLORS, eyeColor) || !oneOf(section === "girls" ? GIRL_BODIES : GUY_BODIES, body)) return null;
  if (!oneOf(PERSONALITIES, personality) || !oneOf(ROLES, role) || !oneOf(JOBS, occupation)) return null;
  if (!Array.isArray(kinks) || kinks.length > 3 || !kinks.every((kink) => oneOf(KINKS, kink))) return null;

  let bust: PortraitRequest["breast"];
  if (section === "girls") {
    if (!oneOf(BREASTS, breast)) return null;
    bust = breast;
  }

  return { section, style, ethnicity, age, hair, hairStyle, eyeColor, body, breast: bust, personality, role, occupation, kinks };
}

function needsStrongAnchors(style: string, body?: string | null, breast?: string | null) {
  if (style !== "anime") return false;
  const figure = `${body ?? ""} ${breast ?? ""}`.toLowerCase();
  return /\b(petite|small|slim|slender|tiny|short|lean)\b/.test(figure);
}

function animeAnchors(person: "woman" | "man" | "person", age: number, strong: boolean) {
  const mature = person === "man" ? "mature male" : person === "woman" ? "mature female" : "mature adult";
  const stated = strong ? Math.max(age, ANIME_STRONG_MIN_AGE) : age;
  return list(
    "adult anime character",
    "tall adult proportions",
    "mature face",
    `adult ${person}, ${stated}-year-old`,
    strong && mature,
    strong && "clearly adult body, long legs, defined adult facial features, adult height",
  );
}

function realisticAnchors(person: string, age: number, ethnicity: string) {
  return list(`adult, ${age}-year-old ${ethnicity} ${person}`.replace(/\s+/g, " "), "mature adult features");
}

// Creator portraits are the character's public face, so they stay clothed.
// Lingerie only shows up for verified users who turned explicit content on.
export function portraitPrompt(choice: PortraitRequest, options: { suggestive?: boolean } = {}): ImagePrompt {
  const person = choice.section === "girls" ? "woman" : "man";
  const hair = `${choice.hair.toLowerCase()} ${choice.hairStyle.toLowerCase()} hair`;
  const eyes = `${choice.eyeColor.toLowerCase()} eyes`;
  const bust = choice.section === "girls" && choice.breast ? BUST[choice.breast] : null;
  const lingerie = options.suggestive && choice.kinks.includes("Lingerie");
  const outfit = lingerie
    ? "elegant lace lingerie under an open silk robe"
    : choice.section === "girls"
      ? "fitted casual top"
      : "simple fitted shirt";

  if (choice.style === "anime") {
    const strong = needsStrongAnchors("anime", choice.body, choice.breast);
    const skin = ANIME_SKIN[choice.ethnicity.toLowerCase()];
    return {
      // The rating tag and adult anchors come first, inside SDXL's 75 tokens.
      prompt: list(
        choice.section === "girls" ? "1girl" : "1boy",
        "solo",
        lingerie ? "sensitive" : "safe",
        animeAnchors(person, choice.age, strong),
        `${choice.ethnicity} ${person}`,
        skin,
        hair,
        eyes,
        choice.body.toLowerCase(),
        bust,
        outfit,
        ANIME_MOOD[choice.personality] ?? "calm expression",
        "upper body, looking at viewer, simple background",
        "anime coloring, clean lineart",
        "masterpiece, high score, great score, absurdres",
      ),
      negativePrompt: negative("anime", false),
    };
  }

  return {
    prompt: list(
      "photorealistic portrait photograph, natural skin texture, soft natural light, 85mm lens",
      realisticAnchors(person, choice.age, choice.ethnicity),
      hair,
      eyes,
      BODY_LOOK[choice.body] ?? choice.body.toLowerCase(),
      bust,
      outfit,
      EXPRESSIONS[choice.personality] ?? "natural expression",
      "upper body, looking at the camera, bare head, no hat",
      "softly blurred background",
    ),
    negativePrompt: negative("realistic", false),
  };
}

// What a chat photo needs to know about the character. Fields come from the
// database: official characters were seeded and user characters were validated
// on creation, but only values from the lists above ever reach a prompt.
export type ImageSubject = {
  name: string;
  age: number;
  gender: string;
  style: "realistic" | "anime";
  ethnicity?: string | null;
  body?: string | null;
  hair?: string | null;
  hairStyle?: string | null;
  eyeColor?: string | null;
  breast?: string | null;
};

// A stored value in prompt words if it is on the list, otherwise nothing, so no
// free text (an older row, a hand edit) can reach the model.
function known(list: readonly string[], value: string | null | undefined) {
  const wanted = (value ?? "").trim().toLowerCase();
  return list.find((item) => item.toLowerCase() === wanted)?.toLowerCase() ?? "";
}

function personOf(gender: string): "woman" | "man" | "person" {
  const value = gender.toLowerCase();
  if (/\b(woman|female|girl)\b/.test(value)) return "woman";
  if (/\b(man|male|guy)\b/.test(value)) return "man";
  return "person";
}

// The character's look in words, without the scene. Also what the photo route
// screens before anything reaches the model.
export function appearanceText(subject: ImageSubject) {
  const hair = [known(HAIR_COLORS, subject.hair), known(HAIR_STYLES, subject.hairStyle)].filter(Boolean).join(" ");
  const eyes = known(EYE_COLORS, subject.eyeColor);
  const bust = known(BREASTS, subject.breast);
  return list(
    known([...ETHNICITIES, ...CATALOG_ETHNICITIES], subject.ethnicity),
    hair && `${hair} hair`,
    eyes && `${eyes} eyes`,
    known([...GIRL_BODIES, ...GUY_BODIES, ...CATALOG_BODIES], subject.body),
    bust && `${bust} bust`,
  );
}

// A chat photo: the character's appearance in a scene from the conversation.
// Explicit only when the caller has checked the user may see explicit content.
export function buildImagePrompt({
  subject,
  scene,
  explicit,
}: {
  subject: ImageSubject;
  scene: string;
  explicit: boolean;
}): ImagePrompt {
  const person = personOf(subject.gender);
  const age = Math.max(MIN_AGE, Math.round(subject.age));
  const looks = appearanceText(subject);
  const where = scene.replace(/\s+/g, " ").trim().slice(0, 400);
  const mood = explicit
    ? "intimate adult photo, nudity allowed"
    : "tasteful, clothed or implied, no nudity, nothing explicit";

  if (subject.style === "anime") {
    const strong = needsStrongAnchors("anime", subject.body, subject.breast);
    return {
      prompt: list(
        person === "man" ? "1boy" : person === "woman" ? "1girl" : "1other",
        "solo",
        explicit ? "explicit" : "sensitive",
        animeAnchors(person, age, strong),
        looks,
        where,
        mood,
        "anime coloring, clean lineart",
        "masterpiece, high score, great score, absurdres",
      ),
      negativePrompt: negative("anime", explicit),
    };
  }

  return {
    prompt: list(
      "photorealistic photograph, natural skin texture, real camera photo",
      realisticAnchors(person, age, ""),
      looks,
      where,
      mood,
      "only one person in frame",
    ),
    negativePrompt: negative("realistic", explicit),
  };
}
