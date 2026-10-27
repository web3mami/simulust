import { JOBS, KINKS, PERSONALITIES, type PortraitRequest } from "@/lib/portrait-prompt";
import { VOICES as VOICE_LIST } from "@/lib/voices";

// Everything the character creator offers. Every option is typed against the
// lists the portrait and character routes accept (src/lib/portrait-prompt.ts),
// so the page can only send values the server takes.

export type Section = "girls" | "guys";
export type Style = "realistic" | "anime";
export type Step = "style" | "look" | "body" | "personality" | "relationship" | "voice" | "portrait";

export const STEPS: Step[] = ["style", "look", "body", "personality", "relationship", "voice", "portrait"];

export const STEP_LABELS: Record<Step, string> = {
  style: "Style",
  look: "Look",
  body: "Body",
  personality: "Personality",
  relationship: "Relationship & kinks",
  voice: "Voice & name",
  portrait: "Portrait",
};

export { JOBS, KINKS, PERSONALITIES };

export const GIRL_NAMES = ["Elena Voss", "Maren Cole", "Camille Ortiz", "Priya Shah", "Ingrid Hale"];
export const GUY_NAMES = ["Adrian Cole", "Marco Diaz", "Julian Park", "Malik Grant", "Kenji Mori"];

export const GIRL_ROLES: PortraitRequest["role"][] = ["Girlfriend", "Stranger", "Exclusive", "Friends with benefits"];
export const GUY_ROLES: PortraitRequest["role"][] = ["Boyfriend", "Stranger", "Exclusive", "Friends with benefits"];

// The labels are what the server stores (src/lib/voices.ts).
export const VOICES: { id: string; description: string; tone: "Feminine" | "Masculine" }[] = VOICE_LIST.map((voice) => ({
  id: voice.label,
  description: voice.description,
  tone: voice.gender === "female" ? "Feminine" : "Masculine",
}));

export const DEFAULT_VOICE: Record<Section, string> = { girls: "Voice 1", guys: "Voice 4" };

export const MIN_AGE = 18;
export const MAX_AGE = 39;
export const clampAge = (value: number) =>
  Math.min(MAX_AGE, Math.max(MIN_AGE, Math.round(Number.isFinite(value) ? value : MIN_AGE)));
export const ageLabel = (age: number) => (age >= MAX_AGE ? `${MAX_AGE}+` : `${age}`);

// The same rule the character route enforces.
export { NAME_MAX, NAME_RULE, nameProblem } from "@/lib/names";

type Option<Field extends keyof PortraitRequest> = { id: NonNullable<PortraitRequest[Field]>; src: string };

export const GIRL_ETHNICITY: (Option<"ethnicity"> & { realistic: string })[] = [
  { id: "Caucasian", src: "/creator/eth-girl-anime-caucasian.jpg", realistic: "/characters/june.jpg" },
  { id: "Asian", src: "/creator/eth-girl-anime-asian.jpg", realistic: "/characters/aiko.jpg" },
  { id: "Latina", src: "/creator/eth-girl-anime-latina.jpg", realistic: "/characters/lucia.jpg" },
  { id: "Black", src: "/creator/eth-girl-anime-black.jpg", realistic: "/characters/amara.jpg" },
];

export const GUY_ETHNICITY: (Option<"ethnicity"> & { realistic: string })[] = [
  { id: "Caucasian", src: "/creator/eth-guy-anime-caucasian.jpg", realistic: "/creator/eth-guy-realistic-caucasian.jpg" },
  { id: "Asian", src: "/creator/eth-guy-anime-asian.jpg", realistic: "/creator/eth-guy-realistic-asian.jpg" },
  { id: "Latino", src: "/creator/eth-guy-anime-latino.jpg", realistic: "/creator/eth-guy-realistic-latino.jpg" },
  { id: "Black", src: "/creator/eth-guy-anime-black.jpg", realistic: "/creator/eth-guy-realistic-black.jpg" },
];

export const HAIR: (Option<"hair"> & { swatch: string })[] = [
  { id: "Blonde", src: "/creator/hair-blonde.jpg", swatch: "#e6c27a" },
  { id: "Brunette", src: "/creator/hair-brunette.jpg", swatch: "#6e4529" },
  { id: "Black", src: "/creator/hair-black.jpg", swatch: "#17161a" },
  { id: "Red", src: "/creator/hair-red.jpg", swatch: "#b4432a" },
];

