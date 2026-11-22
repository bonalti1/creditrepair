import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails, checkMarketingCopy } from "@/lib/compliance/guardrails";
import { isForbiddenFieldName, parseHighLevelLead, readGoal, readState, stripForbiddenFields } from "@/lib/highlevel/lead";
import { chooseSalesperson, DEDUPE_DAYS, matchLead, memberFromHint } from "@/lib/highlevel/match";
import {
  clientStageEvents,
  HL_STAGE_LABEL,
  HL_STAGES,
  MAX_ATTEMPTS,
  nextAttemptAt,
  STAGE_PAYLOAD_KEYS,
  stagePayload,
  stageWebhookUrl,
} from "@/lib/highlevel/stages";
import { partnerCodeOf, sourceLine } from "@/lib/leads/source";
import { leadSourceFromRows } from "@/lib/leads/fromRows";
import { referralCodeFromCookie, referralCookie, REFERRAL_COOKIE_MAX_AGE } from "@/lib/partners/attribution";
import { allPartnerStrings, PARTNER_COPY, REFERRAL_COOKIE } from "@/lib/partners/copy";
import { buildDemoCommissions, buildDemoPartners, withDemoLeadSources } from "@/lib/partners/demo";
import { partnerMetrics, PARTNER_METRIC_INFO } from "@/lib/partners/metrics";
import { encodeQr, qrSvg } from "@/lib/partners/qr";
import {
  checkCommissionTerms,
  checkPartnerApplication,
  COMMISSION_BASES,
  commissionTotals,
  decidePartner,
  dollarsToCents,
  newReferralCode,
  partnerLink,
  referralStatus,
  referralView,
} from "@/lib/partners/rules";
import { buildInvitePath, parseInvite } from "@/lib/sales/invite";
import { buildDemoClients } from "@/lib/staff/demoClients";
import { buildDemoTeam, roundRobinNext, type TeamMember } from "@/lib/staff/team";
import type { StaffClient } from "@/lib/staff/types";

