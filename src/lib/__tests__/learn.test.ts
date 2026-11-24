import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { DROP_OFF_RULES, dropOffDate, ITEM_TYPES, parseAmount, parseMonth, utilization } from "@/lib/learn/calculators";
import { LESSON_WORD_LIMIT, LESSONS, lessonReadAloud, wordCount } from "@/lib/learn/lessons";

// "Aprende": every lesson short, plain, sourced and within the claim rules.

const NOW = new Date("2026-11-22T12:00:00Z");

describe("lessons", () => {
  it("has 8 to 12 lessons with unique slugs", () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(8);
    expect(LESSONS.length).toBeLessThanOrEqual(12);
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
  });

  for (const lesson of LESSONS) {
    describe(lesson.slug, () => {
      for (const locale of ["es", "en"] as const) {
        it(`${locale}: at most ${LESSON_WORD_LIMIT} words, sentences under 25 words`, () => {
          const text = lessonReadAloud(lesson, locale);
          expect(wordCount(lesson.body[locale].join(" "))).toBeLessThanOrEqual(LESSON_WORD_LIMIT);
          for (const sentence of text.split(/(?<=[.!?])\s+/)) expect(wordCount(sentence), sentence).toBeLessThanOrEqual(25);
        });

        it(`${locale}: every line passes checkClaimGuardrails and checkMarketingCopy`, () => {
          for (const line of [lesson.title[locale], lesson.summary[locale], ...lesson.body[locale]]) {
            expect(checkClaimGuardrails(line), line).toEqual([]);
            expect(checkMarketingCopy(line), line).toEqual([]);
          }
        });

        it(`${locale}: no score promises, no score visuals in words`, () => {
          expect(lesson.body[locale].join(" ")).not.toMatch(/\+\s?\d+\s?(puntos|points)|sube(rá)? tu puntaje|raise your score|garantiz|guarantee/i);
        });
      }

      it("names its sources, each with a link, a checked-on day and a status", () => {
        expect(lesson.sources.length).toBeGreaterThan(0);
        for (const s of lesson.sources) {
          expect(s.url).toMatch(/^https:\/\/(www\.)?(consumerfinance\.gov|consumer\.ftc\.gov|ftc\.gov|identitytheft\.gov|law\.cornell\.edu)\//);
          expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(["verified", "needs_review"]).toContain(s.status);
          expect(s.covers.length).toBeGreaterThan(10);
        }
      });
    });
  }

  it("says plainly that accurate information cannot be removed, and that you can dispute for free yourself", () => {
    const scams = LESSONS.find((l) => l.slug === "estafas")!.body.es.join(" ");
    expect(scams).toContain("Nadie puede quitar legalmente");
    expect(scams).toContain("Tú mismo puedes disputar errores con los burós, gratis");
    expect(scams).toContain("3 días hábiles");
  });

  it("points to IdentityTheft.gov", () => {
    expect(LESSONS.find((l) => l.slug === "robo-de-identidad")!.body.es.join(" ")).toContain("IdentityTheft.gov");
  });

  it("marks Alti's lessons (AI) and the team's own, and never puts a character on the team's", () => {
    for (const l of LESSONS) expect(["assistant", "team"]).toContain(l.character);
    expect(LESSONS.find((l) => l.slug === "estafas")!.character).toBe("team");
    // The team's lessons show a team icon: Alti is the AI assistant, so he never stands for the people.
    const view = readFileSync("src/components/learn/LessonView.tsx", "utf8");
    expect(view).not.toMatch(/CharacterFigure|character="team"|character="engine"/);
    expect(view).toMatch(/your AI assistant, explains/);
  });
});

describe("utilization calculator", () => {
  it("divides balances by limits", () => {
    expect(utilization([{ balance: 300, limit: 1000 }]).percent).toBe(30);
    expect(utilization([{ balance: 300, limit: 1000 }, { balance: 0, limit: 1000 }]).percent).toBe(15);
  });

  it("has no answer without a limit", () => {
    expect(utilization([{ balance: 300, limit: 0 }]).percent).toBeNull();
  });

  it("reads amounts with $ and commas", () => {
    expect(parseAmount("$1,250.50")).toBe(1250.5);
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("how long can it be reported (FCRA § 605)", () => {
  it("a collection: 7 years from 180 days after the first missed payment", () => {
    const r = dropOffDate("collection", parseMonth("2023-07", NOW)!, NOW);
    // July 1, 2023 + 180 days = December 28, 2023; + 7 years.
    expect(r.until).toBe("2030-12-28");
    expect(r.year).toBe(2030);
    expect(r.alreadyPassed).toBe(false);
  });

  it("a late payment: 7 years", () => {
    expect(dropOffDate("late_payment", parseMonth("2020-03", NOW)!, NOW).until).toBe("2027-03-01");
  });

  it("a bankruptcy: 10 years", () => {
    expect(dropOffDate("bankruptcy", parseMonth("2015-05", NOW)!, NOW)).toMatchObject({ year: 2025, alreadyPassed: true });
  });

  it("marks the inquiry rule as a bureau practice, not law", () => {
    expect(DROP_OFF_RULES.hard_inquiry.inLaw).toBe(false);
    for (const t of ITEM_TYPES.filter((t) => t !== "hard_inquiry")) expect(DROP_OFF_RULES[t].inLaw).toBe(true);
  });

  it("refuses future or malformed dates", () => {
    expect(parseMonth("2030-01", NOW)).toBeNull();
    expect(parseMonth("2023-13", NOW)).toBeNull();
    expect(parseMonth("julio", NOW)).toBeNull();
  });
});
