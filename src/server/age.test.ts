import { describe, expect, it } from "vitest";
import { birthDateVerdict, isAdultBirthDate } from "@/server/age";

// 23:30 UTC on 14 June 2026: already the 15th east of UTC.
const NOW = new Date(Date.UTC(2026, 5, 14, 23, 30));

describe("birthDateVerdict", () => {
  it("counts the 18th birthday itself, on the server's UTC date by default", () => {
    expect(birthDateVerdict("2008-06-14", undefined, NOW)).toBe("adult");
    expect(birthDateVerdict("2008-06-15", undefined, NOW)).toBe("minor");
    expect(birthDateVerdict("1990-01-01", undefined, NOW)).toBe("adult");
    expect(birthDateVerdict("2015-01-01", undefined, NOW)).toBe("minor");
  });

  it("uses the browser's local date when some time zone is on it right now", () => {
    // Someone in Tokyo on their 18th birthday, while it's still the 14th in UTC.
    expect(birthDateVerdict("2008-06-15", "2026-06-15", NOW)).toBe("adult");
    expect(isAdultBirthDate("2008-06-15", "2026-06-15", NOW)).toBe(true);
    // 05:00 UTC on the 15th: still the 14th in California, so not 18 there
    // until their own midnight.
    const early = new Date(Date.UTC(2026, 5, 15, 5));
    expect(birthDateVerdict("2008-06-15", undefined, early)).toBe("adult");
    expect(birthDateVerdict("2008-06-15", "2026-06-14", early)).toBe("minor");
  });

  it("ignores a local date no time zone is on yet, or any more, or not a date", () => {
    for (const today of ["2026-06-16", "2027-06-15", "2026-02-30", "15/06/2026", ""]) {
      expect(birthDateVerdict("2008-06-15", today, NOW), today).toBe("minor");
    }
    // 00:30 UTC on the 15th: the furthest east (UTC+14) is at 14:30 on the
    // 15th, so nobody is on the 16th yet. A birthday on the 16th waits.
    const justAfterMidnight = new Date(Date.UTC(2026, 5, 15, 0, 30));
    expect(birthDateVerdict("2008-06-16", "2026-06-16", justAfterMidnight)).toBe("minor");
    expect(birthDateVerdict("2008-06-15", "2026-06-15", justAfterMidnight)).toBe("adult");
    // 23:30 UTC on the 14th: the furthest west (UTC-12) is at 11:30 on the
    // 14th, so a browser saying the 13th gets the server's date instead.
    expect(birthDateVerdict("2008-06-14", "2026-06-13", NOW)).toBe("adult");
    expect(birthDateVerdict("2008-06-14", "2026-06-14", NOW)).toBe("adult");
  });

  it("turns a 29 February birthday 18 on 1 March", () => {
    const march = new Date(Date.UTC(2026, 2, 1, 12));
    expect(birthDateVerdict("2008-02-29", undefined, new Date(Date.UTC(2026, 1, 28, 12)))).toBe("minor");
    expect(birthDateVerdict("2008-02-29", undefined, march)).toBe("adult");
  });

  it("calls a date that can't be real a typo, not an age", () => {
    for (const birthDate of ["2001-02-30", "1899-12-31", "2026-06-15", "30/03/1990", "1990-3-30", "", "1990-03-30T00:00:00Z"]) {
      expect(birthDateVerdict(birthDate, undefined, NOW), birthDate).toBe("invalid");
      expect(isAdultBirthDate(birthDate, undefined, NOW)).toBe(false);
    }
    // Today itself is a real (if very young) date of birth.
    expect(birthDateVerdict("2026-06-14", undefined, NOW)).toBe("minor");
  });
});