const NOW = new Date("2026-11-22T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const CONSENT = "Acepto que Credalti me contacte por WhatsApp sobre su servicio. Puedo pedir que dejen de escribirme cuando quiera.";
const LEAD = {
  contactId: "hlC0ntact123",
  firstName: "Carolina",
  lastName: "Esparza",
  phone: "(713) 555-0140",
  email: "Carolina@Ejemplo.com",
  state: "TX",
  goal: "Comprar una casa",
  consentText: CONSENT,
  consentAt: "2026-11-22T14:00:00Z",
  campaign: "Formulario Casa propia",
  utm: { source: "facebook", medium: "paid", campaign: "casa-propia-nov" },
  assignedTo: "luis@ejemplo.com",
  partnerCode: "Laura-Benitez",
};

// ── HighLevel lead: validation ──────────────────────────────────────────

describe("HighLevel lead: what the webhook accepts", () => {
  it("reads our documented body", () => {
    const parsed = parseHighLevelLead(LEAD, NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lead).toMatchObject({
      contactId: "hlC0ntact123",
      firstName: "Carolina",
      lastName: "Esparza",
      phone: "+17135550140",
      email: "carolina@ejemplo.com",
      state: "TX",
      goal: "mortgage",
      consentText: CONSENT,
      consentAt: "2026-11-22T14:00:00.000Z",
      campaign: "Formulario Casa propia",
      utm: { source: "facebook", medium: "paid", campaign: "casa-propia-nov" },
      assignedTo: "luis@ejemplo.com",
      partnerCode: "laura-benitez",
    });
    expect(parsed.dropped).toEqual([]);
  });

  it("reads HighLevel's own contact payload, with the workflow's values under customData", () => {
    const parsed = parseHighLevelLead(
      { contact_id: "abcDEF12345", full_name: "José Luis Ramírez", phone: "+1 210 555 0199", state: "Texas", customData: { consentText: CONSENT, goal: "auto", socio: "jorge-trevino" } },
      NOW,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.lead).toMatchObject({ contactId: "abcDEF12345", firstName: "José", lastName: "Luis Ramírez", phone: "+12105550199", state: "TX", goal: "auto", partnerCode: "jorge-trevino" });
  });

  it("refuses a lead without a name, a US phone, a state or the consent text", () => {
    const parsed = parseHighLevelLead({ phone: "12", state: "ZZ" }, NOW);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.problems).sort()).toEqual(["consent", "name", "phone", "state"]);
    const noConsent = parseHighLevelLead({ ...LEAD, consentText: "" }, NOW);
    expect(noConsent.ok).toBe(false);
  });

  it("refuses a malformed contact id instead of storing it", () => {
    const parsed = parseHighLevelLead({ ...LEAD, contactId: "<script>" }, NOW);
    expect(parsed.ok).toBe(false);
  });

  it("drops a Social Security number or a date of birth wherever it is, keeping only the field's name", () => {
    const parsed = parseHighLevelLead(
      {
        ...LEAD,
        ssn: "123-45-6789",
        dateOfBirth: "1980-01-01",
        customData: { fecha_nacimiento: "01/01/1980", "Seguro Social": "123456789", notes: "su ssn es 123-45-6789" },
        contact: { SSN: "x", dob: "y" },
      },
      NOW,
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.dropped.sort()).toEqual(["contact.SSN", "contact.dob", "customData.Seguro Social", "customData.fecha_nacimiento", "customData.notes", "dateOfBirth", "ssn"].sort());
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("123-45-6789");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("1980");
  });

  it("knows which field names are an SSN or a birth date, and which only look close", () => {
    for (const name of ["ssn", "SSN", "customerSsn", "social_security_number", "seguro_social", "itin", "dob", "DOB", "date_of_birth", "birthDate", "fechaDeNacimiento", "cumpleanos", "tax_id", "ssNumber"]) {
      expect(isForbiddenFieldName(name), name).toBe(true);
    }
    for (const name of ["waiting", "adobe", "lastName", "phone", "utm_source", "description", "socios", "email", "contact_id", "birthday_party_venue".replace("birth", "")]) {
      expect(isForbiddenFieldName(name), name).toBe(false);
    }
  });

  it("does not drop a phone or an id that happens to have nine or more digits", () => {
    const { dropped } = stripForbiddenFields({ phone: "713555014", contactId: "123456789", note: "hola" });
    expect(dropped).toEqual([]);
  });

  it("reads states and goals the way forms send them", () => {
    expect(readState("tx")).toBe("TX");
    expect(readState("Texas")).toBe("TX");
    expect(readState("Narnia")).toBeNull();
    expect(readGoal("Quiero comprar casa")).toBe("mortgage");
    expect(readGoal("troca")).toBe("auto");
    expect(readGoal("tarjeta de crédito")).toBe("card");
    expect(readGoal("")).toBe("general");
  });

  it("the route checks the secret in constant time, limits the body and rate, and fails closed", () => {
    const route = readFileSync("src/app/api/webhooks/highlevel/route.ts", "utf8");
    expect(route).toMatch(/safeEqual\(header, secret\)/);
    expect(route).toMatch(/x-credalti-secret/);
    expect(route).toMatch(/if \(!secret\)[\s\S]*503/);
    expect(route).toMatch(/MAX_LEAD_BYTES/);
    expect(route).toMatch(/rateLimit\(req, "webhook-highlevel"/);
    expect(route).toMatch(/reportError/);
    expect(route).toMatch(/UNVERIFIED/);
  });
});

// ── Dedupe and assignment ───────────────────────────────────────────────

