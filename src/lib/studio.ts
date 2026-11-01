// The Video Studio's scene presets, shared by the /studio page and
// POST /api/studio/frame. The server only accepts these ids, so the prompt
// words below are the only scene text that reaches the image model besides the
// user's short, screened "details".
//
// Every fragment describes ONE fictional adult, alone: no other people, no
// props or places that read young. A test runs each one through
// checkImagePrompt, the same screen the worker mirrors, so a change that trips
// it fails before it ships.

import { COSTS } from "@/lib/pricing";

export type StudioOption = {
  id: string;
  label: string;
  // One short line under the label.
  blurb: string;
  // Shows nudity: the keyframe prompt drops its nudity negatives only for
  // these. Every confirmed adult can pick them; there's no explicit switch.
  nudity?: boolean;
};

export type SettingOption = StudioOption & {
  // Scene words for the keyframe.
  prompt: string;
  // A soft gradient for the tile, so the picker reads as moods at a glance.
  tone: [string, string];
};

export type OutfitOption = StudioOption & {
  // How the character is dressed, by who they are. "person" covers anyone
  // who isn't plainly a woman or a man.
  prompt: { woman: string; man: string; person: string };
  // A different label for men where the word differs ("Underwear").
  labelMan?: string;
};

export type ActionOption = StudioOption & {
  // The pose held in the keyframe, so the clip starts where the motion does.
  pose: string;
  // What the video does, sent to POST /api/media/[id]/animate as its prompt.
  motion: string;
};

export const STUDIO_SETTINGS = [
  {
    id: "bedroom",
    label: "Bedroom",
    blurb: "Soft sheets, warm lamp light",
    prompt: "in a softly lit bedroom, rumpled white linen sheets, warm bedside lamp glow",
    tone: ["#7a3b2e", "#e0a46a"],
  },
  {
    id: "shower",
    label: "Rain shower",
    blurb: "Glass, steam and warm water",
    prompt: "in a glass-walled rain shower, rising steam, water droplets on the glass, warm tiled bathroom light",
    tone: ["#1f4a57", "#8fc7d1"],
  },
  {
    id: "bath",
    label: "Candlelit bath",
    blurb: "Bubbles, candles, slow evening",
    prompt: "in a deep freestanding bathtub full of foam, candles along the rim, soft golden candlelight",
    tone: ["#5a3a1a", "#f0c27a"],
  },
  {
    id: "pool",
    label: "Private pool",
    blurb: "Turquoise water, bright sun",
    prompt: "at the edge of a private turquoise pool, bright summer sun, sparkling water",
    tone: ["#0f6b80", "#6fe0e8"],
  },
  {
    id: "beach",
    label: "Beach at sunset",
    blurb: "Golden hour, empty shore",
    prompt: "on an empty beach at sunset, golden backlight, gentle waves, warm sea breeze",
    tone: ["#b4483a", "#f7b267"],
  },
  {
    id: "hotel",
    label: "Hotel suite",
    blurb: "Velvet, city view, evening",
    prompt: "in a luxury hotel suite, velvet armchair, floor-to-ceiling windows, soft evening light",
    tone: ["#4a2a4f", "#c98bb9"],
  },
  {
    id: "penthouse",
    label: "Penthouse at night",
    blurb: "Skyline lights, low and moody",
    prompt: "in a penthouse at night, city skyline lights through tall windows, moody low light, deep shadows",
    tone: ["#141a3a", "#5763b8"],
  },
  {
    id: "lounge",
    label: "Fireside lounge",
    blurb: "Deep sofa, firelight",
    prompt: "on a deep velvet sofa in a dim lounge, flickering fireplace glow",
    tone: ["#4b1d1d", "#d9773f"],
  },
  {
    id: "mirror",
    label: "Dressing mirror",
    blurb: "Vanity bulbs, glamorous glow",
    prompt: "in front of a tall dressing mirror, vanity bulbs, soft glamorous light",
    tone: ["#5b4636", "#f3d9b1"],
  },
  {
    id: "yacht",
    label: "Yacht deck",
    blurb: "Open sea, late sun",
    prompt: "on the sun deck of a yacht, open sea, late afternoon sun, sea spray",
    tone: ["#163d63", "#9cc9ef"],
  },
] as const satisfies readonly SettingOption[];

export const STUDIO_OUTFITS = [
  {
    id: "dressed",
    label: "Dressed up",
    blurb: "Elegant, fitted, a little daring",
    prompt: {
      woman: "wearing an elegant fitted cocktail dress with a low back, heels",
      man: "wearing a tailored dark suit, crisp shirt open at the collar",
      person: "wearing an elegant fitted evening outfit",
    },
  },
  {
    id: "shirt",
    label: "Just a shirt",
    blurb: "An oversized shirt, bare legs",
    prompt: {
      woman: "wearing only an oversized white button-down shirt, bare legs",
      man: "wearing an unbuttoned white linen shirt and loose linen trousers",
      person: "wearing only an oversized white button-down shirt",
    },
  },
  {
    id: "lingerie",
    label: "Lingerie",
    labelMan: "Underwear",
    blurb: "Lace and silk",
    prompt: {
      woman: "wearing delicate black lace lingerie and a sheer silk robe",
      man: "wearing fitted black boxer briefs, bare chest",
      person: "wearing delicate black lace underwear and a sheer silk robe",
    },
  },
  {
    id: "swimwear",
    label: "Swimwear",
    blurb: "Made for the sun",
    prompt: {
      woman: "wearing a stylish string bikini",
      man: "wearing fitted swim shorts, bare chest",
      person: "wearing stylish swimwear",
    },
  },
  {
    id: "topless",
    label: "Topless",
    blurb: "Bare from the waist up",
    nudity: true,
    prompt: {
      woman: "topless, bare breasts, wearing only lace panties",
      man: "shirtless, bare chest, wearing only unbuttoned jeans",
      person: "topless, bare chest, wearing only lace underwear",
    },
  },
  {
    id: "nude",
    label: "Nude",
    blurb: "Nothing at all",
    nudity: true,
    prompt: {
      woman: "fully nude, natural body",
      man: "fully nude, natural body",
      person: "fully nude, natural body",
    },
  },
] as const satisfies readonly OutfitOption[];

