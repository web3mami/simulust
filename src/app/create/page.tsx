"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useSession } from "@/components/auth-gate";
import { ApiError, useApi, useAuthHeaders } from "@/lib/api";
import type { CharacterDTO, MediaDTO } from "@/lib/api-types";
import { JOBS, KINKS, PERSONALITIES, type PortraitRequest } from "@/lib/portrait-prompt";
import { COSTS, FREE } from "@/lib/pricing";

type Section = "girls" | "guys";
type Style = "realistic" | "anime";
type Step = "style" | "ethnicity" | "hair" | "body" | "breast" | "train" | "portrait";

const GIRL_NAMES = ["Elena Voss", "Maren Cole", "Camille Ortiz", "Priya Shah", "Ingrid Hale"];
const GUY_NAMES = ["Adrian Cole", "Marco Diaz", "Julian Park", "Malik Grant", "Kenji Mori"];

// Every option is typed against the lists the portrait and character routes
// accept, so the page can only send values the server takes.
type Option<Field extends keyof PortraitRequest> = { id: NonNullable<PortraitRequest[Field]>; src: string };

const GIRL_ROLES: PortraitRequest["role"][] = ["Girlfriend", "Stranger", "Exclusive", "Friends with benefits"];
const GUY_ROLES: PortraitRequest["role"][] = ["Boyfriend", "Stranger", "Exclusive", "Friends with benefits"];
const VOICES = ["Voice 1", "Voice 2", "Voice 3", "Voice 4", "Voice 5", "Voice 6"];

const MIN_AGE = 18;
const MAX_AGE = 39;
const clampAge = (value: number) => Math.min(MAX_AGE, Math.max(MIN_AGE, Math.round(Number.isFinite(value) ? value : MIN_AGE)));

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

const GIRL_ETHNICITY: (Option<"ethnicity"> & { realistic: string })[] = [
  { id: "Caucasian", src: "/creator/eth-girl-anime-caucasian.jpg", realistic: "/characters/june.jpg" },
  { id: "Asian", src: "/creator/eth-girl-anime-asian.jpg", realistic: "/characters/aiko.jpg" },
  { id: "Latina", src: "/creator/eth-girl-anime-latina.jpg", realistic: "/characters/lucia.jpg" },
  { id: "Black", src: "/creator/eth-girl-anime-black.jpg", realistic: "/characters/amara.jpg" },
];

const GUY_ETHNICITY: (Option<"ethnicity"> & { realistic: string })[] = [
  { id: "Caucasian", src: "/creator/eth-guy-anime-caucasian.jpg", realistic: "/creator/eth-guy-realistic-caucasian.jpg" },
  { id: "Asian", src: "/creator/eth-guy-anime-asian.jpg", realistic: "/creator/eth-guy-realistic-asian.jpg" },
  { id: "Latino", src: "/creator/eth-guy-anime-latino.jpg", realistic: "/creator/eth-guy-realistic-latino.jpg" },
  { id: "Black", src: "/creator/eth-guy-anime-black.jpg", realistic: "/creator/eth-guy-realistic-black.jpg" },
];

const HAIR: Option<"hair">[] = [
  { id: "Blonde", src: "/creator/hair-blonde.jpg" },
  { id: "Brunette", src: "/creator/hair-brunette.jpg" },
  { id: "Black", src: "/creator/hair-black.jpg" },
  { id: "Red", src: "/creator/hair-red.jpg" },
];

