export type PortraitRequest = {
  section: "girls" | "guys";
  style: "realistic" | "anime";
  ethnicity: string;
  age: number;
  hair: string;
  body: string;
  breast?: string;
  personality: string;
  role: string;
  occupation: string;
  kinks: string[];
};

const ETHNICITIES = ["Caucasian", "Asian", "Latina", "Latino", "Black"];
const HAIR = ["Blonde", "Brunette", "Black", "Red"];
const GIRL_BODIES = ["Petite", "Athletic", "Curvy", "Thick"];
const GUY_BODIES = ["Slim", "Athletic", "Muscular", "Soft"];
const BREASTS = ["Small", "Medium", "Large"];
const PERSONALITIES = ["Submissive", "Dominant", "Sweet", "Bratty", "Playful", "Cold"];
const ROLES = ["Girlfriend", "Boyfriend", "Stranger", "Exclusive", "Friends with benefits"];
const JOBS = ["Designer", "Bartender", "Nurse", "Model", "Chef", "Photographer", "Dancer", "Founder"];
const KINKS = ["Praise", "Teasing", "Dominance", "Submission", "Lingerie", "Possessive"];

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
  Petite: "petite frame",
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

export function portraitRequest(input: unknown): PortraitRequest | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const section = raw.section === "guys" ? "guys" : raw.section === "girls" ? "girls" : null;
  const style = raw.style === "anime" ? "anime" : raw.style === "realistic" ? "realistic" : null;
  const age = Number(raw.age);
  if (!section || !style || !Number.isInteger(age) || age < 18 || age > 80) return null;
  if (typeof raw.ethnicity !== "string" || !ETHNICITIES.includes(raw.ethnicity)) return null;
  if (typeof raw.hair !== "string" || !HAIR.includes(raw.hair)) return null;
  const bodies = section === "girls" ? GIRL_BODIES : GUY_BODIES;
  if (typeof raw.body !== "string" || !bodies.includes(raw.body)) return null;
  if (typeof raw.personality !== "string" || !PERSONALITIES.includes(raw.personality)) return null;
  if (typeof raw.role !== "string" || !ROLES.includes(raw.role)) return null;
  if (typeof raw.occupation !== "string" || !JOBS.includes(raw.occupation)) return null;
  if (!Array.isArray(raw.kinks) || raw.kinks.length > 3) return null;
  if (!raw.kinks.every((kink) => typeof kink === "string" && KINKS.includes(kink))) return null;

  let breast: string | undefined;
  if (section === "girls") {
    if (typeof raw.breast !== "string" || !BREASTS.includes(raw.breast)) return null;
    breast = raw.breast;
  }

  return {
    section,
    style,
    ethnicity: raw.ethnicity,
    age,
    hair: raw.hair,
    body: raw.body,
    breast,
    personality: raw.personality,
    role: raw.role,
    occupation: raw.occupation,
    kinks: raw.kinks as string[],
  };
}

export function portraitPrompt(choice: PortraitRequest): string {
  const person = choice.section === "girls" ? "woman" : "man";
  const ageLine = choice.age >= 39 ? "adult in their early forties" : `${choice.age} year old adult`;
  const hair = choice.hair.toLowerCase();
  const figure = [
    BODY_LOOK[choice.body] ?? choice.body,
    choice.section === "girls" && choice.breast ? BUST[choice.breast] : null,
  ]
    .filter(Boolean)
    .join(", ");
  const outfit = choice.kinks.includes("Lingerie") ? "lingerie" : "simple shirt";
  const expression = EXPRESSIONS[choice.personality] ?? "natural expression";

  // The free model is a photo checkpoint. It draws any camera or anatomy-study
  // wording, so anime stays a short ink-and-cel line and never mentions photos.
  if (choice.style === "anime") {
    const animeBody = [
      choice.body.toLowerCase(),
      choice.section === "girls" && choice.breast ? BUST[choice.breast] : null,
    ]
      .filter(Boolean)
      .join(", ");
    return [
      "anime screencap, 2d drawn frame, thick black outlines, flat colors",
      `one ${ageLine} ${choice.ethnicity} anime ${person}`,
      `${hair} hair`,
      animeBody,
      outfit,
      ANIME_MOOD[choice.personality] ?? "calm expression",
      "bare head, no hat",
      "upper body",
      "thick black outlines, flat colors",
    ].join(", ");
  }

  return [
    "photorealistic photograph, natural skin, real camera photo",
    `one ${ageLine} ${choice.ethnicity} ${person}`,
    `${hair} hair`,
    figure,
    outfit,
    expression,
    "bare head no hat",
    "upper body",
  ].join(", ");
}
