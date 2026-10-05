"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { savePerson, type Character, type Lane } from "@/lib/characters";

type Section = "girls" | "guys";
type Style = "realistic" | "anime";
type Step = "style" | "ethnicity" | "hair" | "body" | "breast" | "train" | "portrait";

const GIRL_NAMES = ["Elena Voss", "Maren Cole", "Camille Ortiz", "Priya Shah", "Ingrid Hale"];
const GUY_NAMES = ["Adrian Cole", "Marco Diaz", "Julian Park", "Malik Grant", "Kenji Mori"];

const PERSONALITIES = ["Submissive", "Dominant", "Sweet", "Bratty", "Playful", "Cold"];
const GIRL_ROLES = ["Girlfriend", "Stranger", "Exclusive", "Friends with benefits"];
const GUY_ROLES = ["Boyfriend", "Stranger", "Exclusive", "Friends with benefits"];
const JOBS = ["Designer", "Bartender", "Nurse", "Model", "Chef", "Photographer", "Dancer", "Founder"];
const KINKS = ["Praise", "Teasing", "Dominance", "Submission", "Lingerie", "Possessive"];
const VOICES = ["Voice 1", "Voice 2", "Voice 3", "Voice 4", "Voice 5", "Voice 6"];

const GIRL_ETHNICITY = [
  { id: "Caucasian", src: "/creator/eth-girl-anime-caucasian.jpg", realistic: "/characters/june.jpg" },
  { id: "Asian", src: "/creator/eth-girl-anime-asian.jpg", realistic: "/characters/aiko.jpg" },
  { id: "Latina", src: "/creator/eth-girl-anime-latina.jpg", realistic: "/characters/lucia.jpg" },
  { id: "Black", src: "/creator/eth-girl-anime-black.jpg", realistic: "/characters/amara.jpg" },
];

const GUY_ETHNICITY = [
  { id: "Caucasian", src: "/creator/eth-guy-anime-caucasian.jpg", realistic: "/creator/eth-guy-realistic-caucasian.jpg" },
  { id: "Asian", src: "/creator/eth-guy-anime-asian.jpg", realistic: "/creator/eth-guy-realistic-asian.jpg" },
  { id: "Latino", src: "/creator/eth-guy-anime-latino.jpg", realistic: "/creator/eth-guy-realistic-latino.jpg" },
  { id: "Black", src: "/creator/eth-guy-anime-black.jpg", realistic: "/creator/eth-guy-realistic-black.jpg" },
];

