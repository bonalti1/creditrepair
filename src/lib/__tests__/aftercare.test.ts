import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgreementRecord } from "../agreement/gate";
import { introCopy, introHash, introRoute, introText, type IntroPartner } from "../aftercare/connect";
import { GRADUATION_COPY, graduationCopy, graduationStatus, graduationSummary } from "../aftercare/graduation";
import { HOME_MILESTONES, homeReadyCopy, homeReadyTrack, LENDER_TOPICS, PARTNER_HOME_MILESTONES, partnerHomeFromProgress, partnerHomeFromRows } from "../aftercare/homeReady";
import { containsTaxpayerNumber, enclosureLabelFor, ID_TYPE_QUESTION, itinCopy, itinMonitoringNote, itinSections, ITIN_SAVED_ANSWERS, MONITORING_ITIN_POLICY } from "../aftercare/itin";
import { AFFILIATE_LINE, DEMO_OFFERS, offerInputSchema, offersCopy, rankOffers, type Offer } from "../aftercare/offers";
import { AFTERCARE_MARK_KEYS, marksFromRows, personalPlan, planCopy, PLAN_ITEMS, PLAN_KEYS, reportFacts, TRADELINE_OPTIONS } from "../aftercare/plan";
import { AFTERCARE_SOURCES } from "../aftercare/sources";
import { chargeEligibility } from "../billing/rules";
import { planTermsHash, snapshotPlan, type PlanTerms, type PlanVersion } from "../billing/plans";
import type { BillableRound, BillingContext, PaymentMethodSummary } from "../billing/types";
import { EMPTY_CASE_FACTS, type CaseFacts } from "../case/timeline";
import { coachSystemPrompt } from "../coach/systemPrompt";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import type { ReportItem } from "../domain/types";
import { ENCLOSURE_LABELS } from "../letters/enclosures";
import { TEMPLATES } from "../letters/templates";
import { consentHash, consentText, homeReadyAllowed, SHARING_CONSENT_VERSION } from "../partners/sharing";
import { bestMatch, DEMO_SAVED_ANSWERS, libraryReplyFor } from "../staff/answers";

// After-care (docs/AFTERCARE.md): the build-your-credit plan, partner offers,
// the home-ready path, ITIN clients and graduation. Every client-facing line
// passes the claim rules in English and Spanish; offers rank by cost to the
// client; ITIN numbers are never printed; and graduating stops billing.