const GIRL_HAIR_STYLES: (Option<"hairStyle"> & { anime: string })[] = [
  { id: "Straight", src: "/creator/hair-style-girl-straight.jpg", anime: "/creator/hair-style-girl-anime-straight.jpg" },
  { id: "Wavy", src: "/creator/hair-style-girl-wavy.jpg", anime: "/creator/hair-style-girl-anime-wavy.jpg" },
  { id: "Curly", src: "/creator/hair-style-girl-curly.jpg", anime: "/creator/hair-style-girl-anime-curly.jpg" },
  { id: "Coily", src: "/creator/hair-style-girl-coily.jpg", anime: "/creator/hair-style-girl-anime-coily.jpg" },
  { id: "Long", src: "/creator/hair-style-girl-long.jpg", anime: "/creator/hair-style-girl-anime-long.jpg" },
  { id: "Short", src: "/creator/hair-style-girl-short.jpg", anime: "/creator/hair-style-girl-anime-short.jpg" },
  { id: "Ponytail", src: "/creator/hair-style-girl-ponytail.jpg", anime: "/creator/hair-style-girl-anime-ponytail.jpg" },
  { id: "Bun", src: "/creator/hair-style-girl-bun.jpg", anime: "/creator/hair-style-girl-anime-bun.jpg" },
];

const GUY_HAIR_STYLES: (Option<"hairStyle"> & { anime: string })[] = [
  { id: "Short", src: "/creator/hair-style-guy-short.jpg", anime: "/creator/hair-style-guy-anime-short.jpg" },
  { id: "Medium", src: "/creator/hair-style-guy-medium.jpg", anime: "/creator/hair-style-guy-anime-medium.jpg" },
  { id: "Long", src: "/creator/hair-style-guy-long.jpg", anime: "/creator/hair-style-guy-anime-long.jpg" },
  { id: "Wavy", src: "/creator/hair-style-guy-wavy.jpg", anime: "/creator/hair-style-guy-anime-wavy.jpg" },
  { id: "Curly", src: "/creator/hair-style-guy-curly.jpg", anime: "/creator/hair-style-guy-anime-curly.jpg" },
  { id: "Buzz", src: "/creator/hair-style-guy-buzz.jpg", anime: "/creator/hair-style-guy-anime-buzz.jpg" },
  { id: "Undercut", src: "/creator/hair-style-guy-undercut.jpg", anime: "/creator/hair-style-guy-anime-undercut.jpg" },
  { id: "Slicked back", src: "/creator/hair-style-guy-slicked.jpg", anime: "/creator/hair-style-guy-anime-slicked.jpg" },
];

const EYE_COLORS: Option<"eyeColor">[] = [
  { id: "Brown", src: "/creator/eye-brown.jpg" },
  { id: "Hazel", src: "/creator/eye-hazel.jpg" },
  { id: "Green", src: "/creator/eye-green.jpg" },
  { id: "Blue", src: "/creator/eye-blue.jpg" },
  { id: "Gray", src: "/creator/eye-gray.jpg" },
  { id: "Amber", src: "/creator/eye-amber.jpg" },
];

