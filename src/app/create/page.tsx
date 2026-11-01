"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AppShell, useLane } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ActionBar } from "@/components/create/action-bar";
import { GeneratingCard } from "@/components/create/generating";
import { PERSONALITY_ICONS, ROLE_ICONS, VOICE_ICON } from "@/components/create/glyphs";
import { MediaImage } from "@/components/create/media-image";
import { NudePortraitDialog } from "@/components/create/nude-portrait";
import styles from "@/components/create/motion.module.css";
import {
  BODIES,
  BREASTS,
  DEFAULT_VOICE,
  EYE_COLORS,
  GIRL_ETHNICITY,
  GIRL_HAIR_STYLES,
  GIRL_NAMES,
  GIRL_ROLES,
  GUY_BODIES,
  GUY_ETHNICITY,
  GUY_HAIR,
  GUY_HAIR_STYLES,
  GUY_NAMES,
  GUY_ROLES,
  HAIR,
  JOBS,
  KINKS,
  MAX_AGE,
  MIN_AGE,
  NAME_MAX,
  NAME_RULE,
  PERSONALITIES,
  PERSONALITY_INFO,
  ROLE_INFO,
  STEPS,
  STYLE_CARDS,
  STYLE_FRAMES,
  VOICES,
  ageLabel,
  clampAge,
  nameProblem,
  type Section,
  type Step,
  type Style,
} from "@/components/create/options";
import { Stepper } from "@/components/create/stepper";
import { SummaryBar, SummaryPanel, type SummaryRow } from "@/components/create/summary";
import {
  AgePicker,
  CheckIcon,
  ChoiceGroup,
  EyeTile,
  ImageTile,
  OptionCard,
  RefreshIcon,
  ShuffleIcon,
  SwatchTile,
  TILE_SIZES,
  warmImages,
} from "@/components/create/tiles";
import { ChevronRightIcon, CoinIcon, FemaleIcon, MaleIcon, SparkIcon } from "@/components/icons";
import { Button, ButtonLink, Chip, Panel, cx, inputClass } from "@/components/ui";
import { ApiError, useApi } from "@/lib/api";
import type { CharacterDTO, MediaDTO } from "@/lib/api-types";
import { COSTS, FREE } from "@/lib/pricing";

// Choices survive a login round trip (OAuth leaves the page) for this tab only.
const DRAFT_KEY = "simulust-create-draft";

type Draft = {
  section: Section;
  style: Style | "";
  ethnicity: string;
  eyeColor: string;
  age: number;
  hairStyle: string;
  hair: string;
  body: string;
  breast: string;
  name: string;
  personality: string;
  role: string;
  occupation: string;
  kinks: string[];
  voice: string;
};

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    window.sessionStorage.removeItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or storage blocked: the choices just won't survive a reload.
  }
}

const PORTRAIT_INDEX = STEPS.indexOf("portrait");
const VOICE_INDEX = STEPS.indexOf("voice");

// "Mira Voss" -> "Mira", for the button that opens the chat.
function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

