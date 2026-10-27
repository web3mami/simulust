"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { SparkIcon } from "@/components/icons";
import { cx } from "@/components/ui";
import styles from "@/components/create/motion.module.css";

const LINE_MS = 1600;

// The portrait step while the picture is drawn: the blurred preview drifts, a
// band of light sweeps across, a bar runs, and a line under it says what's
// being worked on, built from the viewer's own choices.
export function GeneratingCard({ preview, lines }: { preview: string; lines: string[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), LINE_MS);
    return () => window.clearInterval(timer);
  }, []);
  // Walks through the lines once, then stays on the last one.
  const line = lines[Math.min(tick, lines.length - 1)] ?? "";

  return (
    <div className="relative isolate flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] px-6 text-center">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <Image src={preview} alt="" fill sizes="64px" className={cx("object-cover opacity-50 blur-2xl", styles.drift)} />
      </div>
      <div className={cx("absolute inset-0 -z-10", styles.sweep)} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_50%_at_50%_50%,rgba(0,0,0,0.55),transparent)]" aria-hidden />

      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/35 text-[var(--accent)] shadow-[0_0_40px_-4px_rgba(255,79,139,0.6)] ring-1 ring-white/10 backdrop-blur">
        <SparkIcon className="h-7 w-7" />
      </span>

      <p className="mt-5 text-lg font-bold text-white">Drawing your portrait</p>
      <div className="mt-4 h-1 w-full max-w-[16rem] overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className={cx("h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]", styles.bar)} />
      </div>
      <p aria-live="polite" className="mt-3 min-h-10 max-w-[18rem] text-sm leading-5 text-white/80">
        <span key={line} className={cx("block", styles.rise)}>
          {line}
        </span>
      </p>
    </div>
  );
}