const GUY_HAIR: Record<Style, Record<string, string>> = {
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

const BODIES: Option<"body">[] = [
  { id: "Petite", src: "/creator/body-petite.jpg" },
  { id: "Athletic", src: "/creator/body-athletic.jpg" },
  { id: "Curvy", src: "/creator/body-curvy.jpg" },
  { id: "Thick", src: "/creator/body-thick.jpg" },
];

const GUY_BODIES: Option<"body">[] = [
  { id: "Slim", src: "/creator/body-guy-slim.jpg" },
  { id: "Athletic", src: "/creator/body-guy-athletic.jpg" },
  { id: "Muscular", src: "/creator/body-guy-muscular.jpg" },
  { id: "Soft", src: "/creator/body-guy-soft.jpg" },
];

const BREASTS: Option<"breast">[] = [
  { id: "Small", src: "/creator/breast-small.jpg" },
  { id: "Medium", src: "/creator/breast-medium.jpg" },
  { id: "Large", src: "/creator/breast-large.jpg" },
];

const HAND: Record<Section, Record<Style, string[]>> = {
  girls: {
    realistic: [
      "/creator/style-girl-realistic.jpg",
      "/creator/flow-girl-real-1.jpg",
      "/creator/loop-girl-real-2.jpg",
      "/creator/flow-girl-real-2.jpg",
      "/creator/loop-girl-real-3.jpg",
      "/creator/flow-girl-real-3.jpg",
      "/creator/loop-girl-real-4.jpg",
      "/creator/flow-girl-real-4.jpg",
      "/creator/loop-girl-real-5.jpg",
    ],
    anime: [
      "/creator/style-girl-anime.jpg",
      "/creator/flow-girl-anime-1.jpg",
      "/creator/loop-girl-anime-2.jpg",
      "/creator/flow-girl-anime-2.jpg",
      "/creator/loop-girl-anime-3.jpg",
      "/creator/flow-girl-anime-3.jpg",
      "/creator/loop-girl-anime-4.jpg",
      "/creator/flow-girl-anime-4.jpg",
      "/creator/loop-girl-anime-5.jpg",
    ],
  },
  guys: {
    realistic: [
      "/creator/style-guy-realistic.jpg",
      "/creator/flow-guy-real-1.jpg",
      "/creator/loop-guy-real-2.jpg",
      "/creator/flow-guy-real-2.jpg",
      "/creator/loop-guy-real-3.jpg",
      "/creator/flow-guy-real-3.jpg",
      "/creator/loop-guy-real-4.jpg",
      "/creator/flow-guy-real-4.jpg",
      "/creator/loop-guy-real-5.jpg",
    ],
    anime: [
      "/creator/style-guy-anime.jpg",
      "/creator/flow-guy-anime-1.jpg",
      "/creator/loop-guy-anime-2.jpg",
      "/creator/flow-guy-anime-2.jpg",
      "/creator/loop-guy-anime-3.jpg",
      "/creator/flow-guy-anime-3.jpg",
      "/creator/loop-guy-anime-4.jpg",
      "/creator/flow-guy-anime-4.jpg",
      "/creator/loop-guy-anime-5.jpg",
    ],
  },
};

function EyeColorCard({
  src,
  label,
  selected,
  onClick,
}: {
  src: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border bg-[#171717] text-left ${
        selected ? "border-white" : "border-white/10"
      }`}
    >
      <div className="flex h-[4.75rem] items-center justify-center px-2 pt-2 sm:h-24">
        <img src={src} alt="" className="max-h-14 max-w-[3.5rem] object-contain sm:max-h-16 sm:max-w-16" />
      </div>
      <span className="block px-1 pb-2.5 text-center text-sm font-semibold">{label}</span>
      {selected ? (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-black">
          ✓
        </span>
      ) : null}
    </button>
  );
}

// /api/media URLs authenticate with the session cookie. If the browser didn't
// send one, fetch the image with the bearer token instead.
function MediaImage({ url, className }: { url: string; className: string }) {
  const authHeaders = useAuthHeaders();
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    if (!src.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  const retry = useCallback(async () => {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    try {
      const response = await fetch(url, { headers: await authHeaders(), cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setSrc(URL.createObjectURL(await response.blob()));
    } catch {
      setFailed(true);
    }
  }, [url, authHeaders]);

  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center border border-white/10 bg-[#171717] px-6 text-center text-sm text-white/70`}>
        The portrait was made but won&apos;t load. Refresh the page to try again.
      </div>
    );
  }
  return <img src={src} alt="" className={className} onError={() => void retry()} />;
}