const NOW = new Date("2026-11-24T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const OUTCOME_WORDS = /\b(deleted|removed|fixed|guarantee[ds]?|approved|eliminad[oa]s?|borrad[oa]s?|garantiza\w*|aprobad[oa]s?)\b/i;
const SCORE_PROMISES = /\+\s?\d+\s?(puntos|points)|raise your score|boost your score|sube(r[aá])? tu puntaje|aumenta tu puntaje|will (go up|increase)|va a subir/i;

function clientLines(locale: "es" | "en"): string[] {
  return [
    ...planCopy(locale),
    ...homeReadyCopy(locale),
    ...itinCopy(locale),
    ...offersCopy(locale),
    ...graduationCopy(locale),
    ...introCopy(locale),
    ...Object.values(ID_TYPE_QUESTION[locale]),
    itinMonitoringNote(locale).title,
    itinMonitoringNote(locale).body,
    // The home-ready line added to the partner consent (the rest of that text is 0023's, tested there).
    consentText("progress", { name: "Jorge Treviño", company: "Hipotecas del Valle" }, locale, { homeReady: true }).will.at(-1)!,
    ...ITIN_SAVED_ANSWERS.filter((a) => a.language === locale).flatMap((a) => [a.question, a.answer]),
  ];
}

describe("every client-facing line passes the claim rules", () => {
  for (const locale of ["en", "es"] as const) {
    it(`${locale}: checkClaimGuardrails and checkMarketingCopy, in both service modes`, () => {
      const lines = clientLines(locale);
      expect(lines.length).toBeGreaterThan(120);
      for (const line of lines) {
        for (const mode of ["full_service", "diy"] as const) {
          expect(checkClaimGuardrails(line, mode), line).toEqual([]);
          expect(checkMarketingCopy(line, mode), line).toEqual([]);
        }
      }
    });

    it(`${locale}: no outcome words, no score promises, plain sentences`, () => {
      for (const line of clientLines(locale)) {
        expect(line, line).not.toMatch(OUTCOME_WORDS);
        expect(line, line).not.toMatch(SCORE_PROMISES);
        for (const sentence of line.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(32);
      }
    });
  }

  it("the two languages carry the same items", () => {
    for (const item of PLAN_ITEMS) {
      expect(item.steps.en.length, item.key).toBe(item.steps.es.length);
    }
    for (const o of TRADELINE_OPTIONS) {
      expect(o.pros.en.length).toBe(o.pros.es.length);
      expect(o.cons.en.length).toBe(o.cons.es.length);
    }
    for (const t of LENDER_TOPICS) expect(t.body.en.length, t.key).toBe(t.body.es.length);
  });

  it("no product is recommended, and the tradeline rental scam is warned against", () => {
    const all = [...clientLines("en"), ...clientLines("es")].join(" ");
    expect(all).not.toMatch(/\bwe recommend\b|\brecomendamos\b|best (card|offer|option)|la mejor (tarjeta|oferta|opci[oó]n)/i);
    expect(planCopy("en").join(" ")).toContain("Never pay a company to add you to a stranger's card.");
  });

  it("the lender information is general, says requirements vary by lender, and never compares the client's own score", () => {
    const en = homeReadyCopy("en").join(" ");
    expect(en).toContain("Requirements vary by lender.");
    expect(homeReadyCopy("es").join(" ")).toContain("Los requisitos varían según el prestamista.");
    expect(en).not.toMatch(/your score (is|of)|you qualify|you will qualify/i);
  });
});

describe("sources", () => {
  it("every source names its publisher, an https link, the day it was checked and a status", () => {
    for (const [key, s] of Object.entries(AFTERCARE_SOURCES)) {
      expect(s.url, key).toMatch(/^https:\/\//);
      expect(s.checkedOn, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["verified", "needs_review"], key).toContain(s.status);
      expect(s.covers.length, key).toBeGreaterThan(30);
    }
  });

  it("every item and topic points at sources that exist; the unconfirmed ones are marked for review", () => {
    const keys = new Set(Object.keys(AFTERCARE_SOURCES));
    for (const item of PLAN_ITEMS) for (const k of item.sources) expect(keys.has(k), k).toBe(true);
    for (const t of LENDER_TOPICS) {
      expect(t.sources.length, t.key).toBeGreaterThan(0);
      for (const k of t.sources) expect(keys.has(k), k).toBe(true);
    }
    // Lender minimums and ITIN loans were found only through secondary sources.
    expect(AFTERCARE_SOURCES.hudFha.status).toBe("needs_review");
    expect(AFTERCARE_SOURCES.fannieMaeScores.status).toBe("needs_review");
    expect(AFTERCARE_SOURCES.itinLoans.status).toBe("needs_review");
    expect(AFTERCARE_SOURCES.irsItin.status).toBe("needs_review");
  });
});

// ── The plan, from the client's own report ──────────────────────────────

const card = (bureau: ReportItem["bureau"], name: string, balance: number, limit: number, extra: Record<string, unknown> = {}): ReportItem => ({
  fingerprint: `${bureau}-${name}`,
  bureau,
  category: "tradeline",
  name,
  data: { accountType: "Credit Card", accountNumberMasked: `****${name.length}`, status: "Open", balance, creditLimit: limit, ...extra },
  negative: false,
});

const REPORT: ReportItem[] = [
  card("equifax", "Banco Uno", 600, 1000, { openedAt: "2015-03-01", paymentHistory: [{ month: "2026-05", status: "30" }, { month: "2026-06", status: "OK" }] }),
  // The same card at another bureau counts once.
  card("experian", "Banco Uno", 600, 1000, { openedAt: "2015-03-01" }),
  card("equifax", "Tienda Dos", 300, 1000, { openedAt: "2021-08-01" }),
  { fingerprint: "c1", bureau: "equifax", category: "tradeline", name: "Midland Credit", data: { accountType: "Collection", status: "Collection", balance: 900 }, negative: true },
  { fingerprint: "i1", bureau: "equifax", category: "inquiry", name: "Auto Lender", data: { inquirer: "Auto Lender", date: "2026-09-10", type: "hard" }, negative: true },
  { fingerprint: "i2", bureau: "equifax", category: "inquiry", name: "Old Lender", data: { inquirer: "Old Lender", date: "2024-01-10", type: "hard" }, negative: true },
];

describe("the build-your-credit plan", () => {
  it("reads facts from the report: open cards once each, utilization, oldest open account, recent lates and inquiries", () => {
    const f = reportFacts(REPORT, NOW);
    expect(f).toMatchObject({ openCards: 2, cardBalance: 900, cardLimit: 2000, utilizationPercent: 45, openAccounts: 2, accountsWithLates: 1, recentHardInquiries: 1 });
    expect(f.oldestOpen?.name).toBe("Banco Uno");
  });

  it("puts what the report points to first, and words the notes as facts", () => {
    const { items } = personalPlan({ items: REPORT, goal: "mortgage", idType: "itin", now: NOW }, "en");
    expect(items.map((i) => i.item.key).slice(0, 3)).toEqual(["on_time", "utilization", "add_positive"]);
    expect(items.find((i) => i.item.key === "utilization")!.note).toBe("On your latest report, your open cards use $900 of $2,000: about 45%.");
    expect(items.find((i) => i.item.key === "check_reports")!.note).toMatch(/ITIN/);
    expect(items.find((i) => i.item.key === "inquiries")!.note).toMatch(/buying a home/);
    for (const locale of ["en", "es"] as const) {
      for (const { note } of personalPlan({ items: REPORT, goal: "mortgage", idType: "itin", now: NOW }, locale).items) {
        if (!note) continue;
        expect(checkClaimGuardrails(note), note).toEqual([]);
        expect(checkMarketingCopy(note), note).toEqual([]);
      }
    }
  });

  it("works with an empty report (a new client, from day one)", () => {
    const { items, facts } = personalPlan({ items: [], goal: null, idType: null, now: NOW }, "es");
    expect(items).toHaveLength(PLAN_ITEMS.length);
    expect(facts.utilizationPercent).toBeNull();
    expect(items[0]!.item.key).toBe("add_positive");
  });

  it("the newest mark wins, and only known keys count", () => {
    const marks = marksFromRows([
      { seq: 1, item_key: "on_time", done: true, created_at: ago(5) },
      { seq: 2, item_key: "on_time", done: false, created_at: ago(2) },
      { seq: 3, item_key: "home_savings", done: true, created_at: ago(1) },
      { seq: 4, item_key: "score", done: true, created_at: ago(1) },
    ]);
    expect(marks.on_time?.done).toBe(false);
    expect(marks.home_savings?.done).toBe(true);
    expect(Object.keys(marks)).not.toContain("score");
  });

  it("the mark keys are the same list as the database's check (migration 0030)", () => {
    const sql = readFileSync("supabase/migrations/0031_aftercare.sql", "utf8");
    const list = sql.match(/item_key in \(([^)]+)\)/)![1]!.match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, ""));
    expect(list).toEqual([...AFTERCARE_MARK_KEYS]);
    expect(PLAN_KEYS).toHaveLength(6);
  });
});