describe("a lead we already have is updated, not duplicated", () => {
  const prospect = (over: Partial<Parameters<typeof matchLead>[1]["prospects"][number]> = {}) => ({
    id: "p1",
    phone: "+17135550140",
    highlevelContactId: null,
    createdAt: ago(3),
    convertedUserId: null,
    lostAt: null,
    ...over,
  });

  it("same HighLevel contact → update, even with another phone", () => {
    expect(matchLead({ phone: "+12105550000", contactId: "hl1" }, { prospects: [prospect({ highlevelContactId: "hl1" })], clients: [] }, NOW)).toEqual({ action: "update", prospectId: "p1", by: "contact_id" });
  });

  it("same phone within the window → update; older → the old one is closed and a new one starts", () => {
    expect(matchLead({ phone: "+17135550140", contactId: null }, { prospects: [prospect()], clients: [] }, NOW)).toEqual({ action: "update", prospectId: "p1", by: "phone" });
    expect(matchLead({ phone: "+17135550140", contactId: null }, { prospects: [prospect({ createdAt: ago(DEDUPE_DAYS + 1) })], clients: [] }, NOW)).toEqual({ action: "replace", previousId: "p1" });
  });

  it("already a client (same phone, or a converted prospect with the contact) → nothing new", () => {
    expect(matchLead({ phone: "+17135550140", contactId: null }, { prospects: [], clients: [{ id: "u1", phone: "+17135550140", highlevelContactId: null }] }, NOW)).toEqual({ action: "existing_client", clientId: "u1" });
    expect(matchLead({ phone: "+19995550000", contactId: "hl9" }, { prospects: [prospect({ highlevelContactId: "hl9", convertedUserId: "u9" })], clients: [] }, NOW)).toEqual({ action: "existing_client", clientId: "u9" });
  });

  it("someone new → create; a closed prospect does not count", () => {
    expect(matchLead({ phone: "+17135550140", contactId: null }, { prospects: [prospect({ lostAt: ago(1) })], clients: [] }, NOW)).toEqual({ action: "create" });
  });
});

describe("who follows up a lead", () => {
  const team = buildDemoTeam(NOW).members;

  it("the salesperson HighLevel named, by handle, email or name", () => {
    expect(memberFromHint(team, "luis")?.handle).toBe("luis");
    expect(memberFromHint(team, "ANA@ejemplo.com")?.handle).toBe("ana");
    expect(memberFromHint(team, "Luis Ortega")?.handle).toBe("luis");
    expect(memberFromHint(team, "Marta Leal")).toBeNull(); // a specialist does not take leads
    expect(chooseSalesperson(team, { hint: "luis@nowhere.com", lastSales: null }).how).not.toBe("highlevel");
  });

  it("else the partner's salesperson, else the next salesperson in turn", () => {
    expect(chooseSalesperson(team, { hint: null, partnerSalesperson: "luis", lastSales: null })).toEqual({ handle: "luis", how: "partner" });
    const first = chooseSalesperson(team, { hint: null, lastSales: null });
    expect(first).toEqual({ handle: "ana", how: "round_robin" });
    expect(chooseSalesperson(team, { hint: null, lastSales: "ana" })).toEqual({ handle: "luis", how: "round_robin" });
    expect(chooseSalesperson(team, { hint: null, lastSales: "luis" })).toEqual({ handle: "ana", how: "round_robin" });
  });

  it("the round-robin skips a deactivated salesperson, and falls back to an administrator when sales is empty", () => {
    const withoutLuis: TeamMember[] = team.map((m) => (m.handle === "luis" ? { ...m, active: false } : m));
    expect(roundRobinNext(withoutLuis, "ana", "sales")).toBe("ana");
    const noSales = team.filter((m) => m.role !== "sales");
    expect(chooseSalesperson(noSales, { hint: null, lastSales: null })).toEqual({ handle: "carmen", how: "admin_fallback" });
    expect(chooseSalesperson([], { hint: null, lastSales: null })).toEqual({ handle: null, how: "nobody" });
  });

  it("the specialists' round-robin is unchanged", () => {
    expect(roundRobinNext(team, null)).toBe("marta");
  });
});

// ── Stage sync: what goes back to HighLevel ─────────────────────────────

