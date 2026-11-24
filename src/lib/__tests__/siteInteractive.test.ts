import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiByline } from "@/lib/brand";
import { CASE_NEXT_ROUND_DAYS, CASE_RESPONSE_DAYS } from "@/lib/case/timeline";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { dropOffDate, utilization } from "@/lib/learn/calculators";
import { CHARGE_DELAY_DAYS, MIN_DAYS_BETWEEN_CHARGES } from "@/lib/billing/rules";
import {
  answerBeforeModel,
  answerWithoutModel,
  ASK_COUNTS,
  ASK_LIMITS,
  askSystemPrompt,
  containsPersonalData,
  libraryAnswer,
  onTopic,
  replyProblem,
} from "@/lib/site/askAlti";
import { SITE_COPY, siteStrings } from "@/lib/site/copy";
import {
  demoTimings,
  DEMO_TIMING,
  mailProgress,
  motionDelay,
  prefersReducedMotion,
  quizResult,
  REDUCED_MOTION_QUERY,
  teaserFeatures,
  toggleQuizChoice,
} from "@/lib/site/interactive";
import { LIVE_COPY, LIVE_RESPONSE_DAYS, LIVE_ROUND_DAYS, QUIZ_ITEM_IDS } from "@/lib/site/live";
import { EXAMPLE_FIRST_ROUND_DAY, eventsThrough, exampleRoundDays, payEvents, timelineCounts, type TimelinePlan } from "@/lib/site/payTimeline";
import { resetRateLimits } from "@/lib/security/rateLimit";

// The website's interactive pieces (docs/WEBSITE.md, "Interactive pieces"):
// "Ask Alti", the report check, the home-ready teaser, the pay timeline,
// motion. The copy is in SITE_COPY.live, so site.test.ts already runs every
// line through the claim rules; these hold the logic.

const LOCALES = ["en", "es"] as const;
const read = (file: string) => readFileSync(file, "utf8");