// ── Partner offers ──────────────────────────────────────────────────────

const offer = (id: string, name: string, cost: number, extra: Partial<Offer> = {}): Offer => ({
  id,
  name,
  kind: "secured_card",
  provider: "P",
  yearlyCostCents: cost,
  costNote: "x",
  url: "https://example.com",
  itinFriendly: false,
  affiliate: false,
  affiliateDisclosure: null,
  active: true,
  ...extra,
});

describe("partner offers", () => {
  it("rank by cost to the client, then by name; inactive offers are left out; being an affiliate changes nothing", () => {
    const ranked = rankOffers([
      offer("1", "Zeta", 5000, { affiliate: true, affiliateDisclosure: "Credalti may be paid if you sign up here." }),
      offer("2", "alpha", 5000),
      offer("3", "Cheap", 0, { affiliate: true, affiliateDisclosure: "Credalti may be paid if you sign up here." }),
      offer("4", "Gone", 0, { active: false }),
      offer("5", "Beta", 100),
    ]);
    expect(ranked.map((o) => o.name)).toEqual(["Cheap", "Beta", "alpha", "Zeta"]);
  });

  it("an offer carries no commission field, and the database has none to rank by", () => {
    for (const o of DEMO_OFFERS) expect(Object.keys(o).join(" ")).not.toMatch(/commission|payout|bounty|comision/i);
    const sql = readFileSync("supabase/migrations/0031_aftercare.sql", "utf8");
    const table = sql.slice(sql.indexOf("create table public.partner_offers"), sql.indexOf("alter table public.partner_offers"));
    expect(table).not.toMatch(/commission|payout|bounty/i);
    expect(sql).toMatch(/order by o\.yearly_cost_cents asc, lower\(o\.name\) asc/);
  });

  it("an affiliate offer needs its disclosure, and links must be https", () => {
    const base = { name: "Starter", kind: "secured_card", provider: "Bank", yearlyCostCents: 0, costNote: "No fee", url: "https://bank.example/x", itinFriendly: true, affiliate: true, affiliateDisclosure: null, active: true };
    expect(offerInputSchema.safeParse(base).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, affiliateDisclosure: "Credalti may be paid if you sign up." }).success).toBe(true);
    expect(offerInputSchema.safeParse({ ...base, affiliate: false, url: "http://bank.example/x" }).success).toBe(false);
    expect(offerInputSchema.safeParse({ ...base, affiliate: false, commissionCents: 500 }).success).toBe(false);
  });

  it("the disclosure says plainly that Credalti may be paid", () => {
    expect(AFFILIATE_LINE.en).toBe("Credalti may be paid if you sign up.");
    expect(AFFILIATE_LINE.es).toBe("Credalti puede recibir un pago si te inscribes.");
    for (const o of DEMO_OFFERS) {
      expect(o.name).toMatch(/\(example\)/);
      if (o.affiliate) expect(o.affiliateDisclosure?.length).toBeGreaterThan(20);
    }
  });
});