describe("stage events for HighLevel", () => {
  const clients = withDemoLeadSources(buildDemoClients(NOW), NOW);

  it("carry only the contact, the phone, the stage and its date: no credit data, no amounts", () => {
    const events = clients.flatMap((c) => clientStageEvents(c, NOW));
    expect(events.length).toBeGreaterThan(3);
    for (const event of events) {
      const payload = stagePayload(event);
      expect(Object.keys(payload).sort()).toEqual([...STAGE_PAYLOAD_KEYS].sort());
      const text = JSON.stringify(payload).toLowerCase();
      for (const word of ["score", "puntaje", "item", "report", "letter", "carta", "bureau", "equifax", "experian", "transunion", "amount", "monto", "$", "cents", "fee", "ssn", "address", "email"]) {
        expect(text, `${word} in ${text}`).not.toContain(word);
      }
      expect(payload.phone).toMatch(/^\+1\d{10}$/);
      expect(HL_STAGES).toContain(payload.stage);
      expect(payload.stageLabel).toBe(HL_STAGE_LABEL[payload.stage]);
    }
  });

  it("are once per person and stage, keyed by phone so a prospect who becomes a client keeps the key", () => {
    const client: StaffClient = { ...clients.find((c) => c.id === "c03")!, agreementSignedAt: ago(1) };
    const one = clientStageEvents(client, NOW);
    const two = clientStageEvents({ ...client, id: "another-id" }, NOW);
    expect(one.map((e) => e.dedupeKey)).toEqual(two.map((e) => e.dedupeKey));
    expect(one.find((e) => e.stage === "agreement_signed")?.dedupeKey).toBe(`${client.phone}:agreement_signed`);
  });

  it("only within the lookback window: turning the sync on does not send a whole history", () => {
    const old: StaffClient = { ...clients.find((c) => c.id === "c03")!, agreementSignedAt: ago(200), lastActivityAt: ago(200), rounds: [] };
    expect(clientStageEvents(old, NOW)).toEqual([]);
  });

  it("name each stage: invited, signed, cancelled in the window, ended, first round", () => {
    const base = clients.find((c) => c.id === "c01")!;
    const stagesOf = (c: StaffClient) => clientStageEvents(c, NOW).map((e) => e.stage).sort();
    expect(stagesOf({ ...base, leadSource: { ...base.leadSource!, invitedAt: ago(1) } })).toContain("invited");
    expect(stagesOf({ ...base, agreementSignedAt: ago(4), agreementCancelledAt: ago(3), cancelledWithinWindow: true })).toEqual(["agreement_signed", "cancelled_in_window"]);
    expect(stagesOf({ ...base, agreementSignedAt: ago(40), agreementCancelledAt: ago(2), cancelledWithinWindow: false })).toEqual(["service_ended"]);
    expect(stagesOf({ ...base, agreementSignedAt: ago(40), serviceEndRequestedAt: ago(2) })).toEqual(["service_ended"]);
    expect(
      stagesOf({ ...base, agreementSignedAt: ago(30), lastActivityAt: ago(1), documents: ["government_id", "proof_of_address"], rounds: [{ number: 1, status: "mailed", mailedAt: ago(2), respondedAt: null, letters: [] }] }),
    ).toEqual(["documents_complete", "first_round_mailed"]);
  });

  it("retry with growing waits, then give up", () => {
    expect(nextAttemptAt(1, NOW).getTime() - NOW.getTime()).toBe(5 * 60_000);
    expect(nextAttemptAt(2, NOW).getTime() - NOW.getTime()).toBe(10 * 60_000);
    expect(nextAttemptAt(30, NOW).getTime() - NOW.getTime()).toBe(12 * 60 * 60_000);
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
  });

  it("go to HIGHLEVEL_INBOUND_WEBHOOK_URL, else SALES_WEBHOOK_URL, and only over https", () => {
    expect(stageWebhookUrl({ HIGHLEVEL_INBOUND_WEBHOOK_URL: "https://hl.test/a", SALES_WEBHOOK_URL: "https://slack.test/b" })).toBe("https://hl.test/a");
    expect(stageWebhookUrl({ SALES_WEBHOOK_URL: "https://slack.test/b" })).toBe("https://slack.test/b");
    expect(stageWebhookUrl({ HIGHLEVEL_INBOUND_WEBHOOK_URL: "http://insecure.test" })).toBeNull();
    expect(stageWebhookUrl({})).toBeNull();
  });

  it("the database refuses any other key in a payload (migration 0017)", () => {
    const sql = readFileSync("supabase/migrations/0017_partners_highlevel.sql", "utf8");
    const allowed = sql.match(/if key not in \(([^)]+)\)/)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(allowed.sort()).toEqual([...STAGE_PAYLOAD_KEYS].sort());
  });
});