export const GUY_HAIR: Record<Style, Record<string, string>> = {
  realistic: {
    Blonde: "/creator/hair-guy-real-blonde.jpg",
    Brunette: "/creator/hair-guy-real-brunette.jpg",
    Black: "/creator/hair-guy-real-black.jpg",
    Red: "/creator/hair-guy-real-red.jpg",
  },
  anime: {
    Blonde: "/creator/hair-guy-anime-blonde.jpg",
    Brunette: "/creator/hair-guy-anime-brunette.jpg",
    Black: "/creator/hair-guy-anime-black.jpg",
    Red: "/creator/hair-guy-anime-red.jpg",
  },
};

export const GIRL_HAIR_STYLES: (Option<"hairStyle"> & { anime: string })[] = [
  { id: "Straight", src: "/creator/hair-style-girl-straight.jpg", anime: "/creator/hair-style-girl-anime-straight.jpg" },
  { id: "Wavy", src: "/creator/hair-style-girl-wavy.jpg", anime: "/creator/hair-style-girl-anime-wavy.jpg" },
  { id: "Curly", src: "/creator/hair-style-girl-curly.jpg", anime: "/creator/hair-style-girl-anime-curly.jpg" },
  { id: "Coily", src: "/creator/hair-style-girl-coily.jpg", anime: "/creator/hair-style-girl-anime-coily.jpg" },
  { id: "Long", src: "/creator/hair-style-girl-long.jpg", anime: "/creator/hair-style-girl-anime-long.jpg" },
  { id: "Short", src: "/creator/hair-style-girl-short.jpg", anime: "/creator/hair-style-girl-anime-short.jpg" },
  { id: "Ponytail", src: "/creator/hair-style-girl-ponytail.jpg", anime: "/creator/hair-style-girl-anime-ponytail.jpg" },
  { id: "Bun", src: "/creator/hair-style-girl-bun.jpg", anime: "/creator/hair-style-girl-anime-bun.jpg" },
];

export const GUY_HAIR_STYLES: (Option<"hairStyle"> & { anime: string })[] = [
  { id: "Short", src: "/creator/hair-style-guy-short.jpg", anime: "/creator/hair-style-guy-anime-short.jpg" },
  { id: "Medium", src: "/creator/hair-style-guy-medium.jpg", anime: "/creator/hair-style-guy-anime-medium.jpg" },
  { id: "Long", src: "/creator/hair-style-guy-long.jpg", anime: "/creator/hair-style-guy-anime-long.jpg" },
  { id: "Wavy", src: "/creator/hair-style-guy-wavy.jpg", anime: "/creator/hair-style-guy-anime-wavy.jpg" },
  { id: "Curly", src: "/creator/hair-style-guy-curly.jpg", anime: "/creator/hair-style-guy-anime-curly.jpg" },
  { id: "Buzz", src: "/creator/hair-style-guy-buzz.jpg", anime: "/creator/hair-style-guy-anime-buzz.jpg" },
  { id: "Undercut", src: "/creator/hair-style-guy-undercut.jpg", anime: "/creator/hair-style-guy-anime-undercut.jpg" },
  { id: "Slicked back", src: "/creator/hair-style-guy-slicked.jpg", anime: "/creator/hair-style-guy-anime-slicked.jpg" },
];

export const EYE_COLORS: (Option<"eyeColor"> & { swatch: string })[] = [
  { id: "Brown", src: "/creator/eye-brown.jpg", swatch: "#6b4325" },
  { id: "Hazel", src: "/creator/eye-hazel.jpg", swatch: "#8a7a3c" },
  { id: "Green", src: "/creator/eye-green.jpg", swatch: "#3f8a55" },
  { id: "Blue", src: "/creator/eye-blue.jpg", swatch: "#4a7fc0" },
  { id: "Gray", src: "/creator/eye-gray.jpg", swatch: "#8b95a1" },
  { id: "Amber", src: "/creator/eye-amber.jpg", swatch: "#c98a2b" },
];

