import { normalize } from "@/server/safety/text";
import { studioPerson, type StudioPerson } from "@/lib/studio";

// What a photo request asks for, read from the hint (or a scene the model
// wrote). This is about nudity, not safety: whatever reaches it has already been
// through checkImagePrompt and the classifier, and the image is still checked
// by moderateImage with allowExplicit only for explicit viewers.

// Nudity, or a sexual act, asked for in plain words. Read on the normalized
// text, so "nud3s" counts too. Not "explicit" on its own, which is as often
// "nothing explicit". A miss here is still kept clothed by the prompt builder
// and moderateImage; a false hit only asks the viewer to rephrase.
const NUDITY = new RegExp(
  [
    String.raw`\b(?:nude|nudes|nudie|nudies|nudity|naked|topless|shirtless|bottomless|unclothed|undressed|undressing|undress|stripped|stripping|strip ?tease|striptease)\b`,
    String.raw`\bstrip(?:s)? (?:off|down|naked|for me|for us)\b`,
    String.raw`\b(?:no|without|without any|zero) (?:clothes|clothing|bra|top|panties|underwear)\b`,
    String.raw`\b(?:nothing on|wearing nothing|wearing only (?:a smile|skin)|birthday suit|in the buff)\b`,
    String.raw`\b(?:nipples?|areolas?|boobs|boobies|tits|titties|breasts?|pussy|vagina|vulva|labia|clit|clitoris|cock|penis|dick|genitals?|crotch shot)\b`,
    String.raw`\bbare (?:breasts?|boobs|tits|chest|nipples?|ass|butt|bottom|body|pussy)\b`,
    String.raw`\b(?:nsfw|xxx|porn|porno|pornographic|lewd|uncensored)\b`,
    String.raw`\b(?:sex|sexual|masturbat\w*|fingering|touching (?:herself|himself|themself|themselves)|spread(?:ing)? (?:legs|open|wide)|flash(?:ing)? (?:me|you|us|her|his|your|their|boobs|tits|breasts?))\b`,
  ].join("|"),
);

// A request to stay covered takes precedence over nudity words in that
// request. These words are only read for the clothing preference; the safety
// screens still receive the original hint unchanged.
const NEGATED_NUDITY = new RegExp(
  String.raw`\b(?:no|not|nothing|without|avoid|skip|exclude|don't|do not|never)\s+(?:(?:any|a|an|the|too|really|fully|completely|visible|exposed|please|send|sending|show|showing|me|your|be|being|go|get|getting|include|including|want|wanted|anything|something)\s+){0,5}(?:${NUDITY.source}|\bexplicit\b)`,
);
const CLOTHED = /\b(?:clothed|non[- ]?(?:nude|sexual)|sfw|safe for work)\b|\b(?:stay|remain)\s+(?:fully\s+)?(?:covered|dressed)\b|\b(?:fully|completely)\s+(?:covered|dressed)\b|\b(?:keep|leave)\s+(?:(?:your|the|all|of|on)\s+){0,3}(?:clothes|clothing|shirt|top|underwear)\s+on\b/;

export function wantsClothed(text: string | null | undefined) {
  if (!text) return false;
  const normalized = normalize(text);
  // "Nude, not fully clothed" is still a positive request for nudity.
  const clothing = normalized.replace(/\b(?:not|never)\s+(?:(?:fully|completely|entirely|a|an)\s+){0,2}(?:clothed|covered|dressed|sfw|safe for work)\b/g, "");
  return NEGATED_NUDITY.test(normalized) || CLOTHED.test(clothing);
}

export function wantsNudity(text: string | null | undefined) {
  return !wantsClothed(text) && describesNudity(text);
}

// Model-written scenes get the original conservative keyword check: a scene
// can describe nudity and also say something is covered. A user's clothing
// preference must never make that output check less strict.
export function describesNudity(text: string | null | undefined) {
  return Boolean(text) && NUDITY.test(normalize(text!));
}

// Scenes we wrote ourselves for the photo quick actions, used when the scene
// model gives nothing usable (it failed, or what it wrote was blocked, or it
// came back clothed when nudity was asked for). Each is one adult alone, worded
// for who the character is (a man is shirtless, in briefs), and each passes
// checkImagePrompt and bringsOthers for that character (scenes.test.ts,
// scenes-gender.test.ts). Every viewer who reaches the photo route is a
// confirmed adult; `tasteful` supplies a covered fallback when they explicitly
// ask to stay clothed (or the caller doesn't allow nudity). Nude-only presets
// have no clothed fallback.
type Worded = Record<StudioPerson, string>;
type Preset = { test: RegExp; explicit: Worded; tasteful?: Worded };

const same = (scene: string): Worded => ({ woman: scene, man: scene, person: scene });

const PRESETS: Preset[] = [
  {
    test: /\b(?:topless|shirtless)\b/,
    explicit: {
      woman: "topless in a softly lit bedroom, bare breasts, lace panties, glancing back over one shoulder with a slow, knowing smile",
      man: "shirtless in a softly lit bedroom, bare chest, low-slung briefs, glancing back over one shoulder with a slow, knowing smile",
      person: "topless in a softly lit bedroom, bare chest, lace underwear, glancing back over one shoulder with a slow, knowing smile",
    },
  },
  {
    test: /\bshower\b/,
    explicit: same("nude in a steamy glass shower, water running over bare skin, one hand in wet hair, looking at the camera through the steam"),
    tasteful: same("in a steamy shower behind fogged glass, shoulders and wet hair only, warm light, a playful look at the camera"),
  },
  {
    test: /\b(?:lingerie|negligee|corset|garters?|underwear|bra and panties|briefs|boxers)\b/,
    explicit: {
      woman: "in sheer black lace lingerie, kneeling on white sheets in warm lamp light, one strap slipping off a shoulder",
      man: "in fitted black boxer briefs, bare chest, lying back on white sheets in warm lamp light, a slow confident look at the camera",
      person: "in sheer black lace lingerie, kneeling on white sheets in warm lamp light, one strap slipping off a shoulder",
    },
    tasteful: {
      woman: "in elegant black lace lingerie, sitting on the edge of the bed in warm lamp light, a confident look at the camera",
      man: "in fitted black boxer briefs and an open robe, sitting on the edge of the bed in warm lamp light, a confident look at the camera",
      person: "in elegant black lace lingerie, sitting on the edge of the bed in warm lamp light, a confident look at the camera",
    },
  },
  {
    test: NUDITY,
    explicit: same("fully nude, reclining on white sheets in warm evening light, one arm above the head, an inviting look into the camera"),
  },
];

// `gender` is the character's; without it the wording is the neutral one.
export function presetScene(hint: string | null | undefined, explicit: boolean, gender?: string | null): string | null {
  if (!hint) return null;
  const text = normalize(hint);
  const person = studioPerson(gender);
  const nude = explicit && !wantsClothed(hint);
  for (const preset of PRESETS) {
    if (!preset.test.test(text)) continue;
    return nude ? preset.explicit[person] : (preset.tasteful?.[person] ?? null);
  }
  return null;
}

// For the tests: every scene we can put in a prompt, with who it's for.
export const PRESET_SCENES_BY_PERSON = PRESETS.flatMap((preset) =>
  [preset.explicit, preset.tasteful].flatMap((worded) =>
    worded ? (Object.entries(worded) as [StudioPerson, string][]).map(([person, scene]) => ({ person, scene })) : [],
  ),
);
export const PRESET_SCENES = [...new Set(PRESET_SCENES_BY_PERSON.map(({ scene }) => scene))];
