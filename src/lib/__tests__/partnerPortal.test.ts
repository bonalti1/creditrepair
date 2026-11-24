import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import {
  CARE_ROLE_LABEL,
  careLine,
  DIGEST_BODIES,
  digestItems,
  digestParams,
  digestText,
  digestTime,
  digestWeekKey,
  flyerCopy,
  kitFeesLine,
  kitMessages,
  openShareRequest,
  PARTNER_REFERRAL_COLUMNS,
  referralFromRow,
  SHARE_REQUEST_BODIES,
  SHARE_REQUEST_CARD,
  shareAskState,
  shareRequestText,
  TEAM_PROMISE,
  teamNoteProblems,
} from "../partners/portal";
import { PORTAL_COPY } from "../partners/portalCopy";
import { PARTNER_COPY } from "../partners/copy";
import { PARTNER_KIND_LABEL, PARTNER_KINDS, partnerKindOf, pipelineCounts, PIPELINE_STAGES, REFERRAL_STATUSES, referralStatus } from "../partners/rules";
import type { PartnerProgress } from "../partners/sharing";
import { CLIENT_SHARING_COPY, PARTNER_SHARING_COPY } from "../partners/sharingCopy";
import { SITE_COPY } from "../site/copy";

// The partner portal (docs/PARTNERS.md, "The partner portal"; migration
// 0033): the pipeline, who looks after a client and the team's promise, "ask
// to follow progress", the weekly summary, the partner kit and the notes
// between a partner and the team. The pure parts, and every word against the
// advertising claim rules, in English and Spanish.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-23T16:00:00Z"); // A Monday, 10:00 in Texas.
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const MIGRATION = readFileSync("supabase/migrations/0033_partner_portal.sql", "utf8");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") out.push(String((value as (...a: unknown[]) => string)("María López", "3 de diciembre")));
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Words that would describe an outcome, a deletion, a percentage, or press. */
const OUTCOME = /elimin|\bborrad[oa]s?\b|delet|remov|garantiz|guarant|arregl|\bfixed\b|\d+\s*%|porcentaje|percent|score went|\bfree\b|gratis|hurry|apúrate|last chance|última oportunidad/i;

const allWords = () => [
  ...strings(PORTAL_COPY),
  ...strings(TEAM_PROMISE),
  ...strings(SHARE_REQUEST_BODIES),
  ...strings(SHARE_REQUEST_CARD),
  ...strings(DIGEST_BODIES),
  ...strings(CARE_ROLE_LABEL),
  ...PARTNER_KINDS.flatMap((kind) => [true, false].flatMap((fees) => kitMessages({ name: "Laura Benítez", kind }, "https://credalti.com/r/laura-benitez", fees).map((m) => m.text))),
  ...(["en", "es"] as const).flatMap((l) => [true, false].flatMap((fees) => strings(flyerCopy(l, { name: "Laura Benítez", company: "Benítez Realty" }, fees)))),
];

