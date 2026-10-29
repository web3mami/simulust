import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardArt } from "./card-art";
import { PortraitCard } from "./portrait-card";
import { themeById, THEMES } from "./catalogue";

const NUDE = "/api/characters/mira/explicit-image?v=abcd1234";
const mira = {
  id: "mira",
  name: "Mira",
  age: 27,
  image: "/characters/mira.jpg",
  color: "#6b3a32",
  role: "Girlfriend",
  line: "Texts you after work.",
};

describe("card art", () => {
  it("shows the nude art wherever the API sent it, with no switch to check", () => {
    expect(cardArt({ ...mira, explicitImage: NUDE })).toEqual({ art: NUDE, explicit: NUDE });
  });

  it("shows the regular portrait when there's no nude art (guests, held or unconfirmed viewers)", () => {
    expect(cardArt(mira)).toEqual({ art: "/characters/mira.jpg", explicit: undefined });
  });

  it("falls back to the regular portrait when the nude art won't load", () => {
    expect(cardArt({ ...mira, explicitImage: NUDE }, NUDE)).toEqual({ art: "/characters/mira.jpg", explicit: undefined });
  });

  it("gives redrawn art its own try", () => {
    const redrawn = "/api/characters/mira/explicit-image?v=ffff0000";
    expect(cardArt({ ...mira, explicitImage: redrawn }, NUDE).art).toBe(redrawn);
  });

  it("renders a card with the nude art for a confirmed adult and the portrait for everyone else", () => {
    const adult = renderToStaticMarkup(createElement(PortraitCard, { person: { ...mira, explicitImage: NUDE } }));
    expect(adult).toContain(NUDE.replace("&", "&amp;"));
    const guest = renderToStaticMarkup(createElement(PortraitCard, { person: mira }));
    expect(guest).not.toContain("explicit-image");
    expect(guest).toContain("mira.jpg");
  });
});

describe("browsing", () => {
  it("has no separate Uncensored row or filter: the whole site is", () => {
    expect(themeById("uncensored")).toBeNull();
    expect(THEMES.map((theme) => theme.id)).not.toContain("uncensored");
  });
});