export const STUDIO_ACTIONS = [
  {
    id: "tease",
    label: "Tease the camera",
    blurb: "A slow lean in, eyes on you",
    pose: "leaning toward the camera with a slow knowing smile, one hand in the hair",
    motion: "slowly leans toward the camera with a teasing smile, one hand gliding through the hair, holding eye contact",
  },
  {
    id: "undress",
    label: "Slow undress",
    blurb: "Straps slip, fabric falls",
    nudity: true,
    pose: "fingers hooked under a shoulder strap, about to slip it off, inviting gaze",
    motion: "slowly slides the straps off the shoulders and lets the clothing fall away, unhurried and sensual, steady eye contact",
  },
  {
    id: "stretch",
    label: "Stretch in bed",
    blurb: "Languid, arched, lazy morning",
    pose: "lying back, arms stretched above the head, relaxed and content",
    motion: "stretches languidly, arching the back with arms reaching overhead, then settles back with a contented smile",
  },
  {
    id: "water",
    label: "Under the water",
    blurb: "Water streaming down",
    pose: "eyes closed, face tilted up into falling water, wet hair slicked back",
    motion: "warm water streams over the shoulders and down the body, hands slowly smoothing wet hair back, steam drifting",
  },
  {
    id: "dance",
    label: "Slow dance",
    blurb: "Hips sway to the music",
    pose: "mid-sway, hips turned, arms raised loosely",
    motion: "sways the hips slowly to the music, turning gently, arms flowing, a playful glance over the shoulder",
  },
  {
    id: "kiss",
    label: "Blow a kiss",
    blurb: "A soft kiss your way",
    pose: "lips softly pursed toward the camera, playful eyes",
    motion: "blows a soft kiss toward the camera, then smiles and bites the lower lip",
  },
  {
    id: "walk",
    label: "Walk toward you",
    blurb: "Confident, unhurried steps",
    pose: "standing mid-step toward the camera, confident posture",
    motion: "walks slowly toward the camera with a confident sway, holding eye contact the whole way",
  },
  {
    id: "glance",
    label: "Over the shoulder",
    blurb: "A look back, a slow smile",
    pose: "back to the camera, looking back over the shoulder with a sultry smile",
    motion: "turns slowly to look back over the shoulder, a slow smile spreading, hair falling across the back",
  },
  {
    id: "caress",
    label: "Fingertips",
    blurb: "A slow trace along the skin",
    pose: "reclining on one side, fingertips resting on the collarbone, eyes half closed",
    motion: "trails fingertips slowly along the neck and collarbone, eyes half closed, breathing deep and slow",
  },
] as const satisfies readonly ActionOption[];

export type StudioSettingId = (typeof STUDIO_SETTINGS)[number]["id"];
export type StudioOutfitId = (typeof STUDIO_OUTFITS)[number]["id"];
export type StudioActionId = (typeof STUDIO_ACTIONS)[number]["id"];

export const STUDIO_SETTING_IDS = STUDIO_SETTINGS.map((option) => option.id) as [StudioSettingId, ...StudioSettingId[]];
export const STUDIO_OUTFIT_IDS = STUDIO_OUTFITS.map((option) => option.id) as [StudioOutfitId, ...StudioOutfitId[]];
export const STUDIO_ACTION_IDS = STUDIO_ACTIONS.map((option) => option.id) as [StudioActionId, ...StudioActionId[]];

export const STUDIO_DETAILS_MAX = 200;

// The keyframe is a photo; the clip is a video made from it.
export const STUDIO_COSTS = { frame: COSTS.photo, clip: COSTS.video } as const;

export function studioSetting(id: string): SettingOption | undefined {
  return STUDIO_SETTINGS.find((option) => option.id === id);
}

export function studioOutfit(id: string): OutfitOption | undefined {
  return STUDIO_OUTFITS.find((option) => option.id === id);
}

export function studioAction(id: string): ActionOption | undefined {
  return STUDIO_ACTIONS.find((option) => option.id === id);
}

export type StudioPerson = "woman" | "man" | "person";

// The same reading of a stored gender as the image prompts use.
export function studioPerson(gender: string | null | undefined): StudioPerson {
  const value = (gender ?? "").toLowerCase();
  if (/\b(woman|female|girl)\b/.test(value)) return "woman";
  if (/\b(man|male|guy)\b/.test(value)) return "man";
  return "person";
}

export function outfitLabel(outfit: OutfitOption, person: StudioPerson) {
  return person === "man" && outfit.labelMan ? outfit.labelMan : outfit.label;
}

// Whether a choice shows nudity (a nude or topless outfit, or the undress).
export function showsNudity(choice: { outfit: string; action: string }) {
  return Boolean(studioOutfit(choice.outfit)?.nudity || studioAction(choice.action)?.nudity);
}

// The motion sent to POST /api/media/[id]/animate for an action. That route
// screens it again (checkImagePrompt, the classifier and the one-person check)
// and adds the same-adult line; "alone" keeps a second person from walking into
// the clip, and soloMotionPrompt (src/server/studio.ts) spells it out.
export function studioMotion(actionId: string) {
  const action = studioAction(actionId);
  if (!action) throw new Error("Unknown studio action.");
  return `${action.motion}, alone`;
}