describe("every word of the portal passes the claim rules and never speaks of an outcome", () => {
  it("in English and Spanish: no promise, no result, no 'free', no pressure", () => {
    const words = allWords();
    expect(words.length).toBeGreaterThan(150);
    for (const text of words) {
      expect(checkMarketingCopy(text), text).toEqual([]);
      expect(checkClaimGuardrails(text), text).toEqual([]);
      expect(text, text).not.toMatch(OUTCOME);
    }
  });

  it("the English and Spanish copy have the same keys", () => {
    expect(Object.keys(PORTAL_COPY.en).sort()).toEqual(Object.keys(PORTAL_COPY.es).sort());
    expect(Object.keys(PARTNER_SHARING_COPY.en).sort()).toEqual(Object.keys(PARTNER_SHARING_COPY.es).sort());
    expect(Object.keys(CLIENT_SHARING_COPY.en).sort()).toEqual(Object.keys(CLIENT_SHARING_COPY.es).sort());
    // English first: the English object comes first in each copy file.
    for (const file of ["src/lib/partners/copy.ts", "src/lib/partners/sharingCopy.ts", "src/lib/partners/portalCopy.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text.indexOf("\n  en: {"), file).toBeLessThan(text.indexOf("\n  es: {"));
    }
  });

  it("the team's promise is about the process: who reaches out and how soon, never a result", () => {
    for (const l of ["en", "es"] as const) {
      const text = TEAM_PROMISE[l].lines.join(" ");
      expect(text).toMatch(l === "en" ? /business day/ : /día hábil/);
      expect(text).toMatch(l === "en" ? /Nobody can promise results/ : /Nadie puede prometer resultados/);
    }
  });
});

describe("who is taking care of your client", () => {
  it("first name and role, with the team's name", () => {
    expect(careLine({ firstName: "Ana", role: "specialist" }, "en")).toBe("Ana · Credit specialist, Credalti team");
    expect(careLine({ firstName: "Ana", role: "specialist" }, "es")).toBe("Ana · Especialista de crédito, equipo Credalti");
    expect(careLine({ firstName: "Luis", role: "sales" }, "en")).toBe("Luis · Enrollment advisor, Credalti team");
  });

  it("reads a database row; nothing but the columns of partner_referrals()", () => {
    const r = referralFromRow({
      referral_id: "p1", first_name: "Felipe", last_initial: "A", referred_at: ago(1), status: "contacted", contacted_at: ago(0.9),
      care_first_name: "Ana", care_role: "sales", has_account: false, shared_client_id: null, share_requested_at: null,
    });
    expect(r).toMatchObject({ firstName: "Felipe", status: "contacted", care: { firstName: "Ana", role: "sales" }, hasAccount: false, sharedClientId: null });
    expect(referralFromRow({ referral_id: "x", status: "weird", care_role: "boss", care_first_name: "X" })).toMatchObject({ status: "contacted", care: null });
  });

  it("the columns in the code are exactly the database function's, and nothing from the case", () => {
    const block = MIGRATION.split("create function public.partner_referrals()")[1]!.split("language sql")[0]!;
    const cols = [...block.matchAll(/^\s+([a-z_]+)\s+(uuid|text|timestamptz|boolean)/gm)].map((m) => m[1]);
    expect(cols).toEqual([...PARTNER_REFERRAL_COLUMNS]);
    const fn = MIGRATION.slice(MIGRATION.indexOf("create function public.partner_referrals()"), MIGRATION.indexOf("revoke all on function public.partner_referrals()"));
    expect(fn).not.toMatch(/report_items|letters|charges|score|phone_e164|address/);
    for (const status of REFERRAL_STATUSES) expect(fn).toContain(`'${status}'`);
  });
});

describe("the pipeline", () => {
  const base = { agreementSignedAt: null, agreementCancelledAt: null, serviceEndRequestedAt: null, rounds: [] };

  it("referred → contacted → signed → active → finished, and 'did not continue' beside it", () => {
    expect(PIPELINE_STAGES).toEqual(["referred", "contacted", "signed", "active", "finished"]);
    expect(referralStatus({ ...base, signedUpAt: null, invitedAt: null })).toBe("referred");
    expect(referralStatus({ ...base, signedUpAt: null, invitedAt: ago(1) })).toBe("contacted");
    expect(referralStatus({ ...base, signedUpAt: ago(1) })).toBe("contacted");
    expect(referralStatus({ ...base, agreementSignedAt: ago(5) })).toBe("signed");
    expect(referralStatus({ ...base, agreementSignedAt: ago(50), rounds: [{ number: 1, status: "mailed", mailedAt: ago(10), respondedAt: null, letters: [] }] })).toBe("active");
    // Graduation also records the end of the service: it is "finished", not "did not continue".
    expect(referralStatus({ ...base, agreementSignedAt: ago(200), serviceEndRequestedAt: ago(2), finishedAt: ago(2) })).toBe("finished");
    expect(referralStatus({ ...base, agreementSignedAt: ago(5), agreementCancelledAt: ago(4) })).toBe("not_continued");
    expect(referralStatus({ ...base, lostAt: ago(1) })).toBe("not_continued");
  });

  it("counts every step", () => {
    const counts = pipelineCounts([{ status: "referred" }, { status: "active" }, { status: "active" }, { status: "not_continued" }]);
    expect(counts).toEqual({ referred: 1, contacted: 0, signed: 0, active: 2, finished: 0, not_continued: 1 });
  });

  it("every status has its words for the partner, in both languages", () => {
    for (const l of ["en", "es"] as const) for (const s of REFERRAL_STATUSES) expect(PARTNER_COPY[l].portal.statusMeaning[s].length).toBeGreaterThan(5);
  });
});

describe("ask to follow progress", () => {
  const r = { status: "contacted" as const, hasAccount: true, sharedClientId: null, shareRequestedAt: null };

  it("only a person with an account who does not share, once every 14 days", () => {
    expect(shareAskState(r, NOW)).toBe("can_ask");
    expect(shareAskState({ ...r, hasAccount: false }, NOW)).toBe("no_account");
    expect(shareAskState({ ...r, sharedClientId: "c1" }, NOW)).toBe("sharing");
    expect(shareAskState({ ...r, status: "not_continued" }, NOW)).toBe("closed");
    expect(shareAskState({ ...r, shareRequestedAt: ago(3) }, NOW)).toBe("requested");
    expect(shareAskState({ ...r, shareRequestedAt: ago(14.1) }, NOW)).toBe("can_ask");
  });

  it("the client's message names the partner, says it is their choice, and fits the template", () => {
    const text = shareRequestText("en", "Rosa Martínez", "Laura Benítez, Benítez Realty");
    expect(text).toBe(SHARE_REQUEST_BODIES.en.replace("{{1}}", "Rosa").replace("{{2}}", "Laura Benítez, Benítez Realty"));
    expect(text).toMatch(/your choice/);
    expect(shareRequestText("es", "Rosa", "Laura")).toMatch(/Es tu decisión/);
    for (const l of ["en", "es"] as const) expect(SHARE_REQUEST_BODIES[l]).not.toMatch(/\n/);
  });

  it("the card shows until the client decides, says not now, or 14 days pass", () => {
    const request = { id: "q1", partnerId: "p1", partnerName: "Laura", at: ago(2), dismissedAt: null };
    expect(openShareRequest([request], [], [], NOW)).toEqual(request);
    expect(openShareRequest([{ ...request, dismissedAt: ago(1) }], [], [], NOW)).toBeNull();
    expect(openShareRequest([request], [{ partnerId: "p1", at: ago(1) }], [], NOW)).toBeNull();
    // A choice made before the request does not answer it.
    expect(openShareRequest([request], [{ partnerId: "p1", at: ago(5) }], [], NOW)).toEqual(request);
    expect(openShareRequest([request], [], [{ partnerId: "p1", level: "progress" }], NOW)).toBeNull();
    expect(openShareRequest([{ ...request, at: ago(15) }], [], [], NOW)).toBeNull();
  });
});

describe("the weekly summary", () => {
  const client: PartnerProgress = {
    clientId: "c1", name: "Rosa Martínez", level: "progress", how: "referred", sharedAt: ago(30), goal: "mortgage",
    agreementSignedAt: ago(28), workStartsAt: ago(24), serviceEndedAt: null, documentsCompleteAt: ago(22), reviewFinishedAt: ago(5),
    rounds: [{ number: 1, mailedAt: ago(2), answerDueAt: new Date(NOW.getTime() + 28 * DAY).toISOString(), nextRoundAt: new Date(NOW.getTime() + 38 * DAY).toISOString() }],
    disputingCount: null, noLongerReportedCount: null,
  };

  it("Mondays from 9:00 on the partner's clock, once per local ISO week", () => {
    expect(digestTime(NOW, "America/Chicago")).toBe(true);
    expect(digestTime(new Date("2026-11-23T14:00:00Z"), "America/Chicago")).toBe(false); // 8:00
    expect(digestTime(new Date("2026-11-24T16:00:00Z"), "America/Chicago")).toBe(false); // Tuesday
    expect(digestWeekKey(NOW, "America/Chicago")).toBe("2026-W48");
    expect(digestWeekKey(new Date("2026-01-01T18:00:00Z"), "America/Chicago")).toBe("2026-W01");
  });

  it("only the week's milestones of clients who share, in the same words as the notices", () => {
    const items = digestItems([client], NOW);
    expect(items.map((i) => i.key)).toEqual(["review", "round_1"]);
    const text = digestText({ name: "Laura Benítez" }, items);
    expect(text).toMatch(/^Hi, Laura\. Your weekly Credalti summary: Rosa finished reviewing their report\. · Rosa's round 1 letters were mailed/);
    expect(digestText({ name: "Laura Benítez", locale: "es" }, items)).toMatch(/^Hola, Laura\. Tu resumen semanal de Credalti:/);
    expect(digestParams({ name: "Laura" }, items)[1]).not.toMatch(/\n/);
    // Before sharing began, nothing.
    expect(digestItems([{ ...client, sharedAt: ago(1) }], NOW)).toEqual([]);
  });
});

describe("the partner kit", () => {
  const link = "https://credalti.com/r/laura-benitez";

  it("three messages in English and three in Spanish, each with the link and whether the partner is paid", () => {
    for (const fees of [true, false]) {
      const messages = kitMessages({ name: "Laura Benítez", kind: "realtor" }, link, fees);
      expect(messages.map((m) => `${m.locale}:${m.key}`)).toEqual(["en:text", "en:email", "en:post", "es:text", "es:email", "es:post"]);
      for (const m of messages) {
        expect(m.text).toContain(link);
        expect(m.text).toContain(kitFeesLine(m.locale, fees));
      }
    }
    expect(kitFeesLine("en", false)).toMatch(/no payment/);
    expect(kitFeesLine("en", true)).toMatch(/commission/);
    expect(kitFeesLine("es", false)).toMatch(/ningún pago/);
  });

  it("works for every kind of partner, not only realtors", () => {
    const intros = new Set(PARTNER_KINDS.map((kind) => kitMessages({ name: "Sam", kind }, link, false).find((m) => m.key === "email" && m.locale === "en")!.text.split("\n")[4]));
    expect(intros.size).toBe(PARTNER_KINDS.length);
    expect(PARTNER_KINDS).toEqual(["realtor", "loan_officer", "tax_preparer", "car_dealer", "attorney", "other"]);
    for (const l of ["en", "es"] as const) for (const k of PARTNER_KINDS) expect(PARTNER_KIND_LABEL[l][k].length).toBeGreaterThan(3);
    expect(partnerKindOf("car_dealer")).toBe("car_dealer");
    expect(partnerKindOf("banker")).toBe("other");
    // The database's list is the same.
    const check = MIGRATION.match(/check \(kind in \(([^)]+)\)\)/)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(check).toEqual([...PARTNER_KINDS]);
    // The website names more than realtors.
    expect(SITE_COPY.en.partners.who.map((w) => w.title)).toEqual(expect.arrayContaining(["Car dealers", "Attorneys"]));
    expect(SITE_COPY.es.partners.who).toHaveLength(SITE_COPY.en.partners.who.length);
  });

  it("the flyer says Alti is AI, says whether the partner is paid, and promises nothing", () => {
    const en = flyerCopy("en", { name: "Laura Benítez", company: "Benítez Realty" }, false);
    expect(en.eyebrow).toBe("Recommended by Laura Benítez, Benítez Realty");
    expect(en.fees).toBe(kitFeesLine("en", false));
    expect(en.points.join(" ")).toMatch(/Nobody can promise results/);
    const source = readFileSync("src/components/partners/PartnerFlyer.tsx", "utf8");
    expect(source).toMatch(/pose="thumbsUp"/);
    expect(source).toMatch(/aiByline\(locale\)/);
    expect(source).not.toMatch(/character="cameo"|altibot/i);
  });
});

describe("notes between a partner and the team", () => {
  it("a plain note about steps and dates goes", () => {
    expect(teamNoteProblems("Hi team, Rosa asked whether she needs to send anything else before her next round. Thanks!")).toEqual([]);
    expect(teamNoteProblems("Gracias, Laura. Le escribí hoy en su app; su siguiente ronda está en su línea de tiempo.", "es")).toEqual([]);
  });

  it("promises, scores, amounts, account numbers, SSNs and birth dates do not", () => {
    const bad = [
      "The collection will be deleted next month.",
      "We guarantee removal of the late payment.",
      "Her score is 580 now.",
      "She owes $1,200 on that card.",
      "Account number 4421998877 is the one.",
      "His SSN is 123-45-6789.",
      "Date of birth 04/12/1985.",
    ];
    for (const text of bad) expect(teamNoteProblems(text).length, text).toBeGreaterThan(0);
    expect(teamNoteProblems("Su puntaje subió.", "es")[0]!.why).toMatch(/datos de crédito/);
  });
});