// ── Home-ready ──────────────────────────────────────────────────────────

const SIGNED: AgreementRecord = { disclosureAcknowledgedAt: ago(61), signedAt: ago(60), cancellationDeadline: ago(55), cancelledAt: null, serviceEndRequestedAt: null };

function facts(extra: Partial<CaseFacts> = {}): CaseFacts {
  return {
    ...EMPTY_CASE_FACTS,
    agreement: SIGNED,
    documents: [
      { kind: "government_id", receivedAt: ago(58), checkedAt: null },
      { kind: "proof_of_address", receivedAt: ago(57), checkedAt: null },
    ],
    reportImports: [ago(56)],
    review: { total: 10, reviewed: 10, confirmed: 3, finishedAt: ago(50) },
    rounds: [{ number: 1, preparedAt: ago(47), mailedAt: ago(45), letters: [{ recipient: "Equifax", mailClass: "first_class", status: "delivered", mailedAt: ago(45), deliveredAt: ago(41), returnedAt: null }], answers: [] }],
    ...extra,
  };
}

describe("the home-ready path", () => {
  it("three milestones come from the case and three from the client's own marks", () => {
    const track = homeReadyTrack(facts(), { home_savings: { done: true, at: ago(3) } });
    expect(track.map((m) => m.key)).toEqual([...HOME_MILESTONES]);
    expect(track.filter((m) => m.done).map((m) => m.key)).toEqual(["documents", "report_reviewed", "disputes_in_progress", "savings"]);
    expect(track.find((m) => m.key === "documents")!.at).toBe(ago(57));
    expect(track.filter((m) => m.clientMarks).map((m) => m.key)).toEqual(["positive_accounts", "savings", "loan_officer"]);
  });

  it("a partner's rows keep only milestone names and dates: anything else the database could send is dropped", () => {
    const rows = partnerHomeFromRows([
      { milestone: "documents", done_at: ago(57) },
      { milestone: "score", done_at: ago(1) },
      { milestone: "savings", done_at: null },
      { milestone: "report_reviewed", done_at: "not a date" },
    ]);
    expect(rows).toEqual([
      { milestone: "documents", doneAt: ago(57) },
      { milestone: "report_reviewed", doneAt: null },
      { milestone: "savings", doneAt: null },
    ]);
    expect(PARTNER_HOME_MILESTONES).toEqual([...HOME_MILESTONES, "graduated"]);
    const fromRecord = partnerHomeFromProgress({ documentsCompleteAt: ago(57), reviewFinishedAt: ago(50), rounds: [{ mailedAt: ago(45) }] }, { home_loan_officer: { done: true, at: ago(2) } }, null);
    expect(fromRecord.filter((r) => r.doneAt).map((r) => r.milestone)).toEqual(["documents", "report_reviewed", "disputes_in_progress", "loan_officer"]);
  });

  it("home-ready sharing extends the partner consent: the base text and its hash do not change; the line adds to it", () => {
    const jorge = { name: "Jorge Treviño", company: "Hipotecas del Valle" };
    const base = consentText("progress", jorge, "en");
    const withHome = consentText("progress", jorge, "en", { homeReady: true });
    expect(withHome.will).toEqual([...base.will, expect.stringMatching(/home-buying milestones.*Never amounts, account details or scores/)]);
    expect(withHome.never).toEqual(base.never);
    expect(consentHash("progress", jorge, "en")).toBe(consentHash("progress", jorge, "en", SHARING_CONSENT_VERSION, { homeReady: false }));
    expect(consentHash("progress", jorge, "en", SHARING_CONSENT_VERSION, { homeReady: true })).not.toBe(consentHash("progress", jorge, "en"));
    // "No compartir" never carries it.
    expect(consentText("none", jorge, "en", { homeReady: true }).will).toEqual(consentText("none", jorge, "en").will);
    expect(homeReadyAllowed("loan_officer")).toBe(true);
    expect(homeReadyAllowed("realtor")).toBe(true);
    expect(homeReadyAllowed("tax_preparer")).toBe(false);
  });

  it("'Connect me with a loan officer' goes to the referring partner, else to accepting loan officers by name, with a disclosure", () => {
    const lo = (id: string, name: string): IntroPartner => ({ id, name, company: null, kind: "loan_officer" });
    expect(introRoute({ id: "r", name: "Laura", company: null, kind: "realtor", status: "approved" }, [lo("b", "Zoe")]).how).toBe("referred");
    expect(introRoute({ id: "t", name: "Sandra", company: null, kind: "tax_preparer" }, [lo("b", "Zoe"), lo("a", "ana")])).toEqual({ how: "accepting", partners: [lo("a", "ana"), lo("b", "Zoe")] });
    expect(introRoute(null, []).partners).toEqual([]);
    const t = introText({ name: "Jorge Treviño", company: null }, "en");
    expect(t.sends.join(" ")).toMatch(/name, your phone number and your goal/);
    expect(t.disclosure.join(" ")).toMatch(/not a lender.*do not have to use this loan officer.*not paid for this introduction/s);
    expect(introHash({ name: "Jorge Treviño", company: null }, "en")).toMatch(/^[0-9a-f]{64}$/);
    expect(introHash({ name: "Jorge Treviño", company: null }, "en")).not.toBe(introHash({ name: "Jorge Treviño", company: null }, "es"));
  });
});