function PictureCard({
  src,
  frames,
  label,
  selected,
  onClick,
}: {
  src: string;
  frames?: string[];
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const frameKey = frames?.join("|") ?? "";
  const poses = useMemo(() => (frameKey ? frameKey.split("|") : [src]), [frameKey, src]);
  const photo = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = photo.current;
    if (!el || poses.length < 2) return;
    let cancelled = false;
    let raf = 0;
    let shown = -1;
    const cache = poses.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });
    const start = performance.now();
    const tick = (now: number) => {
      if (cancelled || !photo.current) return;
      const progress = ((now - start) % 8000) / 8000;
      const trip = progress < 0.5 ? progress * 2 : 2 - progress * 2;
      const index = Math.min(poses.length - 1, Math.round(trip * (poses.length - 1)));
      if (index !== shown) {
        photo.current.src = cache[index].src;
        shown = index;
      }
      raf = requestAnimationFrame(tick);
    };
    Promise.all(cache.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (!cancelled) raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [poses]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border bg-[#171717] text-left ${
        selected ? "border-white" : "border-white/10"
      }`}
    >
      <img
        ref={photo}
        src={poses[0] ?? src}
        alt=""
        className="aspect-[3/4] w-full object-cover"
      />
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-3 text-center text-lg font-semibold">
        {label}
      </span>
      {selected ? (
        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm text-black">
          ✓
        </span>
      ) : null}
    </button>
  );
}

export default function CreatePage() {
  const router = useRouter();
  const { session, me, openLogin, refreshMe } = useSession();
  const api = useApi();
  const [section, setSection] = useState<Section>("girls");
  const [style, setStyle] = useState<Style | "">("");
  const [step, setStep] = useState<Step>("style");
  const [ethnicity, setEthnicity] = useState("");
  const [eyeColor, setEyeColor] = useState("");
  const [age, setAge] = useState(24);
  const [hairStyle, setHairStyle] = useState("");
  const [hair, setHair] = useState("");
  const [body, setBody] = useState("");
  const [breast, setBreast] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [name, setName] = useState(GIRL_NAMES[0]);
  const [personality, setPersonality] = useState<string>(PERSONALITIES[0]);
  const [role, setRole] = useState<string>(GIRL_ROLES[0]);
  const [occupation, setOccupation] = useState<string>(JOBS[0]);
  const [kinks, setKinks] = useState<string[]>(["Praise"]);
  const [voice, setVoice] = useState(VOICES[0]);
  const [openField, setOpenField] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<MediaDTO | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const drawToken = useRef(0);

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
    setStep("train");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const steps = useMemo<Step[]>(
    () =>
      section === "girls"
        ? ["style", "ethnicity", "hair", "body", "breast", "train", "portrait"]
        : ["style", "ethnicity", "hair", "body", "train", "portrait"],
    [section],
  );
  const index = steps.indexOf(step);
  const look: Style = style || "realistic";
  const ethnicities = section === "girls" ? GIRL_ETHNICITY : GUY_ETHNICITY;
  const hairStyles = section === "girls" ? GIRL_HAIR_STYLES : GUY_HAIR_STYLES;
  const roles = section === "girls" ? GIRL_ROLES : GUY_ROLES;

  function ethnicitySrc(id: string) {
    const row = ethnicities.find((item) => item.id === id) ?? ethnicities[0];
    return look === "realistic" ? row.realistic : row.src;
  }

  function goSection(next: Section) {
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
    setPortrait(null);
    setPortraitError(null);
    setNeedsCredits(false);
    setStepError(null);
    setStep("style");
  }

  function shuffleName() {
    const pool = section === "girls" ? GIRL_NAMES : GUY_NAMES;
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

  function stepReady(current: Step) {
    if (current === "style") return Boolean(style);
    if (current === "ethnicity") return Boolean(ethnicity && eyeColor);
    if (current === "hair") return Boolean(hair && hairStyle);
    if (current === "body") return Boolean(body);
    if (current === "breast") return Boolean(breast);
    if (current === "train") return Boolean(name.trim() && kinks.length);
    return true;
  }

  function next() {
    if (!stepReady(step)) {
      setStepError("You have to select all options.");
      return;
    }
    setStepError(null);
    const following = steps[index + 1];
    if (following) setStep(following);
  }

  function tryGenerate() {
    if (!stepReady("train")) {
      setStepError("You have to select all options.");
      return;
    }
    if (!session) {
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
      setStepError("Log in to generate your portrait. Your choices are saved.");
      openLogin();
      return;
    }
    setStepError(null);
    void drawPortrait();
  }

  function back() {
    setStepError(null);
    const previous = steps[index - 1];
    if (previous) setStep(previous);
  }

  async function drawPortrait() {
    const token = drawToken.current + 1;
    drawToken.current = token;
    setStep("portrait");
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
      router.push(`/date/${character.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) openLogin();
      setSaveError(error instanceof Error ? error.message : "We couldn't save your character. Try again.");
      setSaving(false);
    }
  }

  const styleCards =
    section === "girls"
      ? [
          { id: "realistic" as const, label: "Realistic", src: "/creator/style-girl-realistic.jpg" },
          { id: "anime" as const, label: "Anime", src: "/creator/style-girl-anime.jpg" },
        ]
      : [
          { id: "realistic" as const, label: "Realistic", src: "/creator/style-guy-realistic.jpg" },
          { id: "anime" as const, label: "Anime", src: "/creator/style-guy-anime.jpg" },
        ];

  return (
    <AppShell>
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 pb-16">
        <div className="mb-8 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-[var(--gold)]"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>

        {step === "style" ? (
          <section>
            <h1 className="text-center text-4xl font-semibold">
              {section === "girls" ? "Create my AI girl" : "Create my AI guy"}
            </h1>
            <div className="mt-6 flex justify-center gap-3">
              {(["girls", "guys"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => goSection(item)}
                  className={`rounded-full border px-5 py-2 text-sm ${
                    section === item ? "border-[var(--accent)] text-white" : "border-white/15 text-white/70"
                  }`}
                >
                  {item === "girls" ? "Girls" : "Guys"}
                </button>
              ))}
            </div>
            <div className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-4">
              {styleCards.map((card) => (
                <PictureCard
                  key={card.id}
                  src={card.src}
                  frames={HAND[section][card.id]}
                  label={card.label}
                  selected={style === card.id}
                  onClick={() => {
                    setStyle(card.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <StepNav error={stepError} onNext={next} />
          </section>
        ) : null}

        {step === "ethnicity" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Choose ethnicity</h1>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ethnicities.map((item) => (
                <PictureCard
                  key={item.id}
                  src={ethnicitySrc(item.id)}
                  label={item.id}
                  selected={ethnicity === item.id}
                  onClick={() => {
                    setEthnicity(item.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <h2 className="mt-10 text-center text-3xl font-semibold">Choose age</h2>
            <div className="mt-4 rounded-2xl border border-white/10 bg-[#171717] px-5 py-6">
              <p className="mx-auto w-fit rounded-lg border border-[var(--accent)] px-3 py-1 text-sm">
                {age >= 39 ? "39+" : `${age} years`}
              </p>
              <input
                type="range"
                min={MIN_AGE}
                max={MAX_AGE}
                step={1}
                value={age}
                aria-label="Age"
                onChange={(event) => setAge(clampAge(Number(event.target.value)))}
                className="mt-6 w-full accent-[var(--accent)]"
              />
              <div className="mt-2 flex justify-between text-sm text-white/60">
                <span>18</span>
                <span>39+</span>
              </div>
            </div>
            <h2 className="mt-10 text-center text-3xl font-semibold">Eye color</h2>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {EYE_COLORS.map((item) => (
                <EyeColorCard
                  key={item.id}
                  src={item.src}
                  label={item.id}
                  selected={eyeColor === item.id}
                  onClick={() => {
                    setEyeColor(item.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <StepNav error={stepError} onPrev={back} onNext={next} />
          </section>
        ) : null}

        {step === "hair" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Hair style</h1>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {hairStyles.map((item) => (
                <PictureCard
                  key={item.id}
                  src={look === "anime" ? item.anime : item.src}
                  label={item.id}
                  selected={hairStyle === item.id}
                  onClick={() => {
                    setHairStyle(item.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <h2 className="mt-10 text-center text-3xl font-semibold">Hair color</h2>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {HAIR.map((item) => (
                <PictureCard
                  key={item.id}
                  src={section === "girls" ? item.src : GUY_HAIR[look][item.id]}
                  label={item.id}
                  selected={hair === item.id}
                  onClick={() => {
                    setHair(item.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <StepNav error={stepError} onPrev={back} onNext={next} />
          </section>
        ) : null}

        {step === "body" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Body type</h1>
            {section === "girls" ? (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {BODIES.map((item) => (
                  <PictureCard
                    key={item.id}
                    src={item.src}
                    label={item.id}
                    selected={body === item.id}
                    onClick={() => {
                      setBody(item.id);
                      setStepError(null);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {GUY_BODIES.map((item) => (
                  <PictureCard
                    key={item.id}
                    src={item.src}
                    label={item.id}
                    selected={body === item.id}
                    onClick={() => {
                      setBody(item.id);
                      setStepError(null);
                    }}
                  />
                ))}
              </div>
            )}
            <StepNav error={stepError} onPrev={back} onNext={next} />
          </section>
        ) : null}

        {step === "breast" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Breast size</h1>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {BREASTS.map((item) => (
                <PictureCard
                  key={item.id}
                  src={item.src}
                  label={item.id}
                  selected={breast === item.id}
                  onClick={() => {
                    setBreast(item.id);
                    setStepError(null);
                  }}
                />
              ))}
            </div>
            <StepNav error={stepError} onPrev={back} onNext={next} />
          </section>
        ) : null}

        {step === "train" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Choose a name</h1>
            <div className="mt-4 flex items-center rounded-xl border border-white/10 bg-[#171717]">
              <input
                value={name}
                maxLength={30}
                aria-label="Name"
                onChange={(event) => {
                  setName(event.target.value);
                  setStepError(null);
                }}
                className="w-full bg-transparent px-4 py-3 outline-none"
              />
              <button type="button" className="px-4 text-white/70" onClick={shuffleName} aria-label="Shuffle name">
                Shuffle
              </button>
            </div>
            <p className="mt-1 text-right text-xs text-white/40">{name.trim().length}/30</p>

            <h2 className="mt-8 text-center text-3xl font-semibold">Choose personality</h2>
            <p className="text-center text-sm text-white/50">Click to change</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field
                label="Choose personality"
                value={personality}
                open={openField === "personality"}
                options={PERSONALITIES}
                onToggle={() => setOpenField(openField === "personality" ? null : "personality")}
                onPick={(value) => {
                  setPersonality(value);
                  setOpenField(null);
                }}
              />
              <Field
                label="Choose relationship"
                value={role}
                open={openField === "role"}
                options={roles}
                onToggle={() => setOpenField(openField === "role" ? null : "role")}
                onPick={(value) => {
                  setRole(value);
                  setOpenField(null);
                }}
              />
              <Field
                label="Choose occupation"
                value={occupation}
                open={openField === "job"}
                options={JOBS}
                onToggle={() => setOpenField(openField === "job" ? null : "job")}
                onPick={(value) => {
                  setOccupation(value);
                  setOpenField(null);
                }}
              />
              <div className="rounded-2xl border border-white/10 bg-[#171717] p-4">
                <p className="text-xs uppercase text-white/45">Kinks, max 3</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {KINKS.map((kink) => {
                    const on = kinks.includes(kink);
                    return (
                      <button
                        key={kink}
                        type="button"
                        onClick={() => {
                          toggleKink(kink);
                          setStepError(null);
                        }}
                        className={`rounded-full border px-3 py-1 text-sm ${
                          on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-white/15"
                        }`}
                      >
                        {kink}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Field
                label="Choose voice"
                value={voice}
                open={openField === "voice"}
                options={VOICES}
                onToggle={() => setOpenField(openField === "voice" ? null : "voice")}
                onPick={(value) => {
                  setVoice(value);
                  setOpenField(null);
                }}
              />
            </div>
            <p className="mt-6 text-center text-sm text-white/60">
              {me
                ? `A portrait uses ${COSTS.portrait} credits. You have ${me.balance.toLocaleString("en-US")}.`
                : `A portrait uses ${COSTS.portrait} credits. New accounts start with ${FREE.signupCredits} free.`}
            </p>
            <StepNav
              error={stepError}
              onPrev={back}
              onNext={tryGenerate}
              nextLabel={`Generate portrait · ${COSTS.portrait} credits`}
            />
          </section>
        ) : null}

        {step === "portrait" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Your character</h1>
            <p className="mt-2 text-center text-sm text-white/50">
              {section === "girls"
                ? "Drawn from the style, ethnicity, age, hair, body, breast size, and personality you picked."
                : "Drawn from the style, ethnicity, age, hair, body, and personality you picked."}
            </p>
            <div className="mx-auto mt-6 max-w-sm">
              {portrait?.url ? (
                <MediaImage key={portrait.id} url={portrait.url} className="aspect-[3/4] w-full rounded-2xl object-cover" />
              ) : (
                <div
                  className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#171717] px-6 text-center text-white/70"
                  aria-live="polite"
                >
                  {drawing ? (
                    <>
                      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[var(--gold)]" aria-hidden />
                      <span>Drawing this character from your choices…</span>
                    </>
                  ) : (
                    <>
                      <span>{portraitError ?? "Something went wrong. Try again."}</span>
                      {needsCredits ? (
                        <Link href="/premium" className="rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-medium !text-[#12110F]">
                          Get credits
                        </Link>
                      ) : null}
                    </>
                  )}
                </div>
              )}
              {portrait && !drawing ? (
                <button
                  type="button"
                  className="mx-auto mt-3 block text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
                  onClick={drawPortrait}
                >
                  Redraw · {COSTS.portrait} credits
                </button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-white/70">
              {[
                look === "anime" ? "Anime" : "Realistic",
                ethnicity,
                age >= 39 ? "39+" : `${age}`,
                eyeColor,
                hairStyle,
                hair,
                body,
                section === "girls" ? breast : null,
                personality,
                occupation,
              ]
                .filter(Boolean)
                .map((chip) => (
                  <span key={chip} className="rounded-full border border-white/15 px-3 py-1">
                    {chip}
                  </span>
                ))}
            </div>
            {saveError ? <p className="mt-6 text-center text-sm text-red-400">{saveError}</p> : null}
            <div className="mt-8 flex gap-3">
              <button
                type="button"
                className="w-full rounded-full border border-white/20 py-3 font-medium"
                onClick={back}
                disabled={saving}
              >
                Previous
              </button>
              {portraitError && !drawing ? (
                needsCredits ? (
                  <Link
                    href="/premium"
                    className="w-full rounded-full bg-[var(--accent)] py-3 text-center font-medium"
                  >
                    Get credits
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded-full border border-white/20 py-3 font-medium"
                    onClick={session ? drawPortrait : openLogin}
                  >
                    {session ? `Try again · ${COSTS.portrait} credits` : "Log in"}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={!portrait || drawing || saving}
                  className="w-full rounded-full bg-[var(--accent)] py-3 font-medium disabled:opacity-40"
                  onClick={finish}
                >
                  {saving ? "Saving…" : "Start the date"}
                </button>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function StepNav({
  error,
  onNext,
  onPrev,
  nextLabel = "Next",
}: {
  error: string | null;
  onNext: () => void;
  onPrev?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="mt-8">
      {error ? <p className="mb-3 text-center text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-3">
        {onPrev ? (
          <button
            type="button"
            className="w-full rounded-full border border-white/20 py-3 font-medium"
            onClick={onPrev}
          >
            Previous
          </button>
        ) : null}
        <button type="button" className="w-full rounded-full bg-[var(--accent)] py-3 font-medium" onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  open,
  options,
  onToggle,
  onPick,
}: {
  label: string;
  value: string;
  open: boolean;
  options: readonly string[];
  onToggle: () => void;
  onPick: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#171717] p-4">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <span>
          <span className="block text-xs uppercase text-white/45">{label}</span>
          <span className="mt-1 block text-lg font-semibold">{value}</span>
        </span>
        <span className="text-white/50">Edit</span>
      </button>
      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onPick(option)}
              className={`rounded-full border px-3 py-1 text-sm ${
                option === value ? "border-white bg-white text-black" : "border-white/15"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