// One summary chip reads as a phrase: "Blue eyes", "Wavy black hair".
function phrase(...words: (string | null | false | undefined)[]) {
  const text = words.filter(Boolean).join(" ").toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export default function CreatePage() {
  const router = useRouter();
  const { session, me, openLogin, openSignup, refreshMe } = useSession();
  const api = useApi();
  // Start from the lane picked in the top bar (the server knows it too): Guys
  // starts on a guy, Anime on the anime style. Everything stays changeable.
  const { lane } = useLane();
  const startSection: Section = lane === "guys" ? "guys" : "girls";
  const [section, setSection] = useState<Section>(startSection);
  const [style, setStyle] = useState<Style | "">(lane === "anime" ? "anime" : "");
  const [step, setStep] = useState<Step>("style");
  // The furthest step reached, so the step bar only jumps to steps already seen.
  const [furthest, setFurthest] = useState(0);
  const [ethnicity, setEthnicity] = useState("");
  const [eyeColor, setEyeColor] = useState("");
  const [age, setAge] = useState(24);
  const [hairStyle, setHairStyle] = useState("");
  const [hair, setHair] = useState("");
  const [body, setBody] = useState("");
  const [breast, setBreast] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [name, setName] = useState(startSection === "guys" ? GUY_NAMES[0] : GIRL_NAMES[0]);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0]);
  const [role, setRole] = useState<string>(startSection === "guys" ? GUY_ROLES[0] : GIRL_ROLES[0]);
  const [occupation, setOccupation] = useState<string>(JOBS[0]);
  const [kinks, setKinks] = useState<string[]>(["Praise"]);
  const [voice, setVoice] = useState(DEFAULT_VOICE[startSection]);
  const [portrait, setPortrait] = useState<MediaDTO | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The character just made, while the nude portrait offer is open. Every
  // confirmed adult gets the offer (there's no switch); a held or unconfirmed
  // account goes straight to the chat.
  const [created, setCreated] = useState<CharacterDTO | null>(null);
  const drawToken = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<Step>("style");
  // Which way the last step change went, so the new step slides in from that side.
  const [direction, setDirection] = useState<"next" | "back">("next");
  // Picking a style moves straight on, unless the viewer came back to change it.
  const autoAdvance = useRef(true);
  const advanceTimer = useRef<number | undefined>(undefined);
  const [portraitShown, setPortraitShown] = useState<string | null>(null);

  useEffect(() => {
    const draft = readDraft();
    if (!draft) return;
    // Restore choices saved before the login prompt, once, on mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSection(draft.section === "guys" ? "guys" : "girls");
    setStyle(draft.style);
    setEthnicity(draft.ethnicity);
    setEyeColor(draft.eyeColor);
    setAge(clampAge(draft.age));
    setHairStyle(draft.hairStyle);
    setHair(draft.hair);
    setBody(draft.body);
    setBreast(draft.breast);
    setName(draft.name);
    setPersonality(draft.personality);
    setRole(draft.role);
    setOccupation(draft.occupation);
    setKinks(Array.isArray(draft.kinks) ? draft.kinks.slice(0, 3) : []);
    setVoice(draft.voice);
    setStep("voice");
    setFurthest(VOICE_INDEX);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // A new step starts at the top, with its heading announced. The jump happens
  // before paint, so the step never appears mid-page and then scrolls.
  useLayoutEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo({ top: 0, behavior: "auto" });
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  const steps = STEPS;
  const index = steps.indexOf(step);
  const look: Style = style || "realistic";
  const girls = section === "girls";
  const ethnicities = girls ? GIRL_ETHNICITY : GUY_ETHNICITY;
  const hairStyles = girls ? GIRL_HAIR_STYLES : GUY_HAIR_STYLES;
  const roles = girls ? GIRL_ROLES : GUY_ROLES;
  const bodies = girls ? BODIES : GUY_BODIES;
  const ownTone = girls ? "Feminine" : "Masculine";
  const voices = [...VOICES].sort((a, b) => Number(b.tone === ownTone) - Number(a.tone === ownTone));
  const problem = nameProblem(name);

  // Warm the cache with the next step's pictures so its tiles show at once. It
  // asks for the same optimized files the tiles will, once the browser is idle.
  useEffect(() => {
    const warm = () => {
      if (step === "style") {
        warmImages(
          (girls ? GIRL_ETHNICITY : GUY_ETHNICITY).map((row) => (look === "realistic" ? row.realistic : row.src)),
          TILE_SIZES.sm,
        );
        warmImages(
          EYE_COLORS.map((row) => row.src),
          TILE_SIZES.eye,
        );
      } else if (step === "look") {
        warmImages(
          (girls ? [...BODIES, ...BREASTS] : GUY_BODIES).map((row) => row.src),
          TILE_SIZES.md,
        );
      }
    };
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(warm, 600);
      return () => window.clearTimeout(timer);
    }
    const idle = window.requestIdleCallback(warm, { timeout: 2000 });
    return () => window.cancelIdleCallback(idle);
  }, [step, girls, look]);
  const cleanName = name.trim();

  function ethnicitySrc(id: string) {
    const row = ethnicities.find((item) => item.id === id) ?? ethnicities[0];
    return look === "realistic" ? row.realistic : row.src;
  }

  function stepReady(current: Step) {
    if (current === "style") return Boolean(style);
    if (current === "look") return Boolean(ethnicity && eyeColor && hair && hairStyle);
    if (current === "body") return Boolean(body && (!girls || breast));
    if (current === "personality") return Boolean(personality && occupation);
    if (current === "relationship") return Boolean(role && kinks.length);
    if (current === "voice") return Boolean(voice && !problem);
    return true;
  }

  // What's still missing on a step, in words, for the hint next to Next.
  function missing(current: Step): string | null {
    const still = (parts: [boolean, string][]) => {
      const names = parts.filter(([done]) => !done).map(([, label]) => label);
      return names.length ? `Still to pick: ${names.join(", ")}.` : null;
    };
    if (current === "style") return style ? null : "Pick Realistic or Anime to continue.";
    if (current === "look")
      return still([
        [Boolean(ethnicity), "ethnicity"],
        [Boolean(eyeColor), "eye color"],
        [Boolean(hairStyle), "hair style"],
        [Boolean(hair), "hair color"],
      ]);
    if (current === "body") return still([[Boolean(body), "body type"], ...(girls ? [[Boolean(breast), "breast size"] as [boolean, string]] : [])]);
    if (current === "personality") return still([[Boolean(personality), "personality"], [Boolean(occupation), "occupation"]]);
    if (current === "relationship") return still([[Boolean(role), "relationship"], [kinks.length > 0, "at least one kink"]]);
    if (current === "voice") return problem ? "Fix the name to continue." : null;
    return null;
  }

  function goTo(next: Step) {
    const target = steps.indexOf(next);
    window.clearTimeout(advanceTimer.current);
    if (next === "style") autoAdvance.current = false;
    setStepError(null);
    setDirection(target < index ? "back" : "next");
    setStep(next);
    setFurthest((value) => Math.max(value, target));
  }

  // The step bar and the summary only jump to steps already reached, and never
  // forward into the portrait: that always means drawing a new one.
  function canVisit(target: number) {
    if (target === index) return false;
    if (target < index) return true;
    if (target === PORTRAIT_INDEX || target > furthest) return false;
    return steps.slice(0, target).every(stepReady);
  }

  function goSection(next: Section) {
    if (next === section) return;
    applySection(next);
  }

  // A new section starts its look over, with that section's defaults.
  function applySection(next: Section) {
    window.clearTimeout(advanceTimer.current);
    setSection(next);
    setStyle("");
    setEthnicity("");
    setEyeColor("");
    setHair("");
    setHairStyle("");
    setBody("");
    setBreast("");
    setRole(next === "girls" ? GIRL_ROLES[0] : GUY_ROLES[0]);
    setName(next === "girls" ? GIRL_NAMES[0] : GUY_NAMES[0]);
    setVoice(DEFAULT_VOICE[next]);
    setPortrait(null);
    setPortraitError(null);
    setNeedsCredits(false);
    setStepError(null);
    setFurthest(0);
    setStep("style");
  }

  function shuffleName() {
    const pool = girls ? GIRL_NAMES : GUY_NAMES;
    const other = pool.filter((item) => item !== name);
    setName(other[Math.floor(Math.random() * other.length)] ?? pool[0]);
  }

  function toggleKink(kink: string) {
    setKinks((current) => {
      if (current.includes(kink)) return current.filter((item) => item !== kink);
      if (current.length >= 3) return current;
      return [...current, kink];
    });
  }

  function next() {
    if (!stepReady(step)) {
      setStepError("You have to select all options.");
      return;
    }
    const following = steps[index + 1];
    if (following) goTo(following);
  }

  function back() {
    setStepError(null);
    const previous = steps[index - 1];
    if (!previous) return;
    if (previous === "style") autoAdvance.current = false;
    setDirection("back");
    setStep(previous);
  }

  function pickStyle(next: Style) {
    setStyle(next);
    setStepError(null);
    if (!autoAdvance.current) return;
    // A beat, so the check is seen landing before the step moves on.
    window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => goTo("look"), 250);
  }

  function saveDraft() {
    writeDraft({
      section,
      style,
      ethnicity,
      eyeColor,
      age,
      hairStyle,
      hair,
      body,
      breast,
      name,
      personality,
      role,
      occupation,
      kinks,
      voice,
    });
  }

  function tryGenerate() {
    if (!steps.slice(0, VOICE_INDEX + 1).every(stepReady)) {
      setStepError("You have to select all options.");
      return;
    }
    if (!session) {
      saveDraft();
      setStepError("Log in to generate your portrait. Your choices are saved.");
      openLogin();
      return;
    }
    setStepError(null);
    void drawPortrait();
  }

  async function drawPortrait() {
    const token = drawToken.current + 1;
    drawToken.current = token;
    if (step !== "portrait") setDirection("next");
    setStep("portrait");
    setFurthest(PORTRAIT_INDEX);
    setDrawing(true);
    setPortrait(null);
    setPortraitError(null);
    setNeedsCredits(false);
    setSaveError(null);
    try {
      const { media } = await api<{ media: MediaDTO }>("/api/portrait", {
        method: "POST",
        json: {
          section,
          style,
          ethnicity,
          age: clampAge(age),
          hair,
          hairStyle,
          eyeColor,
          body,
          breast: section === "girls" ? breast : undefined,
          personality,
          role,
          occupation,
          kinks,
          name: name.trim(),
        },
      });
      if (token !== drawToken.current) return;
      if (media.status !== "ready" || !media.url) throw new Error(media.error ?? "Portrait could not be generated. Try again.");
      setPortrait(media);
    } catch (error) {
      if (token !== drawToken.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setPortraitError("Log in to generate your portrait.");
        openLogin();
      } else if (error instanceof ApiError && error.status === 402) {
        setNeedsCredits(true);
        setPortraitError(`A portrait costs ${COSTS.portrait} credits and you don't have enough.`);
      } else {
        setPortraitError(error instanceof Error ? error.message : "Portrait could not be generated. Try again.");
      }
    } finally {
      if (token === drawToken.current) setDrawing(false);
      void refreshMe();
    }
  }

  async function finish() {
    if (!portrait || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { character } = await api<{ character: CharacterDTO }>("/api/characters", {
        method: "POST",
        json: {
          name: name.trim(),
          age: clampAge(age),
          gender: section === "guys" ? "Man" : "Woman",
          style: look,
          ethnicity,
          body,
          role,
          personality,
          occupation,
          hair,
          hairStyle,
          eyeColor,
          breast: section === "girls" ? breast : undefined,
          kinks,
          voice,
          imageMediaId: portrait.id,
        },
      });
      if (me?.ageVerified) setCreated(character);
      else router.push(`/date/${character.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) openLogin();
      setSaveError(error instanceof Error ? error.message : "We couldn't save your character. Try again.");
      setSaving(false);
    }
  }

  const her = girls ? "her" : "his";
  const them = girls ? "her" : "him";
  const styleName = look === "anime" ? "Anime" : "Realistic";
  const voiceInfo = VOICES.find((item) => item.id === voice);
  const balance = me ? me.balance.toLocaleString("en-US") : null;

  const headings: Record<Step, { accent: string; title: string; subtitle: string }> = {
    style: {
      accent: "Create",
      title: girls ? "my AI girl" : "my AI guy",
      subtitle: "Pick who you want to meet and an art style. You can change anything before the portrait.",
    },
    look: { accent: "Choose", title: `${her} look`, subtitle: "Ethnicity, age, eyes and hair. Tap a picture to pick it." },
    body: {
      accent: "Choose",
      title: `${her} body`,
      subtitle: girls ? "Pick a body type and a breast size." : "Pick a body type.",
    },
    personality: { accent: "Pick", title: `${her} personality`, subtitle: `How ${girls ? "she acts" : "he acts"} with you, and what ${girls ? "she does" : "he does"} for a living.` },
    relationship: {
      accent: "Set",
      title: "the relationship",
      subtitle: `Who you are to each other, and up to 3 things ${girls ? "she's" : "he's"} into.`,
    },
    voice: {
      accent: "Name",
      title: `${them} and pick a voice`,
      subtitle: "The last step before we draw the portrait.",
    },
    portrait: {
      accent: "Meet",
      title: cleanName || "your character",
      subtitle: girls
        ? "Drawn from the style, ethnicity, age, hair, body, breast size, and personality you picked."
        : "Drawn from the style, ethnicity, age, hair, body, and personality you picked.",
    },
  };
  const head = headings[step];

  const summaryRows: SummaryRow[] = [
    { step: "style", index: 0, values: [girls ? "Girl" : "Guy", style && styleName] },
    {
      step: "look",
      index: 1,
      values: [
        ethnicity,
        furthest >= 1 && `${ageLabel(age)} years`,
        eyeColor && phrase(eyeColor, "eyes"),
        (hair || hairStyle) && phrase(hairStyle, hair, "hair"),
      ],
    },
    { step: "body", index: 2, values: [body && phrase(body, "body"), girls && breast && phrase(breast, "breasts")] },
    { step: "personality", index: 3, values: furthest >= 3 ? [personality, occupation] : [] },
    { step: "relationship", index: 4, values: furthest >= 4 ? [role, ...kinks] : [] },
    {
      step: "voice",
      index: 5,
      values: furthest >= 5 ? [cleanName, voiceInfo ? phrase(voiceInfo.description, "voice") : voice] : [],
    },
  ];
  // Steps reached with every choice made, out of the six before the portrait.
  const doneCount = summaryRows.filter((row) => row.index <= furthest && stepReady(steps[row.index])).length;

  const preview = ethnicity
    ? ethnicitySrc(ethnicity)
    : (STYLE_CARDS[section].find((card) => card.id === look) ?? STYLE_CARDS[section][0]).src;

  const summaryTitle = furthest >= VOICE_INDEX && !problem ? cleanName : girls ? "Your AI girl" : "Your AI guy";
  const summarySubtitle = style
    ? [styleName, ethnicity, furthest >= 1 ? `${ageLabel(age)} years` : null].filter(Boolean).join(" · ")
    : "Pick a style to start";

  // What the generating card says it's working on, from the viewer's own picks.
  const progressLines = [
    "Reading your choices",
    `Setting ${her} look: ${[ethnicity, (hair || hairStyle) && phrase(hairStyle, hair, "hair").toLowerCase()].filter(Boolean).join(", ")}`,
    body ? `Shaping ${her} ${body.toLowerCase()} body` : `Shaping ${her} body`,
    `Matching ${her} ${personality.toLowerCase()} side`,
    "Adding the finishing light",
  ];

  // The finished card's details, grouped the way the steps were.
  const traits: { label: string; values: (string | null | false)[] }[] = [
    {
      label: "Look",
      values: [
        styleName,
        ethnicity,
        `${ageLabel(age)} years`,
        eyeColor && phrase(eyeColor, "eyes"),
        (hair || hairStyle) && phrase(hairStyle, hair, "hair"),
      ],
    },
    { label: "Body", values: [body && phrase(body, "body"), girls && breast ? phrase(breast, "breasts") : null] },
    { label: "Personality", values: [personality, occupation] },
    { label: "Into", values: kinks },
    { label: "Voice", values: [voiceInfo ? phrase(voiceInfo.description, "voice") : null] },
  ];

  const creditNote = me
    ? `A portrait uses ${COSTS.portrait} credits. You have ${balance}.`
    : `A portrait uses ${COSTS.portrait} credits. New accounts start with ${FREE.signupCredits} free.`;

  const creditsPanel = (
    <Panel className="p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--premium)]/15 text-[var(--premium)]">
          <CoinIcon />
        </span>
        <p className="text-sm leading-5 text-[var(--muted)]">{creditNote}</p>
      </div>
      {session ? null : (
        <div className="mt-3 flex gap-2">
          <Button
            size="md"
            className="flex-1"
            onClick={() => {
              saveDraft();
              openSignup();
            }}
          >
            Sign up free
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={() => {
              saveDraft();
              openLogin();
            }}
          >
            Log in
          </Button>
        </div>
      )}
    </Panel>
  );

  const costChip = (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-xs">
      <CoinIcon className="h-3.5 w-3.5" />
      {COSTS.portrait}
    </span>
  );

  let primary: ReactNode;
  let hint: string | null = null;
  if (step === "voice") {
    hint = missing(step);
    primary = (
      <Button size="lg" className="w-full whitespace-nowrap px-4 sm:w-auto sm:px-6" disabled={!stepReady(step)} onClick={tryGenerate}>
        <SparkIcon className="hidden h-5 w-5 sm:block" />
        Generate portrait
        {costChip}
      </Button>
    );
  } else if (step === "portrait") {
    if (portraitError && !drawing) {
      primary = needsCredits ? (
        <ButtonLink href="/packs" variant="premium" size="lg" className="w-full sm:w-auto sm:min-w-44">
          <CoinIcon className="h-5 w-5" />
          Get credits
        </ButtonLink>
      ) : (
        <Button size="lg" className="w-full sm:w-auto sm:min-w-44" onClick={() => (session ? void drawPortrait() : openLogin())}>
          {session ? (
            <>
              <RefreshIcon className="h-5 w-5" />
              Try again
              {costChip}
            </>
          ) : (
            "Log in"
          )}
        </Button>
      );
    } else {
      hint = drawing ? "Drawing the portrait. This takes a few seconds." : null;
      // Regenerate and Chat sit together, in the same place on every screen.
      primary = (
        <>
          {portrait && !drawing ? (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void drawPortrait()}
              disabled={saving}
              aria-label={`Regenerate portrait, ${COSTS.portrait} credits`}
              className="!gap-1.5 !px-3 sm:!gap-2 sm:!px-5"
            >
              <RefreshIcon className="h-5 w-5" />
              <span className="hidden sm:inline">Regenerate</span>
              <span className="inline-flex items-center gap-1 rounded-full text-xs sm:bg-white/10 sm:px-2 sm:py-0.5">
                <CoinIcon className="h-3.5 w-3.5 text-[var(--premium)]" />
                {COSTS.portrait}
              </span>
            </Button>
          ) : null}
          <Button
            size="lg"
            className="min-w-0 flex-1 !px-4 sm:min-w-48 sm:flex-none sm:!px-6"
            disabled={!portrait || drawing || saving}
            onClick={finish}
          >
            <span className="truncate">{saving ? "Saving…" : `Chat with ${firstName(cleanName)}`}</span>
            {saving ? null : <ChevronRightIcon className="h-5 w-5" />}
          </Button>
        </>
      );
    }
  } else {
    hint = missing(step);
    primary = (
      <Button size="lg" className="w-full sm:w-auto sm:min-w-40" disabled={!stepReady(step)} onClick={next}>
        Next
        <ChevronRightIcon className="h-5 w-5" />
      </Button>
    );
  }

  const rowProps = { rows: summaryRows, current: index, canVisit, onGo: (target: number) => goTo(steps[target]) };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        <Stepper
          steps={steps}
          current={index}
          done={(target) => target < furthest && target !== PORTRAIT_INDEX && stepReady(steps[target])}
          canVisit={canVisit}
          onGo={(target) => goTo(steps[target])}
        />
        {step !== "portrait" ? (
          <SummaryBar preview={preview} title={summaryTitle} subtitle={summarySubtitle} done={doneCount} total={PORTRAIT_INDEX} {...rowProps} />
        ) : null}

        <div
          className={cx(
            "mt-6 grid gap-8 lg:mt-8",
            step !== "portrait" && "lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_21rem]",
          )}
        >
          <div className="min-w-0">
            {/* Left-aligned on every step, so the heading never jumps sideways. */}
            <div className={cx("w-full", step === "portrait" ? "max-w-6xl" : "max-w-4xl")}>
              <div key={step} className={styles.step} data-dir={direction}>
                <header>
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    className="text-2xl font-bold tracking-tight text-[var(--ink)] outline-none sm:text-3xl"
                  >
                    <span className="text-[var(--accent)]">{head.accent}</span> {head.title}
                  </h1>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{head.subtitle}</p>
                </header>

                <div className="mt-6">
                  {step === "style" ? (
                    <>
                      <div
                        role="group"
                        aria-label="Who to create"
                        className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface)] p-1"
                      >
                        {(["girls", "guys"] as const).map((item) => {
                          const on = section === item;
                          return (
                            <button
                              key={item}
                              type="button"
                              aria-pressed={on}
                              onClick={() => goSection(item)}
                              className={cx(
                                "flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:px-6",
                                on ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
                              )}
                            >
                              {item === "girls" ? <FemaleIcon className="h-4 w-4" /> : <MaleIcon className="h-4 w-4" />}
                              {item === "girls" ? "Girl" : "Guy"}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-5 grid max-w-2xl grid-cols-2 gap-3 sm:gap-5">
                        {STYLE_CARDS[section].map((card) => (
                          <ImageTile
                            key={`${section}-${card.id}`}
                            size="lg"
                            eager
                            src={card.src}
                            frames={STYLE_FRAMES[section][card.id]}
                            label={card.label}
                            detail={card.detail}
                            selected={style === card.id}
                            dimmed={Boolean(style)}
                            onClick={() => pickStyle(card.id)}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}

                  {step === "look" ? (
                    <>
                      <ChoiceGroup id="ethnicity" title="Ethnicity" value={ethnicity} hint="Pick one">
                        <div className="grid grid-cols-4 gap-2 sm:gap-3">
                          {ethnicities.map((item) => (
                            <ImageTile
                              key={item.id}
                              size="sm"
                              src={ethnicitySrc(item.id)}
                              label={item.id}
                              selected={ethnicity === item.id}
                              dimmed={Boolean(ethnicity)}
                              onClick={() => setEthnicity(item.id)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <ChoiceGroup id="age" title="Age" value={`${ageLabel(age)} years`}>
                        <AgePicker age={age} min={MIN_AGE} max={MAX_AGE} onChange={(value) => setAge(clampAge(value))} />
                      </ChoiceGroup>
                      <ChoiceGroup id="eyes" title="Eye color" value={eyeColor} hint="Pick one">
                        <div className="grid grid-cols-6 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-2 py-3 sm:gap-3 sm:px-4 sm:py-4">
                          {EYE_COLORS.map((item) => (
                            <EyeTile
                              key={item.id}
                              src={item.src}
                              label={item.id}
                              selected={eyeColor === item.id}
                              dimmed={Boolean(eyeColor)}
                              onClick={() => setEyeColor(item.id)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <ChoiceGroup id="hair-style" title="Hair style" value={hairStyle} hint="Pick one">
                        <div className="grid grid-cols-4 gap-2 sm:gap-3">
                          {hairStyles.map((item) => (
                            <ImageTile
                              key={item.id}
                              size="sm"
                              src={look === "anime" ? item.anime : item.src}
                              label={item.id}
                              selected={hairStyle === item.id}
                              dimmed={Boolean(hairStyle)}
                              onClick={() => setHairStyle(item.id)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <ChoiceGroup id="hair-color" title="Hair color" value={hair} hint="Pick one">
                        <div className="grid grid-cols-4 gap-2 sm:gap-3">
                          {HAIR.map((item) =>
                            // The girls' hair art is painted, so the realistic flow shows plain colours.
                            girls && look === "realistic" ? (
                              <SwatchTile
                                key={item.id}
                                swatch={item.swatch}
                                label={item.id}
                                selected={hair === item.id}
                                dimmed={Boolean(hair)}
                                onClick={() => setHair(item.id)}
                              />
                            ) : (
                              <ImageTile
                                key={item.id}
                                size="sm"
                                src={girls ? item.src : GUY_HAIR[look][item.id]}
                                label={item.id}
                                swatch={item.swatch}
                                selected={hair === item.id}
                                dimmed={Boolean(hair)}
                                onClick={() => setHair(item.id)}
                              />
                            ),
                          )}
                        </div>
                      </ChoiceGroup>
                    </>
                  ) : null}

                  {step === "body" ? (
                    <>
                      <ChoiceGroup id="body" title="Body type" value={body} hint="Pick one">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {bodies.map((item) => (
                            <ImageTile
                              key={item.id}
                              src={item.src}
                              label={item.id}
                              detail={item.detail}
                              selected={body === item.id}
                              dimmed={Boolean(body)}
                              onClick={() => setBody(item.id)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      {girls ? (
                        <ChoiceGroup id="breast" title="Breast size" value={breast} hint="Pick one">
                          <div className="grid grid-cols-3 gap-3 sm:max-w-[75%]">
                            {BREASTS.map((item) => (
                              <ImageTile
                                key={item.id}
                                src={item.src}
                                label={item.id}
                                selected={breast === item.id}
                                dimmed={Boolean(breast)}
                                onClick={() => setBreast(item.id)}
                              />
                            ))}
                          </div>
                        </ChoiceGroup>
                      ) : null}
                    </>
                  ) : null}

                  {step === "personality" ? (
                    <>
                      <ChoiceGroup id="personality" title="Personality" value={personality}>
                        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:gap-3 xl:grid-cols-3">
                          {PERSONALITIES.map((item) => (
                            <OptionCard
                              key={item}
                              title={item}
                              detail={PERSONALITY_INFO[item]}
                              icon={PERSONALITY_ICONS[item]}
                              selected={personality === item}
                              onClick={() => setPersonality(item)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <ChoiceGroup id="occupation" title="Occupation" value={occupation}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                          {JOBS.map((item) => (
                            <OptionCard key={item} compact title={item} selected={occupation === item} onClick={() => setOccupation(item)} />
                          ))}
                        </div>
                      </ChoiceGroup>
                    </>
                  ) : null}

                  {step === "relationship" ? (
                    <>
                      <ChoiceGroup id="role" title="Relationship" value={role}>
                        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:gap-3">
                          {roles.map((item) => (
                            <OptionCard
                              key={item}
                              title={item}
                              detail={ROLE_INFO[item]}
                              icon={ROLE_ICONS[item]}
                              selected={role === item}
                              onClick={() => setRole(item)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <ChoiceGroup id="kinks" title="Kinks" value={`${kinks.length} of 3`}>
                        <p className="-mt-1 mb-3 text-sm text-[var(--muted)]">Pick 1 to 3. Tap again to remove.</p>
                        <div className="flex flex-wrap gap-2">
                          {KINKS.map((kink) => {
                            const on = kinks.includes(kink);
                            const full = !on && kinks.length >= 3;
                            return (
                              <Chip
                                key={kink}
                                active={on}
                                disabled={full}
                                onClick={() => {
                                  toggleKink(kink);
                                  setStepError(null);
                                }}
                                className={cx("h-11 px-5 sm:h-10", full && "opacity-40")}
                              >
                                {on ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                                {kink}
                              </Chip>
                            );
                          })}
                        </div>
                      </ChoiceGroup>
                    </>
                  ) : null}

                  {step === "voice" ? (
                    <>
                      <ChoiceGroup id="name" title="Name">
                        <div className="flex gap-2">
                          <input
                            value={name}
                            maxLength={NAME_MAX}
                            aria-label="Name"
                            aria-invalid={problem ? true : undefined}
                            aria-describedby="name-rule name-problem"
                            autoComplete="off"
                            onChange={(event) => {
                              setName(event.target.value);
                              setStepError(null);
                            }}
                            className={cx(inputClass, "h-12 text-base font-semibold", problem && "border-red-400/70 focus:border-red-400")}
                          />
                          <Button variant="secondary" size="lg" onClick={shuffleName} aria-label="Shuffle name" className="px-4">
                            <ShuffleIcon className="h-5 w-5" />
                            <span className="hidden sm:inline">Shuffle</span>
                          </Button>
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-3 text-xs leading-5">
                          <p id="name-rule" className="text-[var(--muted)]">
                            {NAME_RULE}
                          </p>
                          <span className={cx("shrink-0 tabular-nums", cleanName.length > NAME_MAX ? "text-red-300" : "text-[var(--muted)]")}>
                            {cleanName.length}/{NAME_MAX}
                          </span>
                        </div>
                        <p id="name-problem" aria-live="polite" className="mt-1 text-sm text-red-300">
                          {problem ?? ""}
                        </p>
                      </ChoiceGroup>
                      <ChoiceGroup id="voice" title="Voice" value={voiceInfo?.description ?? voice}>
                        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:gap-3">
                          {voices.map((item) => (
                            <OptionCard
                              key={item.id}
                              title={item.description}
                              detail={item.tone}
                              icon={VOICE_ICON}
                              selected={voice === item.id}
                              onClick={() => setVoice(item.id)}
                            />
                          ))}
                        </div>
                      </ChoiceGroup>
                      <div className="mt-8 lg:hidden">{creditsPanel}</div>
                    </>
                  ) : null}

                  {step === "portrait" ? (
                    <div className="grid items-start gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:gap-8">
                      {/* As big as the screen allows: the whole portrait fits above the action bar. */}
                      <div className="mx-auto w-full max-w-md md:mx-0 md:w-[clamp(16rem,calc((100dvh_-_22rem)*0.75),22rem)] lg:w-[clamp(18rem,calc((100dvh_-_22rem)*0.75),30rem)]">
                        {drawing ? (
                          <GeneratingCard preview={preview} lines={progressLines} />
                        ) : portrait?.url ? (
                          <div
                            className={cx(
                              "relative aspect-[3/4] w-full overflow-hidden rounded-3xl shadow-[0_30px_80px_-30px_rgba(255,79,139,0.55)] ring-1 ring-white/10",
                              portraitShown === portrait.id ? "bg-[var(--surface)]" : styles.shimmer,
                            )}
                          >
                            <MediaImage
                              key={portrait.id}
                              url={portrait.url}
                              alt={`Portrait of ${cleanName}`}
                              onShown={() => setPortraitShown(portrait.id)}
                              className={cx(
                                "absolute inset-0 h-full w-full object-cover",
                                portraitShown === portrait.id ? styles.reveal : "opacity-0",
                              )}
                            />
                          </div>
                        ) : (
                          <div
                            className="relative isolate flex aspect-[3/4] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] px-6 text-center"
                            aria-live="polite"
                          >
                            <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
                              <Image src={preview} alt="" fill sizes="64px" className="scale-110 object-cover opacity-15 blur-2xl" />
                            </div>
                            <span
                              className={cx(
                                "flex h-12 w-12 items-center justify-center rounded-2xl",
                                needsCredits ? "bg-[var(--premium)]/15 text-[var(--premium)]" : "bg-red-500/10 text-red-300",
                              )}
                              aria-hidden
                            >
                              {needsCredits ? <CoinIcon className="h-6 w-6" /> : <RefreshIcon className="h-6 w-6" />}
                            </span>
                            <span className="max-w-xs text-sm font-semibold text-[var(--ink)]">
                              {portraitError ?? "Something went wrong. Try again."}
                            </span>
                            {needsCredits ? (
                              <Link
                                href="/premium"
                                className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold !text-[var(--muted)] hover:!text-[var(--ink)]"
                              >
                                Or get membership
                                <ChevronRightIcon className="h-4 w-4" />
                              </Link>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col gap-4">
                        <Panel className="p-5 sm:p-6">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]">
                            {drawing ? "Drawing the portrait" : portrait ? "Ready to chat" : "Your character"}
                          </p>
                          <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)] sm:text-3xl">
                            {cleanName} <span className="font-medium text-[var(--muted)]">{ageLabel(age)}</span>
                          </p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {[role, personality, occupation].filter(Boolean).join(" · ")}
                          </p>
                          <dl className="mt-5 grid gap-3 border-t border-[var(--line)] pt-5">
                            {traits.map((trait) => {
                              const values = trait.values.filter((value): value is string => Boolean(value));
                              return values.length ? (
                                <div key={trait.label} className="grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
                                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{trait.label}</dt>
                                  <dd className="flex flex-wrap gap-1.5">
                                    {values.map((value) => (
                                      <span
                                        key={value}
                                        className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink)]"
                                      >
                                        {value}
                                      </span>
                                    ))}
                                  </dd>
                                </div>
                              ) : null;
                            })}
                          </dl>
                          {portrait && !drawing ? (
                            <p className="mt-5 flex items-start gap-2 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--muted)]">
                              <RefreshIcon className="mt-0.5 h-4 w-4" />
                              <span>
                                Not quite right? Regenerate draws a new one from the same choices for {COSTS.portrait} credits
                                {balance ? `. You have ${balance} credits.` : "."}
                              </span>
                            </p>
                          ) : null}
                        </Panel>
                        <p className="text-xs leading-5 text-[var(--muted)]">
                          {cleanName || "This character"} is an AI character and the portrait is AI-generated. Every character on
                          Simulust is a fictional adult.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <ActionBar
                onBack={index > 0 ? back : undefined}
                backDisabled={saving}
                compactBack={step === "portrait"}
                hint={hint}
                message={stepError ?? (step === "portrait" ? saveError : null)}
              >
                {primary}
              </ActionBar>
            </div>
          </div>

          {step !== "portrait" ? (
            <SummaryPanel
              preview={preview}
              title={summaryTitle}
              subtitle={summarySubtitle}
              done={doneCount}
              total={PORTRAIT_INDEX}
              footer={creditsPanel}
              {...rowProps}
            />
          ) : null}
        </div>
      </div>
      {created ? (
        <NudePortraitDialog
          person={created}
          heading={`${firstName(created.name)} is ready`}
          skip={{ label: "Start chatting", onClick: () => router.push(`/date/${created.id}`) }}
          finish={{ label: `Chat with ${firstName(created.name)}`, onClick: () => router.push(`/date/${created.id}`) }}
        />
      ) : null}
    </AppShell>
  );
}