// ── ITIN ────────────────────────────────────────────────────────────────

describe("ITIN clients", () => {
  it("monitoring with an ITIN is not claimed: until IDIQ confirms it, the app says to ask the team", () => {
    expect(MONITORING_ITIN_POLICY).toBe("unknown");
    const monitoring = itinSections().find((s) => s.key === "monitoring")!;
    expect(monitoring.askTeam).toBe(true);
    expect(monitoring.body.en.join(" ")).toMatch(/still confirming.*Ask our team/);
    expect(itinMonitoringNote("es").title).toMatch(/pregúntale a nuestro equipo/i);
  });

  it("explains reports by mail with sources: AnnualCreditReport.com asks for an SSN online", () => {
    const reports = itinSections().find((s) => s.key === "reports")!;
    expect(reports.body.en.join(" ")).toMatch(/AnnualCreditReport\.com asks for a Social Security number online.*by mail/s);
    expect(reports.sources).toContain("experianAnnualNoSsn");
  });

  it("no letter template prints a Social Security number, an ITIN or their last four digits", () => {
    const ctx = {
      user: { id: "u", fullName: "Rosa Martínez", addressLines: ["123 Main St", "Houston, TX 77002"], locale: "es" as const },
      target: { type: "bureau" as const, key: "equifax", name: "Equifax", addressLines: ["P.O. Box 740256", "Atlanta, GA 30374"] },
      items: [card("equifax", "Banco Uno", 600, 1000)],
      date: NOW.toISOString(),
      roundNumber: 1,
      enclosures: ["government_id", "proof_of_address", "ssn_card"].map((k) => enclosureLabelFor(k, "itin", ENCLOSURE_LABELS)!),
    };
    const keys = Object.keys(TEMPLATES);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const text = TEMPLATES[key]!(ctx);
      expect(text, key).not.toMatch(/Social Security|\bSSN\b|last (4|four)|XXX-XX|\{ssn|\{itin/i);
      expect(containsTaxpayerNumber(text), key).toBe(false);
    }
  });

  it("an ITIN client's number document is the IRS letter, never called a Social Security card", () => {
    expect(enclosureLabelFor("ssn_card", "itin", ENCLOSURE_LABELS)).toBe("Copy of IRS letter assigning my ITIN");
    expect(enclosureLabelFor("ssn_card", "ssn", ENCLOSURE_LABELS)).toBe(ENCLOSURE_LABELS.ssn_card);
    expect(enclosureLabelFor("government_id", "itin", ENCLOSURE_LABELS)).toBe(ENCLOSURE_LABELS.government_id);
  });

  it("finds a full taxpayer number in any common form, and not other numbers", () => {
    for (const s of ["912-70-1234", "912 70 1234", "912701234", "my ITIN is 987-65-4321."]) expect(containsTaxpayerNumber(s), s).toBe(true);
    for (const s of ["ending in 1234", "$1,250", "(713) 555-0142", "round 2 on 11/24/2026", "+17135550142"]) expect(containsTaxpayerNumber(s), s).toBe(false);
  });

  it("the full number is never stored: the database keeps only the kind", () => {
    const sql = readFileSync("supabase/migrations/0031_aftercare.sql", "utf8");
    expect(sql).toMatch(/add column id_type text check \(id_type is null or id_type in \('ssn', 'itin'\)\)/);
    const all = readFileSync("supabase/setup.sql", "utf8").replace(/--.*$/gm, "");
    expect(all).not.toMatch(/\b(ssn|itin|tax_id|social_security)(_number|_full|_value)?\s+(text|varchar|char|bigint|integer|numeric)/i);
  });

  it("AltiBot knows the answers, with the rules: saved answers for ITIN, and the monitoring question stays a person's", () => {
    const prompt = coachSystemPrompt("full_service", "en");
    expect(prompt).toMatch(/ITIN: una persona con ITIN puede tener un expediente/);
    expect(prompt).toMatch(/todavía no está confirmado; di que una persona del equipo le responde/);
    expect(prompt).toMatch(/NUNCA pidas, repitas ni guardes un número de Seguro Social o un ITIN completo/);
    expect(coachSystemPrompt("diy", "en")).not.toMatch(/ITIN/);
    expect(libraryReplyFor("¿Cómo pido mi reporte de crédito si tengo ITIN?", DEMO_SAVED_ANSWERS)?.answer.id).toBe("00000000-0000-4000-a000-000000000022");
    expect(libraryReplyFor("Do my letters show my ITIN number?", DEMO_SAVED_ANSWERS, "en")?.answer.id).toBe("00000000-0000-4000-a000-000000000026");
    expect(bestMatch("¿Puedo activar el monitoreo con mi ITIN?", DEMO_SAVED_ANSWERS)).toBeNull();
    for (const a of ITIN_SAVED_ANSWERS) expect(containsTaxpayerNumber(a.answer)).toBe(false);
  });
});

// ── Graduation, and billing stopping at it ──────────────────────────────

describe("graduation", () => {
  it("is offered as 'done' only when nothing the client marked is still waiting", () => {
    expect(graduationStatus({ facts: facts(), markedStillReported: 0, graduation: null, now: NOW }).kind).toBe("ready");
    expect(graduationStatus({ facts: facts(), markedStillReported: 2, graduation: null, now: NOW }).kind).toBe("can_choose");
    // Inside the response window the round is still being answered.
    const fresh = facts({ rounds: [{ number: 1, preparedAt: ago(7), mailedAt: ago(5), letters: [], answers: [] }] });
    expect(graduationStatus({ facts: fresh, markedStillReported: 0, graduation: null, now: NOW }).kind).toBe("can_choose");
    // Nothing marked at all: nothing to dispute.
    expect(graduationStatus({ facts: facts({ rounds: [], review: { total: 4, reviewed: 4, confirmed: 0, finishedAt: ago(40) } }), markedStillReported: 0, graduation: null, now: NOW }).kind).toBe("ready");
    // Inside the cancellation window the client cancels instead.
    const inWindow: AgreementRecord = { ...SIGNED, signedAt: ago(1), disclosureAcknowledgedAt: ago(1), cancellationDeadline: new Date(NOW.getTime() + 2 * DAY).toISOString() };
    expect(graduationStatus({ facts: facts({ agreement: inWindow }), markedStillReported: 0, graduation: null, now: NOW }).kind).toBe("not_available");
  });

  it("the summary is facts on record, with no outcome claim", () => {
    const lines = graduationSummary(facts(), "en", { noLongerReported: 2 });
    expect(lines).toEqual([
      expect.stringMatching(/^You signed your agreement on/),
      "You reviewed 10 items on your report and marked 3 as inaccurate.",
      expect.stringMatching(/^Your team mailed 1 round of letters \(1 letter\), on /),
      "2 of the items you disputed no longer appear on your most recent report.",
    ]);
    for (const line of [...lines, ...graduationSummary(facts(), "es", { noLongerReported: 1 })]) {
      expect(checkClaimGuardrails(line), line).toEqual([]);
      expect(line, line).not.toMatch(OUTCOME_WORDS);
    }
    expect(GRADUATION_COPY.en.billing[0]).toBe("From the day you finish, no new charge is created.");
  });

  const METHOD: PaymentMethodSummary = { brand: "visa", last4: "4242", addedAt: ago(58), authorizationVersion: "v", authorizedAt: ago(58) };
  const round = (n: number, daysAgo: number): BillableRound => ({ number: n, mailed: true, mailedAt: ago(daysAgo), letters: [{ recipient: "Equifax", returned: false }] });
  const BASE_TERMS: PlanTerms = {
    type: "per_round",
    firstWorkFeeCents: 0,
    recurringCents: 8900,
    flat: null,
    dueRule: { kind: "after_first_round" },
    duration: { kind: "indefinite" },
    maxTotalCents: 60000,
    householdDiscountPercent: 0,
    countsUpdated: false,
  };
  const planOf = (terms: Partial<PlanTerms>) => {
    const t = { ...BASE_TERMS, ...terms };
    const name = { en: "Test", es: "Prueba" };
    const v: PlanVersion = { id: "p1", key: "test", version: 1, status: "active", name, terms: t, termsHash: planTermsHash(t, name), textVersion: "x", isDefault: true, attorney: { name: "Lic. Prueba", approvedOn: "2026-11-01" }, createdBy: "Carmen", createdAt: ago(300), activatedAt: ago(290), retiredAt: null };
    return snapshotPlan(v, { household: false });
  };

  it("billing stops at graduation: no charge after the client finishes, under every plan, however long we wait", () => {
    const graduatedAt = ago(20);
    const SIGNED_EARLY: AgreementRecord = { disclosureAcknowledgedAt: ago(101), signedAt: ago(100), cancellationDeadline: ago(95), cancelledAt: null, serviceEndRequestedAt: null };
    const contexts: Array<[string, BillingContext]> = [
      ["no plan", { agreement: SIGNED_EARLY, signedMonthlyFee: "89.00", rounds: [round(1, 80), round(2, 50)], account: { paymentMethod: METHOD, charges: [], pause: null } }],
      ["per round", { agreement: SIGNED_EARLY, signedMonthlyFee: null, rounds: [round(1, 80), round(2, 50)], plan: planOf({}), account: { paymentMethod: METHOD, charges: [], pause: null } }],
      ["subscription", { agreement: SIGNED_EARLY, signedMonthlyFee: null, rounds: [round(1, 80), round(2, 50)], plan: planOf({ type: "subscription", duration: { kind: "months", count: 6 }, maxTotalCents: null }), account: { paymentMethod: METHOD, charges: [], pause: null } }],
      ["flat fee", { agreement: SIGNED_EARLY, signedMonthlyFee: null, rounds: [round(1, 80), round(2, 50)], plan: planOf({ type: "flat_fee", recurringCents: 0, flat: { totalCents: 45000, rounds: 3, schedule: "installments" }, duration: { kind: "rounds", count: 3 }, maxTotalCents: null }), account: { paymentMethod: METHOD, charges: [], pause: null } }],
    ];
    for (const [label, c] of contexts) {
      // Before graduation the work already mailed can be charged (the control).
      const days = Array.from({ length: 60 }, (_, i) => new Date(Date.parse(graduatedAt) - (i + 1) * DAY));
      expect(days.some((at) => chargeEligibility(c, at).eligible), label).toBe(true);
      // Graduating records the end of the service on the agreement (migration 0030 does it in the database).
      const graduated: BillingContext = { ...c, agreement: { ...SIGNED_EARLY, serviceEndRequestedAt: graduatedAt } };
      for (let d = 0; d <= 120; d++) {
        const at = new Date(Date.parse(graduatedAt) + d * DAY);
        const e = chargeEligibility(graduated, at);
        expect(e.eligible, `${label}, day ${d}`).toBe(false);
        if (!e.eligible) expect(["service_end_requested", "nothing_unbilled", "nothing_mailed", "plan_complete", "waiting_for_work"], `${label}: ${e.code}`).toContain(e.code);
      }
      // Work mailed before and unbilled is never charged automatically: a person decides.
      const e = chargeEligibility(graduated, NOW);
      expect(e.eligible).toBe(false);
      if (!e.eligible && e.code === "service_end_requested") expect(e.needsPerson).toBe(true);
    }
  });
});