// ── Partners ────────────────────────────────────────────────────────────

describe("partner copy follows the claim rules", () => {
  it("every string, in Spanish and English, passes the advertising rules", () => {
    const strings = allPartnerStrings();
    expect(strings.length).toBeGreaterThan(60);
    for (const text of strings) {
      expect(checkMarketingCopy(text, "full_service"), text).toEqual([]);
      expect(checkClaimGuardrails(text, "full_service"), text).toEqual([]);
    }
  });

  it("the rules say: no promises, no SSNs or reports, no pay per result, disclose the commission", () => {
    const es = PARTNER_COPY.es.rules.join(" ");
    expect(es).toMatch(/No prometas resultados/);
    expect(es).toMatch(/Seguro Social/);
    expect(es).toMatch(/reportes de crédito/);
    expect(es).toMatch(/nunca depende de lo que pase en un reporte/);
    expect(es).toMatch(/recibes una comisión/);
    expect(PARTNER_COPY.en.rules).toHaveLength(PARTNER_COPY.es.rules.length);
    expect(PARTNER_COPY.es.disclosureLine).toMatch(/comisión/);
    expect(PARTNER_COPY.en.disclosureLine).toMatch(/commission/);
  });

  it("the English copy has the same shape as the Spanish", () => {
    const shape = (v: unknown): unknown => (Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
    expect(shape(PARTNER_COPY.en)).toEqual(shape(PARTNER_COPY.es));
  });
});

describe("partner rules", () => {
  it("an application needs a name, what they do, a US phone and the rules accepted", () => {
    expect(checkPartnerApplication({ name: "", kind: "", phone: "", acceptsTerms: false })).toEqual({
      ok: false,
      problems: { name: "required", kind: "required", phone: "required", acceptsTerms: "required" },
    });
    const ok = checkPartnerApplication({ name: "Laura Benítez", company: " Benítez Realty ", kind: "realtor", phone: "713-555-0161", email: "LAURA@ejemplo.com", state: "tx", acceptsTerms: true });
    expect(ok).toEqual({ ok: true, value: { name: "Laura Benítez", company: "Benítez Realty", kind: "realtor", phone: "+17135550161", email: "laura@ejemplo.com", state: "TX" } });
  });

  it("a referral code is a safe, unused slug", () => {
    expect(newReferralCode("Laura Benítez", [])).toBe("laura-benitez");
    expect(newReferralCode("Laura Benítez", ["laura-benitez"])).toBe("laura-benitez-2");
    expect(newReferralCode("Al", [])).toMatch(/^[a-z0-9-]{3,30}$/);
    expect(partnerLink("https://app.credalti.com/", "laura-benitez")).toBe("https://app.credalti.com/r/laura-benitez");
  });

  it("an administrator approves (which gives the code), declines, suspends and reactivates; nothing else", () => {
    const pending = buildDemoPartners(NOW).find((p) => p.status === "pending")!;
    const approved = decidePartner(pending, "approved", ["laura-benitez"], NOW);
    expect(approved.ok && approved.partner.referralCode).toBe("sandra-olvera");
    expect(decidePartner(pending, "suspended", [], NOW).ok).toBe(false);
    expect(decidePartner(pending, "made-up", [], NOW).ok).toBe(false);
    const laura = buildDemoPartners(NOW)[0]!;
    const suspended = decidePartner(laura, "suspended", [], NOW);
    expect(suspended.ok && suspended.partner.referralCode).toBe("laura-benitez");
  });

  it("commission is per signed or active client, never per result, and stays in sane bounds", () => {
    expect(COMMISSION_BASES).toEqual(["none", "signed_client", "active_client"]);
    expect(COMMISSION_BASES.join(" ")).not.toMatch(/result|deletion|removal|item|point/i);
    expect(checkCommissionTerms("per_deletion", "50").ok).toBe(false);
    expect(checkCommissionTerms("signed_client", "100")).toEqual({ ok: true, basis: "signed_client", cents: 10000 });
    expect(checkCommissionTerms("signed_client", "0").ok).toBe(false);
    expect(checkCommissionTerms("none", "")).toEqual({ ok: true, basis: "none", cents: 0 });
    expect(dollarsToCents("$1,250.5")).toBe(125050);
    expect(dollarsToCents("abc")).toBeNull();
    const sql = readFileSync("supabase/migrations/0017_partners_highlevel.sql", "utf8");
    expect(sql).toMatch(/commission_basis in \('none', 'signed_client', 'active_client'\)/);
  });

  it("commission totals come from the records", () => {
    expect(commissionTotals(buildDemoCommissions(NOW), "p-laura")).toEqual({ owedCents: 20000, paidCents: 10000, balanceCents: 10000 });
  });

  it("a partner sees a coarse status and nothing else about a referral", () => {
    const base = { agreementSignedAt: null, agreementCancelledAt: null, serviceEndRequestedAt: null, rounds: [] };
    expect(referralStatus(base)).toBe("contacted");
    expect(referralStatus({ ...base, agreementSignedAt: ago(5) })).toBe("signed");
    expect(referralStatus({ ...base, agreementSignedAt: ago(50), rounds: [{ number: 1, status: "mailed", mailedAt: ago(10), respondedAt: null, letters: [] }] })).toBe("active");
    expect(referralStatus({ ...base, agreementSignedAt: ago(5), agreementCancelledAt: ago(4) })).toBe("not_continued");
    expect(referralStatus({ ...base, lostAt: ago(1) })).toBe("not_continued");
    const client = withDemoLeadSources(buildDemoClients(NOW), NOW).find((c) => c.id === "c09")!;
    expect(Object.keys(referralView(client)).sort()).toEqual(["firstName", "id", "lastInitial", "referredAt", "status"]);
    expect(referralView(client).lastInitial).toHaveLength(1);
  });

  it("the database function gives the same coarse statuses and only first name and last initial", () => {
    const sql = readFileSync("supabase/migrations/0017_partners_highlevel.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create function public.partner_referrals()"), sql.indexOf("revoke all on function public.partner_id()"));
    expect(fn).toMatch(/returns table \(referral_id uuid, first_name text, last_initial text, referred_at timestamptz, status text\)/);
    for (const status of ["contacted", "signed", "active", "not_continued"]) expect(fn).toContain(`'${status}'`);
    expect(fn).not.toMatch(/report_items|letters|charges|score|phone_e164/);
  });
});

