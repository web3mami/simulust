"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/app-shell";
import { useApi } from "@/lib/api";

type Kind = "ncii" | "csam" | "real_person" | "copyright" | "other";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  {
    value: "ncii",
    label: "An intimate image of me or someone else, shared without consent",
    hint: "Real or AI-made. Handled under the TAKE IT DOWN Act.",
  },
  {
    value: "csam",
    label: "Anything that sexualizes a minor, or someone who looks like one",
    hint: "Includes drawn and anime content. We report it to NCMEC.",
  },
  {
    value: "real_person",
    label: "Content that looks like a real, identifiable person",
    hint: "A celebrity, public figure, or anyone you know.",
  },
  {
    value: "copyright",
    label: "Copyright infringement",
    hint: "For a formal DMCA notice, see our DMCA page.",
  },
  { value: "other", label: "Something else", hint: "Anything else that breaks our content policy." },
];

export default function ReportPage() {
  const api = useApi();
  const [kind, setKind] = useState<Kind | null>(null);
  const [target, setTarget] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [signature, setSignature] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);

  useEffect(() => {
    // Links from elsewhere in the app can prefill what's being reported.
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("target");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (prefill) setTarget(prefill.slice(0, 1000));
    const preKind = params.get("kind");
    if (KINDS.some((option) => option.value === preKind)) setKind(preKind as Kind);
  }, []);

  const ncii = kind === "ncii";

  async function submit() {
    if (!kind) {
      setError("Choose what you're reporting.");
      return;
    }
    if (!target.trim()) {
      setError("Tell us where the content is: paste the page link, media id or character id.");
      return;
    }
    if (ncii && (!email.trim() || !signature.trim() || !goodFaith)) {
      setError("For this kind of request we need your email, your name as a signature, and the statement checked.");
      return;
    }
    setBusy(true);
    setError(null);
    // The TAKE IT DOWN Act asks for a signature and a good-faith statement;
    // they travel with the details so the reviewer sees them together.
    const full = ncii
      ? `${details.trim()}\n\nSigned: ${signature.trim()}\nGood-faith statement: I believe this depiction was published without the consent of the person shown.`.trim()
      : details.trim();
    try {
      const result = await api<{ ok: true; dueAt: string }>("/api/reports", {
        method: "POST",
        json: { kind, target: target.trim(), details: full.slice(0, 5000), email: email.trim() || undefined },
      });
      setDueAt(result.dueAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send your report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <AppHeader />
      <section className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--ink)]">Report content</h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          Tell us about anything on Simulust that shouldn&apos;t be here. You don&apos;t need an account. A person reviews
          every report.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">
          <li>
            <strong className="text-[var(--ink)]">Intimate images shared without consent</strong> are removed within 48
            hours of a valid request, as the TAKE IT DOWN Act requires. We also remove copies we can find.
          </li>
          <li>
            <strong className="text-[var(--ink)]">Child sexual abuse material</strong> is removed, the account is closed,
            and we report it to the National Center for Missing &amp; Exploited Children (NCMEC). You can also report
            directly to NCMEC at{" "}
            <a href="https://report.cybertip.org" className="text-[var(--gold)] underline underline-offset-2" rel="noreferrer" target="_blank">
              report.cybertip.org
            </a>{" "}
            or 1-800-843-5678.
          </li>
          <li>Everything else is reviewed within 48 hours.</li>
        </ul>

        {dueAt ? (
          <div className="mt-8 rounded-3xl border border-[var(--line)] bg-[var(--bg-2)] p-6">
            <p className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">Report received</p>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              Thank you. We&apos;ll act on it by{" "}
              <span className="text-[var(--ink)]">
                {new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              . {email.trim() ? "We'll email you when it's done." : "Add an email next time if you want to hear back."}
            </p>
            <button
              type="button"
              className="mt-5 rounded-full border border-white/20 px-5 py-2.5 text-sm text-[var(--ink)]"
              onClick={() => {
                setDueAt(null);
                setKind(null);
                setTarget("");
                setDetails("");
                setSignature("");
                setGoodFaith(false);
              }}
            >
              Report something else
            </button>
          </div>
        ) : (
          <form
            className="mt-8 space-y-7"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset>
              <legend className="text-xs uppercase tracking-wide text-[var(--muted)]">What are you reporting?</legend>
              <div className="mt-3 space-y-2">
                {KINDS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-3 rounded-2xl border px-4 py-3 ${
                      kind === option.value ? "border-[var(--gold)] bg-[var(--gold)]/10" : "border-[var(--line)] hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={option.value}
                      checked={kind === option.value}
                      onChange={() => setKind(option.value)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--gold)]"
                    />
                    <span>
                      <span className="block text-sm text-[var(--ink)]">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">
                        {option.value === "copyright" ? (
                          <>
                            For a formal notice, see our{" "}
                            <Link href="/dmca" className="text-[var(--gold)] underline underline-offset-2">
                              DMCA page
                            </Link>
                            .
                          </>
                        ) : (
                          option.hint
                        )}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Where is it?</span>
              <input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="Page link, media id or character id"
                maxLength={1000}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--gold)]"
              />
              <span className="mt-1.5 block text-xs text-[var(--muted)]">
                The address in your browser works, for example a character&apos;s chat page or an image link.
              </span>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Details</span>
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={5}
                maxLength={4500}
                placeholder="What's wrong with it, and anything that helps us find it."
                className="mt-2 w-full resize-y rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--gold)]"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Your email {ncii ? "(required)" : "(optional)"}
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="So we can tell you what we did"
                maxLength={254}
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--gold)]"
              />
            </label>

            {ncii ? (
              <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--bg-2)] p-4">
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-[var(--muted)]">Your full name, as a signature</span>
                  <input
                    value={signature}
                    onChange={(event) => setSignature(event.target.value)}
                    maxLength={120}
                    className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--gold)]"
                  />
                </label>
                <label className="flex cursor-pointer gap-3 text-sm leading-6 text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={goodFaith}
                    onChange={(event) => setGoodFaith(event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--gold)]"
                  />
                  I believe in good faith that this intimate depiction was published without the consent of the person
                  shown. I am that person or am authorized to act for them.
                </label>
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-300">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-[var(--gold)] px-7 py-3.5 text-sm font-medium !text-[#12110F] disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send report"}
            </button>
          </form>
        )}

        <p className="mt-10 text-xs leading-5 text-[var(--muted)]">
          If someone is in immediate danger, contact local emergency services. See our{" "}
          <Link href="/content-policy" className="underline underline-offset-2">
            content policy
          </Link>{" "}
          and{" "}
          <Link href="/safety" className="underline underline-offset-2">
            safety page
          </Link>
          .
        </p>
      </section>
    </AppShell>
  );
}