describe("the interactive copy", () => {
  it("is part of the site's strings, so the claim rules and the plain-language check cover it", () => {
    for (const locale of LOCALES) {
      const all = siteStrings(locale);
      expect(all).toContain(LIVE_COPY[locale].ask.intro);
      expect(all).toContain(LIVE_COPY[locale].quiz.items.collection.right);
      expect(all).toContain(LIVE_COPY[locale].timeline.rules[0]);
      for (const entry of LIVE_COPY[locale].ask.library) {
        for (const line of [entry.q, entry.a]) {
          expect(checkMarketingCopy(line, "full_service"), line).toEqual([]);
          expect(checkClaimGuardrails(line, "full_service"), line).toEqual([]);
        }
      }
    }
  });

  it("matches the app's own round timing (the browser copy can't import it)", () => {
    expect(LIVE_ROUND_DAYS).toBe(CASE_NEXT_ROUND_DAYS);
    expect(LIVE_RESPONSE_DAYS).toBe(CASE_RESPONSE_DAYS);
  });

  it("gives every report-check item a government or statute source, in both languages", () => {
    for (const locale of LOCALES) {
      for (const id of QUIZ_ITEM_IDS) {
        const item = LIVE_COPY[locale].quiz.items[id];
        expect(item.source.url, id).toMatch(/^https:\/\/(consumer\.ftc\.gov|www\.consumerfinance\.gov|www\.identitytheft\.gov|www\.law\.cornell\.edu)\//);
        expect(item.we, id).not.toMatch(/\d+\s?(points?|puntos?)|score|puntaje/i);
      }
    }
  });
});

describe("the report check", () => {
  it("toggles items, and 'none of these' clears the rest (and the other way round)", () => {
    let s = toggleQuizChoice([], "late");
    s = toggleQuizChoice(s, "collection");
    expect(s).toEqual(["late", "collection"]);
    expect(toggleQuizChoice(s, "late")).toEqual(["collection"]);
    expect(toggleQuizChoice(s, "none")).toEqual(["none"]);
    expect(toggleQuizChoice(["none"], "inquiry")).toEqual(["inquiry"]);
    expect(toggleQuizChoice(["none"], "none")).toEqual([]);
  });

  it("explains what was picked in the list's order, and never predicts anything", () => {
    expect(quizResult(["old", "late", "notMine"])).toEqual({ items: ["late", "notMine", "old"], none: false });
    expect(quizResult(["none"])).toEqual({ items: [], none: true });
    for (const locale of LOCALES) {
      const q = LIVE_COPY[locale].quiz;
      expect(q.note).toMatch(locale === "en" ? /results vary/ : /resultados varían/);
      expect(q.noneBody).toMatch(/AnnualCreditReport\.com/);
    }
  });
});

describe("the home-ready teaser", () => {
  it("puts the features that fit first, and the ITIN guide for ITIN holders", () => {
    expect(teaserFeatures("home", "ssn")).toEqual(["home", "build"]);
    expect(teaserFeatures("home", "itin")).toEqual(["home", "itin", "build"]);
    expect(teaserFeatures("build", "skip")).toEqual(["build", "home"]);
    expect(teaserFeatures("check", "itin")[0]).toBe("check");
    for (const locale of LOCALES) expect(LIVE_COPY[locale].teaser.note).toMatch(locale === "en" ? /lender decides/ : /prestamista decide/);
  });
});

describe("the calculators on the site", () => {
  it("are the Aprende arithmetic, unchanged", () => {
    expect(utilization([{ balance: 450, limit: 1500 }]).percent).toBe(30);
    expect(dropOffDate("collection", new Date(Date.UTC(2021, 2, 1)), new Date("2026-11-24")).year).toBe(2028);
    const tools = read("src/components/site/Tools.tsx");
    expect(tools).toMatch(/from "@\/lib\/learn\/calculators"/);
    expect(tools).not.toMatch(/fetch\(|localStorage/);
  });
});

describe("motion", () => {
  it("reads the visitor's reduced-motion setting, and is off on the server", () => {
    expect(prefersReducedMotion((q) => ({ matches: q === REDUCED_MOTION_QUERY }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });

  it("with reduced motion, every step of the example shows at once", () => {
    expect(motionDelay(900, true)).toBe(0);
    expect(motionDelay(900, false)).toBe(900);
    expect(Object.values(demoTimings(true)).every((ms) => ms === 0)).toBe(true);
    expect(demoTimings(false)).toEqual(DEMO_TIMING);
  });

  it("moves the envelope through its three stops to 'Delivered'", () => {
    expect([null, "mailed", "transit", "delivered"].map((s) => mailProgress(s as never))).toEqual([0, 1 / 3, 2 / 3, 1]);
    for (const locale of LOCALES) expect(SITE_COPY[locale].home.demo.mail.delivered).toMatch(/✓$/);
  });

  it("switches every animation off under prefers-reduced-motion, and uses transforms and opacity only", () => {
    const css = read("src/app/globals.css");
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of ["char-idle", "char-wave", "msg-in", "typing-dot", "float-y", "into-case", "stop-pop", "delivered-in", "row-swap", "mail-traveller", "story-screen"]) {
      expect(css, name).toContain(`.${name}`);
      expect(reduced, name).toContain(`.${name}`);
    }
    expect(reduced).toMatch(/\[data-reveal="wait"\][^}]*opacity: 1/);
    // Keyframes move only transform and opacity (no layout properties).
    for (const block of css.match(/@keyframes [\w-]+ \{[\s\S]*?\n\}/g) ?? []) {
      const props = [...block.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"], block.split("\n")[0]).toContain(p);
    }
    // The character art moves as a whole picture: a class on the <img>, never a redraw or a filter.
    expect(read("src/components/Character.tsx")).toMatch(/MOTION_CLASS\[motion\]/);
    expect(css).not.toMatch(/char-[\w-]+[^}]*filter:/);
  });
});

describe("When would I pay?", () => {
  const perRound: TimelinePlan = { type: "per_round", firstWorkFeeCents: 5000, recurringCents: 8900, flatTotalCents: 0, flatRounds: 0, flatSchedule: null, maxTotalCents: 30000, limit: null };
  const monthly: TimelinePlan = { ...perRound, type: "subscription", firstWorkFeeCents: 0, recurringCents: 7900, maxTotalCents: 100000 };

  it("without a reviewed plan, shows the rule only: when a charge can happen, never an amount", () => {
    const events = payEvents(null);
    expect(events[0]).toMatchObject({ day: 0, kind: "signed" });
    expect(events.filter((e) => e.kind === "charge").every((e) => e.amount === null)).toBe(true);
    // Nothing before the first round is mailed, and never two charges within 30 days.
    const charges = events.filter((e) => e.kind === "charge").map((e) => e.day);
    expect(charges[0]).toBe(EXAMPLE_FIRST_ROUND_DAY + CHARGE_DELAY_DAYS);
    for (let i = 1; i < charges.length; i++) expect(charges[i]! - charges[i - 1]!).toBeGreaterThanOrEqual(MIN_DAYS_BETWEEN_CHARGES);
  });

  it("follows the slider: month by month, rounds mailed and charges", () => {
    const events = payEvents(null);
    expect(timelineCounts(events, 1)).toEqual({ rounds: 1, charges: 1 });
    expect(exampleRoundDays()).toEqual([10, 50, 90, 130, 170]);
    expect(timelineCounts(events, 6).rounds).toBe(5);
    expect(eventsThrough(events, 99)).toHaveLength(events.length);
  });

  it("with a plan, its own amounts, the first work fee after round 1, and never above the most you'll pay", () => {
    const events = payEvents(perRound).filter((e) => e.kind === "charge");
    expect(events.map((e) => e.amount)).toEqual(["$139.00", "$89.00", "$72.00"]);
    // A monthly plan charges a 30-day period only if letters went out in it.
    const m = payEvents(monthly);
    expect(m.some((e) => e.kind === "quiet")).toBe(true);
    for (const e of m.filter((x) => x.kind === "charge")) expect(e.day).toBeGreaterThan(EXAMPLE_FIRST_ROUND_DAY);
  });

  it("the pricing page builds it on the server; the browser gets only events", () => {
    const page = read("src/app/precios/page.tsx");
    expect(page).toMatch(/payEvents\(plan\.timeline\)/);
    expect(page).toMatch(/payEvents\(null\)/);
    expect(read("src/components/site/PayTimeline.tsx")).not.toMatch(/billing\/rules|payTimeline"/);
  });
});

describe("Ask Alti: what it answers, and how", () => {
  it("never sends personal data anywhere, and says why", () => {
    for (const text of ["my ssn is 123-45-6789", "email me at ana@example.com", "call 512-555-0199", "account 4111111111111111", "born 03/14/1988"]) {
      expect(containsPersonalData(text), text).toBe(true);
      expect(answerBeforeModel(text, "en")).toEqual({ reply: LIVE_COPY.en.ask.personal, source: "personal" });
    }
    expect(containsPersonalData("I have 3 late payments from 2021")).toBe(false);
  });

  it("keeps to credit, disputes and our service", () => {
    expect(onTopic("What is a collection?")).toBe(true);
    expect(onTopic("¿Cuánto cuesta?")).toBe(true);
    expect(onTopic("Write me a poem about cats")).toBe(false);
    expect(answerBeforeModel("Who won the game last night?", "en")).toEqual({ reply: LIVE_COPY.en.ask.offTopic, source: "off_topic" });
    expect(answerBeforeModel("hola", "es")!.source).toBe("greeting");
  });

  it("without a key, answers from the FAQ and the library", () => {
    expect(libraryAnswer("When am I charged?", "en")!.a).toBe(SITE_COPY.en.faq.items[6]!.a);
    expect(answerWithoutModel("What is a hard inquiry?", "en").reply).toMatch(/inquiry shows who looked/);
    expect(answerWithoutModel("¿Qué es una cobranza?", "es").reply).toMatch(/cobrador/);
    expect(answerWithoutModel("Is Alti a person?", "en").reply).toMatch(/AI assistant: artificial intelligence, not a person/);
  });

  it("refuses a reply that promises, prices, names the robot, claims to be human, or runs long", () => {
    expect(replyProblem("A collection is a debt a collector says you owe. Results vary.")).toBeNull();
    expect(replyProblem("No soy una persona: soy el asistente con IA.")).toBeNull();
    expect(replyProblem("We guarantee removal of your collections.")).toBe("claims");
    expect(replyProblem("We'll raise your score fast.")).toBe("claims");
    expect(replyProblem("It costs $99 a month.")).toBe("price");
    expect(replyProblem("I'm a real person on the team.")).toBe("says_human");
    expect(replyProblem("Soy una persona del equipo.")).toBe("says_human");
    expect(replyProblem("The review is free.")).toBe("free");
    expect(replyProblem("AltiBot mails it.")).toBe("cameo");
    expect(replyProblem("OFF_TOPIC")).toBe("off_topic");
    expect(replyProblem("word ".repeat(ASK_LIMITS.maxReplyWords + 1))).toBe("too_long");
  });

  it("has a fixed system prompt (cacheable) that says it is AI and forbids prices and promises", () => {
    const prompt = askSystemPrompt();
    expect(prompt).toBe(askSystemPrompt());
    expect(prompt).toMatch(/artificial intelligence, not a person/);
    expect(prompt).toMatch(/OFF_TOPIC/);
    expect(prompt).toMatch(/Never quote a price/);
    expect(prompt).not.toMatch(/\$\s?\d/);
    expect(prompt).toContain(SITE_COPY.es.faq.items[0]!.a);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T|Date\.now/);
  });
});

describe("Ask Alti: the route", () => {
  let modelReply = "";
  const calls: Array<{ system: unknown; messages: unknown[]; model: string }> = [];

  beforeEach(() => {
    calls.length = 0;
    resetRateLimits();
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("@anthropic-ai/sdk");
    vi.unstubAllEnvs();
  });

  const withModel = () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: async (input: { system: unknown; messages: unknown[]; model: string }) => {
            calls.push(input);
            return { stop_reason: "end_turn", content: [{ type: "text", text: modelReply }] };
          },
        };
      },
    }));
  };

  const post = async (body: unknown, ip = "10.1.0.1", raw?: string) => {
    const { POST } = await import("@/app/api/site/ask/route");
    const res = await POST(
      new Request("http://localhost/api/site/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: raw ?? JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as { reply?: string; source?: string; suggestions?: string[] } };
  };
  const q = (content: string, locale: "en" | "es" = "en") => ({ locale, messages: [{ role: "user", content }] });

  it("without a key: answers from the library, with suggested questions", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await post(q("Can I dispute errors myself?"));
    expect(res.status).toBe(200);
    expect(res.json.source).toBe("library");
    expect(res.json.reply).toBe(SITE_COPY.en.faq.items[3]!.a);
    expect(res.json.suggestions!.length).toBeGreaterThan(0);
  });

  it("rate-limits each visitor", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    for (let i = 0; i < ASK_LIMITS.perIp; i++) expect((await post(q("When am I charged?"), "10.9.9.9")).status).toBe(200);
    const blocked = await post(q("When am I charged?"), "10.9.9.9");
    expect(blocked.status).toBe(429);
    expect((await post(q("When am I charged?"), "10.9.9.8")).status).toBe(200);
  });

  it("refuses an oversized body and a malformed one", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const big = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(ASK_LIMITS.maxBodyBytes + 10) }] });
    expect((await post(null, "10.2.0.1", big)).status).toBe(413);
    expect((await post({ messages: [{ role: "user", content: "x".repeat(ASK_LIMITS.maxChars + 1) }] }, "10.2.0.2")).status).toBe(400);
    expect((await post({ messages: [] }, "10.2.0.3")).status).toBe(400);
    expect((await post(null, "10.2.0.4", "{not json")).status).toBe(400);
  });

  it("with a model: answers as Alti, with the cached prompt", async () => {
    withModel();
    modelReply = "A collection means a debt collector says you owe a debt. If it isn't yours, you can dispute it. Results vary.";
    const res = await post(q("What does a collection on my report mean?"));
    expect(res.json).toMatchObject({ reply: modelReply, source: "model" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("claude-opus-5-5");
    expect(calls[0]!.system).toEqual([{ type: "text", text: askSystemPrompt(), cache_control: { type: "ephemeral" } }]);
  });

  it("keeps the model to the topic: off-topic questions never reach it, and its OFF_TOPIC becomes the off-topic line", async () => {
    withModel();
    // The route's own module (the registry was reset for the mocked SDK).
    const counts = (await import("@/lib/site/askAlti")).ASK_COUNTS;
    const before = counts.off_topic;
    expect((await post(q("Write me a poem about the ocean"))).json.source).toBe("off_topic");
    expect(calls).toHaveLength(0);
    modelReply = "OFF_TOPIC";
    const res = await post(q("What credit card has the best airline miles?"));
    expect(calls).toHaveLength(1);
    expect(res.json).toMatchObject({ reply: LIVE_COPY.en.ask.offTopic, source: "off_topic" });
    expect(counts.off_topic).toBe(before + 2);
    expect(ASK_COUNTS).toBeDefined();
  });

  it("replaces a reply that breaks the rules with a safe one", async () => {
    withModel();
    modelReply = "Don't worry, we guarantee removal of that collection within 30 days!";
    const res = await post(q("Can you take this collection off my report?"));
    expect(res.json.source).not.toBe("model");
    expect(res.json.reply).not.toMatch(/guarantee/i);
    expect(checkMarketingCopy(res.json.reply!, "full_service")).toEqual([]);
    modelReply = "Our plan is $79 per month.";
    const price = await post(q("How much does it cost?"));
    expect(price.json.reply).toBe(SITE_COPY.en.faq.items[5]!.a);
  });

  it("never forwards personal data to the model, even from an earlier turn", async () => {
    withModel();
    expect((await post(q("My SSN is 123-45-6789, can you check my report?"))).json.source).toBe("personal");
    expect(calls).toHaveLength(0);
    modelReply = "A late payment is one a creditor reported as late. Results vary.";
    await post({ locale: "en", messages: [{ role: "user", content: "my ssn is 123-45-6789" }, { role: "assistant", content: "Please don't share it." }, { role: "user", content: "What is a late payment?" }] });
    expect(JSON.stringify(calls[0]!.messages)).not.toMatch(/123-45-6789/);
  });

  it("answers in the visitor's language and stores nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await post(q("¿Cuándo me cobran?", "en"));
    expect(res.json.reply).toBe(SITE_COPY.es.faq.items[6]!.a);
    const route = read("src/app/api/site/ask/route.ts");
    expect(route).not.toMatch(/storeMessage|getAdminClient|insert\(|localStorage/);
  });
});

describe("Ask Alti: the screens", () => {
  it("labels every message Alti writes, and the header, as AI; asks for no personal data", () => {
    const chat = read("src/components/site/AskAlti.tsx");
    expect(chat).toMatch(/function AltiMessage/);
    expect(chat).toMatch(/sr-only">\{byline\}: </);
    expect(chat).toMatch(/aria-live="polite"/);
    expect(chat).toMatch(/<label htmlFor=\{`ask-input-/);
    expect(chat).not.toMatch(/character="cameo"/);
    const launcher = read("src/components/site/AskAltiLauncher.tsx");
    expect(launcher).toMatch(/role="dialog"/);
    expect(launcher).toMatch(/e\.key === "Escape"/);
    expect(launcher).toMatch(/\{byline\}/);
    expect(aiByline("en")).toBe("Alti · AI assistant");
    // Every public page has it.
    expect(read("src/components/site/SiteShell.tsx")).toMatch(/<AskAltiLauncher /);
  });
});