const HAIR = [
  { id: "Blonde", src: "/creator/hair-blonde.jpg" },
  { id: "Brunette", src: "/creator/hair-brunette.jpg" },
  { id: "Black", src: "/creator/hair-black.jpg" },
  { id: "Red", src: "/creator/hair-red.jpg" },
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

const BODIES = [
  { id: "Petite", src: "/creator/body-petite.jpg" },
  { id: "Athletic", src: "/creator/body-athletic.jpg" },
  { id: "Curvy", src: "/creator/body-curvy.jpg" },
  { id: "Thick", src: "/creator/body-thick.jpg" },
];

const GUY_BODIES = ["Slim", "Athletic", "Muscular", "Soft"];

const BREASTS = [
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
      <img ref={photo} src={poses[0] ?? src} alt="" className="aspect-[3/4] w-full object-cover" />
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
  const [section, setSection] = useState<Section>("girls");
  const [style, setStyle] = useState<Style>("realistic");
  const [step, setStep] = useState<Step>("style");
  const [ethnicity, setEthnicity] = useState("Caucasian");
  const [age, setAge] = useState(24);
  const [hair, setHair] = useState("Blonde");
  const [body, setBody] = useState("Curvy");
  const [breast, setBreast] = useState("Medium");
  const [name, setName] = useState(GIRL_NAMES[0]);
  const [personality, setPersonality] = useState(PERSONALITIES[0]);
  const [role, setRole] = useState(GIRL_ROLES[0]);
  const [occupation, setOccupation] = useState(JOBS[0]);
  const [kinks, setKinks] = useState<string[]>(["Praise"]);
  const [voice, setVoice] = useState(VOICES[0]);
  const [openField, setOpenField] = useState<string | null>(null);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const drawToken = useRef(0);

  const steps = useMemo<Step[]>(
    () =>
      section === "girls"
        ? ["style", "ethnicity", "hair", "body", "breast", "train", "portrait"]
        : ["style", "ethnicity", "hair", "body", "train", "portrait"],
    [section],
  );
  const index = steps.indexOf(step);
  const ethnicities = section === "girls" ? GIRL_ETHNICITY : GUY_ETHNICITY;
  const roles = section === "girls" ? GIRL_ROLES : GUY_ROLES;

  function ethnicitySrc(id: string) {
    const row = ethnicities.find((item) => item.id === id) ?? ethnicities[0];
    return style === "realistic" ? row.realistic : row.src;
  }

  function goSection(next: Section) {
    setSection(next);
    setStyle("realistic");
    setEthnicity(next === "girls" ? "Caucasian" : "Caucasian");
    setBody(next === "girls" ? "Curvy" : "Athletic");
    setRole(next === "girls" ? GIRL_ROLES[0] : GUY_ROLES[0]);
    setName(next === "girls" ? GIRL_NAMES[0] : GUY_NAMES[0]);
    setHair(next === "girls" ? "Blonde" : "Black");
    setPortrait(null);
    setPortraitError(null);
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

  function next() {
    const following = steps[index + 1];
    if (following) setStep(following);
  }

  function back() {
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
    try {
      const payloadBody = JSON.stringify({
        section,
        style,
        ethnicity,
        age,
        hair,
        body,
        breast: section === "girls" ? breast : undefined,
        personality,
        role,
        occupation,
        kinks,
      });
      let response = await fetch("/api/portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadBody,
      });
      if (!response.ok) {
        response = await fetch("/api/portrait", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadBody,
        });
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Portrait could not be generated.");
      }
      const blob = await response.blob();
      const rawUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the portrait."));
        reader.readAsDataURL(blob);
      });
      const dataUrl = await cropMark(rawUrl);
      if (token !== drawToken.current) return;
      setPortrait(dataUrl);
    } catch (error) {
      if (token !== drawToken.current) return;
      setPortraitError(error instanceof Error ? error.message : "Portrait could not be generated.");
    } finally {
      if (token === drawToken.current) setDrawing(false);
    }
  }

  function finish() {
    if (!portrait) return;
    const lane: Lane = style === "anime" ? "anime" : section === "guys" ? "guys" : "girls";
    const person: Character = {
      id: crypto.randomUUID(),
      name: name.trim() || "Unnamed",
      age,
      gender: section === "guys" ? "Man" : "Woman",
      ethnicity,
      body,
      role,
      heat: personality,
      line: `${name.trim()} is ${personality.toLowerCase()}, works as a ${occupation.toLowerCase()}, and likes ${kinks.join(", ") || "being direct"}. ${voice}.`,
      color: "#3a3348",
      lane,
      tags: [body, personality, hair],
      image: portrait,
      hair,
      breast: section === "girls" ? breast : undefined,
      personality,
      occupation,
      kinks,
      voice,
    };
    savePerson(person);
    router.push(`/date/${person.id}`);
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

        {step !== "style" ? (
          <button type="button" className="mb-4 text-sm text-white/70" onClick={back}>
            Back
          </button>
        ) : null}

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
                    next();
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

        {step === "ethnicity" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Choose ethnicity</h1>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ethnicities.map((item) => (
                <PictureCard
                  key={item.id}
                  src={style === "realistic" ? item.realistic : item.src}
                  label={item.id}
                  selected={ethnicity === item.id}
                  onClick={() => setEthnicity(item.id)}
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
                min={18}
                max={39}
                value={age}
                onChange={(event) => setAge(Number(event.target.value))}
                className="mt-6 w-full accent-[var(--accent)]"
              />
              <div className="mt-2 flex justify-between text-sm text-white/60">
                <span>18</span>
                <span>39+</span>
              </div>
            </div>
            <button
              type="button"
              className="mt-8 w-full rounded-full bg-[var(--accent)] py-3 font-medium"
              onClick={next}
            >
              Next
            </button>
          </section>
        ) : null}

        {step === "hair" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Hair color</h1>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {HAIR.map((item) => (
                <PictureCard
                  key={item.id}
                  src={section === "girls" ? item.src : GUY_HAIR[style][item.id]}
                  label={item.id}
                  selected={hair === item.id}
                  onClick={() => setHair(item.id)}
                />
              ))}
            </div>
            <button type="button" className="mt-8 w-full rounded-full bg-[var(--accent)] py-3 font-medium" onClick={next}>
              Next
            </button>
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
                    onClick={() => setBody(item.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-3">
                {GUY_BODIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setBody(item)}
                    className={`rounded-2xl border px-4 py-8 text-lg ${
                      body === item ? "border-white bg-white/10" : "border-white/10"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="mt-8 w-full rounded-full bg-[var(--accent)] py-3 font-medium" onClick={next}>
              Next
            </button>
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
                  onClick={() => setBreast(item.id)}
                />
              ))}
            </div>
            <button type="button" className="mt-8 w-full rounded-full bg-[var(--accent)] py-3 font-medium" onClick={next}>
              Next
            </button>
          </section>
        ) : null}

        {step === "train" ? (
          <section>
            <h1 className="text-center text-3xl font-semibold">Choose a name</h1>
            <div className="mt-4 flex items-center rounded-xl border border-white/10 bg-[#171717]">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full bg-transparent px-4 py-3 outline-none"
              />
              <button type="button" className="px-4 text-white/70" onClick={shuffleName} aria-label="Shuffle name">
                Shuffle
              </button>
            </div>
            <p className="mt-1 text-right text-xs text-white/40">{name.trim().length}/40</p>

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
                        onClick={() => toggleKink(kink)}
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
            <button
              type="button"
              className="mt-8 w-full rounded-full bg-[var(--accent)] py-3 font-medium"
              onClick={drawPortrait}
            >
              Generate portrait
            </button>
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
              {portrait ? (
                <img src={portrait} alt="" className="aspect-[3/4] w-full rounded-2xl object-cover" />
              ) : (
                <div className="flex aspect-[3/4] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#171717] px-6 text-center text-white/70">
                  {drawing ? "Drawing this character from your choices…" : portraitError}
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-white/70">
              {[
                style === "anime" ? "Anime" : "Realistic",
                ethnicity,
                age >= 39 ? "39+" : `${age}`,
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
            <div className="mt-8 flex gap-3">
              {portraitError ? (
                <button
                  type="button"
                  className="w-full rounded-full border border-white/20 py-3 font-medium"
                  onClick={drawPortrait}
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                disabled={!portrait || drawing}
                className="w-full rounded-full bg-[var(--accent)] py-3 font-medium disabled:opacity-40"
                onClick={finish}
              >
                Start the date
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function cropMark(dataUrl: string) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const cut = Math.round(img.height * 0.055);
      canvas.width = img.width;
      canvas.height = Math.max(1, img.height - cut);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, img.width, canvas.height, 0, 0, img.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Could not read the portrait."));
    img.src = dataUrl;
  });
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
  options: string[];
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
