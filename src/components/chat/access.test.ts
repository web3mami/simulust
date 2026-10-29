import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CharacterDTO, MediaDTO } from "@/lib/api-types";
import { Composer, type PhotoAction } from "./composer";
import { EXPLICIT_PHOTO_IDEAS, EXPLICIT_PHOTO_IDEAS_MAN } from "./format";
import { MediaView, ProblemLine } from "./message-parts";
import { ProfilePanel, type PrivateAccess } from "./profile-panel";

// The chat has no explicit switch: a confirmed adult gets the 18+ photos by
// default, a held account sees them paused with nothing to click, and an older
// unconfirmed account gets one link to confirm its age.

const NUDE = "/api/characters/mira/explicit-image?v=abcd1234";
const mira: CharacterDTO = {
  id: "mira",
  name: "Mira",
  age: 27,
  gender: "Woman",
  ethnicity: "Latina",
  body: "Curvy",
  role: "Girlfriend",
  heat: "Slow burn",
  line: "Texts you after work.",
  color: "#6b3a32",
  lane: "girls",
  tags: [],
  image: "/characters/mira.jpg",
};

const SWITCH = /\/settings|Settings|explicit mode|turn on explicit/i;

function composer(photo: PhotoAction, gender = "Woman") {
  return renderToStaticMarkup(
    createElement(Composer, {
      name: "Mira",
      gender,
      draft: "",
      onDraft() {},
      onSend() {},
      sending: false,
      ready: true,
      maxLength: 4000,
      textareaRef: createRef<HTMLTextAreaElement>(),
      photo,
      starters: [],
      onStarter() {},
    }),
  );
}

function panel(access: PrivateAccess, person: CharacterDTO = mira) {
  return renderToStaticMarkup(
    createElement(ProfilePanel, {
      person,
      onClose() {},
      onPhoto() {},
      photoBusy: false,
      canPhoto: access === "explicit",
      photoReady: true,
      privateAccess: access,
      onOpenPrivate() {},
      gallery: { photos: [] },
      onOpenPhoto() {},
    }),
  );
}

const locked: MediaDTO = { id: "m1", kind: "image", status: "ready", url: null, locked: true };

describe("chat photo actions", () => {
  it("give a confirmed adult every 18+ quick action, with nothing to turn on", () => {
    const html = composer({ kind: "ask", onPick() {}, busy: false, disabled: false, cost: 8 });
    for (const idea of EXPLICIT_PHOTO_IDEAS) expect(html).toContain(idea.label);
    expect(html).toContain("Send me a photo");
    expect(html).not.toMatch(SWITCH);
  });

  it("are worded for who the character is", () => {
    const ask: PhotoAction = { kind: "ask", onPick() {}, busy: false, disabled: false, cost: 8 };
    const his = composer(ask, "Man");
    for (const idea of EXPLICIT_PHOTO_IDEAS_MAN) expect(his).toContain(idea.label);
    expect(his).not.toContain(">Topless");
    expect(his).not.toContain(">Lingerie");
    const hers = composer(ask, "Woman");
    expect(hers).toContain("Topless");
    expect(hers).not.toContain("Shirtless");
  });

  it("say photos are paused for a held account, with no link", () => {
    const html = composer({ kind: "paused" });
    expect(html).toContain("Photos paused");
    expect(html).not.toContain("href=");
    expect(html).not.toContain(EXPLICIT_PHOTO_IDEAS[0].label);
  });

  it("send an unconfirmed account to confirm its age", () => {
    const html = composer({ kind: "confirm" });
    expect(html).toContain('href="/verify"');
    expect(html).toContain("Confirm your age");
    expect(html).not.toMatch(SWITCH);
  });
});

describe("locked 18+ media in the chat", () => {
  it("is paused for a held account, with nothing to click", () => {
    const html = renderToStaticMarkup(createElement(MediaView, { media: locked, name: "Mira", lock: "paused" }));
    expect(html).toContain("Paused while we review this account");
    expect(html).not.toContain("href=");
  });

  it("asks an unconfirmed account to confirm its age", () => {
    const html = renderToStaticMarkup(createElement(MediaView, { media: locked, name: "Mira", lock: "confirm" }));
    expect(html).toContain('href="/verify"');
    expect(html).not.toMatch(SWITCH);
  });
});

describe("the age problem line", () => {
  const problem = { text: "Verify your age to unlock this.", code: "age_verification_required" };

  it("links an unconfirmed account to /verify", () => {
    const html = renderToStaticMarkup(createElement(ProblemLine, { problem, onDismiss() {} }));
    expect(html).toContain('href="/verify"');
  });

  it("offers a held account no way around the hold", () => {
    const html = renderToStaticMarkup(createElement(ProblemLine, { problem, onDismiss() {}, held: true }));
    expect(html).toContain("paused while we review this account");
    expect(html).not.toContain("href=");
  });

  it("shows the server's explicit_hold as paused, with nothing to click, before /api/me catches up", () => {
    const hold = { text: "Paused while we review this account.", code: "explicit_hold" };
    const html = renderToStaticMarkup(createElement(ProblemLine, { problem: hold, onDismiss() {} }));
    expect(html).toContain("paused while we review this account");
    expect(html).not.toContain("href=");
  });
});

describe("the profile panel's private photos", () => {
  it("show a confirmed adult the nude art, the Video Studio and the photo ask", () => {
    const html = panel("explicit", { ...mira, explicitImage: NUDE });
    expect(html).toContain(NUDE.replace("&", "&amp;"));
    expect(html).toContain("Make a video");
    expect(html).toContain("Ask for another");
    expect(html).not.toMatch(SWITCH);
  });

  it("never show a held account the nude art or a way to unlock it", () => {
    const html = panel("held");
    expect(html).toContain("paused while we review this account");
    expect(html).not.toContain("explicit-image");
    expect(html).not.toContain("/verify");
    expect(html).not.toContain("Make a video");
    expect(html).not.toMatch(SWITCH);
  });

  it("send an unconfirmed account to confirm its age", () => {
    const html = panel("verify");
    expect(html).toContain('href="/verify"');
    expect(html).toContain("Confirm your age");
    expect(html).not.toContain("explicit-image");
    expect(html).not.toMatch(SWITCH);
  });
});
