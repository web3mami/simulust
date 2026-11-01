import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerateStep } from "./generate-step";
import { ProblemNotice, STUDIO_PAUSED, type Problem, type StudioAccess } from "./parts";
import { SEED_CHARACTERS } from "@/lib/characters";

// The studio has no explicit switch: a held account is told it's paused with
// nothing to click, and an unconfirmed one gets one way to confirm its age.

const mira = SEED_CHARACTERS.find((person) => person.id === "mira")!;
const AGE_CHECK: Problem = { text: "Verify your age to unlock this.", code: "age_verification_required" };
const HOLD: Problem = { text: "Paused while we review this account.", code: "explicit_hold" };

const notice = (problem: Problem, held?: boolean) => renderToStaticMarkup(createElement(ProblemNotice, { problem, held }));

function generate(access: StudioAccess, problem: Problem | null) {
  return renderToStaticMarkup(
    createElement(GenerateStep, {
      person: mira,
      scene: { setting: "bedroom", outfit: "lingerie", action: "tease", details: "" },
      take: null,
      busy: null,
      problem,
      balance: 100,
      access,
      videoOn: true,
      onFrame() {},
      onAnimate() {},
      onNewTake() {},
      onEditScene() {},
      onDismissProblem() {},
    }),
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("the studio's problem notice", () => {
  it("says a held account is paused, with nothing to click", () => {
    const html = notice(HOLD);
    expect(html).toContain(STUDIO_PAUSED);
    expect(html).not.toContain("href=");
  });

  it("never offers a held account the age check, even for an age error", () => {
    const html = notice(AGE_CHECK, true);
    expect(html).toContain(STUDIO_PAUSED);
    expect(html).not.toContain("/verify");
  });

  it("sends an unconfirmed account to confirm its age", () => {
    const html = notice(AGE_CHECK);
    expect(html).toContain('href="/verify"');
    expect(html).toContain("Confirm your age");
  });
});

describe("the Generate step", () => {
  it("asks an unconfirmed account to confirm its age once, in the bar", () => {
    for (const problem of [null, AGE_CHECK]) {
      const html = generate("unconfirmed", problem);
      expect(count(html, 'href="/verify"')).toBe(1);
    }
  });

  it("tells a held account it's paused once, with no way around it", () => {
    for (const problem of [null, HOLD, AGE_CHECK]) {
      const html = generate("held", problem);
      // The bar's note is written twice (phones and wide screens), one shown at a time.
      expect(count(html, STUDIO_PAUSED)).toBe(2);
      expect(html).not.toContain("/verify");
      expect(html).not.toContain("Create keyframe");
    }
  });

  it("still shows the server's hold when this page hadn't caught up with it", () => {
    const html = generate("open", HOLD);
    expect(html).toContain(STUDIO_PAUSED);
    expect(html).not.toContain("/verify");
  });
});