describe("referral attribution", () => {
  it("the link's cookie lasts 60 days, first party, and reads back only a well-formed code", () => {
    expect(REFERRAL_COOKIE_MAX_AGE).toBe(60 * 24 * 60 * 60);
    expect(referralCookie("laura-benitez", true)).toMatchObject({ name: REFERRAL_COOKIE, path: "/", sameSite: "lax", secure: true, maxAge: REFERRAL_COOKIE_MAX_AGE });
    expect(referralCodeFromCookie(`a=1; ${REFERRAL_COOKIE}=laura-benitez; b=2`)).toBe("laura-benitez");
    expect(referralCodeFromCookie(`${REFERRAL_COOKIE}=..%2F..%2Fadmin`)).toBeNull();
    expect(referralCodeFromCookie(null)).toBeNull();
  });

  it("the invitation carries the partner's code through to the client", () => {
    const path = buildInvitePath({ name: "Felipe", goal: "mortgage", state: "TX", refName: "Ana", partner: "laura-benitez" });
    expect(path).toContain("p=laura-benitez");
    expect(parseInvite(new URLSearchParams(path.split("?")[1]))?.partner).toBe("laura-benitez");
    expect(parseInvite(new URLSearchParams("n=Felipe&p=<x>"))?.partner).toBeUndefined();
    expect(partnerCodeOf({ channel: "partner", partnerId: "p", partnerCode: "laura-benitez" })).toBe("laura-benitez");
  });

  it("a lead's source reads from the rows: HighLevel campaign, partner, consent, invitation", () => {
    const partners = new Map([["p1", { id: "p1", name: "Laura Benítez", referral_code: "laura-benitez" }]]);
    const source = leadSourceFromRows(
      {
        source: "highlevel",
        source_detail: { firstTouch: { campaign: "Casa propia", utm: { source: "facebook", evil: "<x>" } } },
        highlevel_contact_id: "hl123456",
        partner_id: "p1",
        consent_text: CONSENT,
        consent_at: "2026-11-20T10:00:00Z",
        invited_at: null,
      },
      null,
      partners,
    );
    expect(source).toMatchObject({ channel: "highlevel", campaign: "Casa propia", utm: { source: "facebook" }, partnerName: "Laura Benítez", partnerCode: "laura-benitez", highlevelContactId: "hl123456" });
    expect(sourceLine(source)).toBe("HighLevel · Casa propia · socio · Laura Benítez");
    expect(leadSourceFromRows({ source: "manual" }, null, new Map())).toBeNull();
    expect(leadSourceFromRows(undefined, { referred_partner_id: "p1" }, partners)?.channel).toBe("partner");
  });
});