// The art is head and shoulders, so each body type also says what it means.
export const BODIES: (Option<"body"> & { detail: string })[] = [
  { id: "Petite", src: "/creator/body-petite.jpg", detail: "Small and slim" },
  { id: "Athletic", src: "/creator/body-athletic.jpg", detail: "Toned and fit" },
  { id: "Curvy", src: "/creator/body-curvy.jpg", detail: "Full hips and bust" },
  { id: "Thick", src: "/creator/body-thick.jpg", detail: "Soft and full-figured" },
];

export const GUY_BODIES: (Option<"body"> & { detail: string })[] = [
  { id: "Slim", src: "/creator/body-guy-slim.jpg", detail: "Lean frame" },
  { id: "Athletic", src: "/creator/body-guy-athletic.jpg", detail: "Toned and fit" },
  { id: "Muscular", src: "/creator/body-guy-muscular.jpg", detail: "Big and built" },
  { id: "Soft", src: "/creator/body-guy-soft.jpg", detail: "Broad and cuddly" },
];

export const BREASTS: Option<"breast">[] = [
  { id: "Small", src: "/creator/breast-small.jpg" },
  { id: "Medium", src: "/creator/breast-medium.jpg" },
  { id: "Large", src: "/creator/breast-large.jpg" },
];

export const STYLE_CARDS: Record<Section, { id: Style; label: string; detail: string; src: string }[]> = {
  girls: [
    { id: "realistic", label: "Realistic", detail: "Lifelike, like a photo", src: "/creator/style-girl-realistic.jpg" },
    { id: "anime", label: "Anime", detail: "Drawn, anime style", src: "/creator/style-girl-anime.jpg" },
  ],
  guys: [
    { id: "realistic", label: "Realistic", detail: "Lifelike, like a photo", src: "/creator/style-guy-realistic.jpg" },
    { id: "anime", label: "Anime", detail: "Drawn, anime style", src: "/creator/style-guy-anime.jpg" },
  ],
};

// Poses the style cards crossfade through, so each style shows a little
// movement. Five each keeps the download small; the card's own picture is first.
export const STYLE_FRAMES: Record<Section, Record<Style, string[]>> = {
  girls: {
    realistic: [
      "/creator/style-girl-realistic.jpg",
      "/creator/loop-girl-real-2.jpg",
      "/creator/loop-girl-real-3.jpg",
      "/creator/loop-girl-real-4.jpg",
      "/creator/loop-girl-real-5.jpg",
    ],
    anime: [
      "/creator/style-girl-anime.jpg",
      "/creator/loop-girl-anime-2.jpg",
      "/creator/loop-girl-anime-3.jpg",
      "/creator/loop-girl-anime-4.jpg",
      "/creator/loop-girl-anime-5.jpg",
    ],
  },
  guys: {
    realistic: [
      "/creator/style-guy-realistic.jpg",
      "/creator/loop-guy-real-2.jpg",
      "/creator/loop-guy-real-3.jpg",
      "/creator/loop-guy-real-4.jpg",
      "/creator/loop-guy-real-5.jpg",
    ],
    anime: [
      "/creator/style-guy-anime.jpg",
      "/creator/loop-guy-anime-2.jpg",
      "/creator/loop-guy-anime-3.jpg",
      "/creator/loop-guy-anime-4.jpg",
      "/creator/loop-guy-anime-5.jpg",
    ],
  },
};

export const PERSONALITY_INFO: Record<(typeof PERSONALITIES)[number], string> = {
  Submissive: "Eager to please and happy to follow your lead.",
  Dominant: "Takes charge and says exactly what they want.",
  Sweet: "Warm, caring and openly affectionate.",
  Bratty: "Teasing and defiant, loves pushing your buttons.",
  Playful: "Flirty, quick and always up for a joke.",
  Cold: "Distant at first. You have to win them over.",
};

export const ROLE_INFO: Record<PortraitRequest["role"], string> = {
  Girlfriend: "Already together, and it shows.",
  Boyfriend: "Already together, and it shows.",
  Stranger: "You've only just met.",
  Exclusive: "Committed, and only into you.",
  "Friends with benefits": "Close friends who cross the line.",
};