describe("the partner's QR code", () => {
  it("is a valid QR symbol: the right size for the text and three finder patterns", () => {
    const { size, modules } = encodeQr("https://app.credalti.com/r/laura-benitez");
    expect(size).toBe(29); // version 3
    const finderAt = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6].every((i) => modules[y]![x + i] && modules[y + 6]![x + i] && modules[y + i]![x] && modules[y + i]![x + 6]);
    expect(finderAt(0, 0) && finderAt(size - 7, 0) && finderAt(0, size - 7)).toBe(true);
    // Timing pattern between the finders.
    for (let i = 8; i < size - 8; i++) expect(modules[6]![i]).toBe(i % 2 === 0);
    expect(encodeQr("x".repeat(200)).size).toBe(57); // version 10
    expect(() => encodeQr("x".repeat(400))).toThrow();
  });

  it("draws as SVG with no outside markup", () => {
    const svg = qrSvg("https://app.credalti.com/r/laura-benitez", { title: "QR <b>" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<b>");
    expect(svg).toMatch(/<path d="M/);
  });
});

describe("the Socios numbers on the dashboard", () => {
  it("every number has a definition", () => {
    for (const info of Object.values(PARTNER_METRIC_INFO)) {
      expect(info.label.length).toBeGreaterThan(3);
      expect(info.definition.length).toBeGreaterThan(30);
    }
  });

  it("are counted from the records", () => {
    const clients = withDemoLeadSources(buildDemoClients(NOW), NOW);
    const m = partnerMetrics(clients, buildDemoPartners(NOW), buildDemoCommissions(NOW), "all", NOW);
    const referred = clients.filter((c) => c.leadSource?.partnerId);
    expect(m.referrals).toBe(referred.length);
    expect(m.signed).toBe(referred.filter((c) => c.agreementSignedAt).length);
    expect(m.active).toBe(referred.filter((c) => referralStatus(c) === "active").length);
    expect(m.owedCents).toBe(27500);
    expect(m.paidCents).toBe(10000);
    expect(m.approved).toBe(2);
    expect(m.pending).toBe(1);
    expect(m.rows.map((r) => r.id)).toEqual(["p-laura", "p-jorge", "p-raul"]);
  });
});

describe("demo", () => {
  it("shows sample partners and a HighLevel lead from today", () => {
    const clients = withDemoLeadSources(buildDemoClients(NOW), NOW);
    const hl = clients.find((c) => c.id === "c40")!;
    expect(hl.leadSource?.channel).toBe("highlevel");
    expect(hl.signedUpAt).toBeNull();
    expect(new Set(clients.map((c) => c.id)).size).toBe(clients.length);
    expect(buildDemoPartners(NOW).map((p) => p.status).sort()).toEqual(["approved", "approved", "pending", "suspended"]);
  });
});
