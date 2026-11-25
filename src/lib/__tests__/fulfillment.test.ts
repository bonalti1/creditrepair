import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dueFollowups, followupStates, openSituations } from "../autopilot/followups";
import { planDeliveries } from "../autopilot/plan";
import { ALL_TEMPLATES, renderTemplate } from "../autopilot/templates";
import { DEFAULT_AUTOPILOT, type AutopilotEnv, type OutboundMessage } from "../autopilot/types";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { DEMO_RAW_REPORT } from "../demo";
import { parseReport } from "../domain/parser";
import { incomeSource, postingPlan, readStatement, detectStatementMapping, reconcileMonth, suggestClient, toMonth, expectedInMonth, type CommissionLine } from "../fulfillment/commissions";
import { detectMapping, existingFrom, matchSalesperson, planImport, sensitiveColumns, shortName, summarize, toState, toUsE164, crcStatus } from "../fulfillment/crcImport";
import {
  clientReviewLine,
  currentReview,
  documentRejected,
  powerOfAttorneyEnabled,
  POA_VERSION,
  reviewState,
  uploadableExtraKinds,
  type DocumentReview,
} from "../fulfillment/documents";
import { earlyMonitoringReminder, monitoringSummary, REMINDER_LEAD_DAYS, type MonitoringCheck } from "../fulfillment/monitoring";
import { channelsFor, DEFAULT_NOTIFICATION_SETTINGS, messageCategory, NOTIFICATION_COPY, settingsAllow, settingsProblem, type NotificationSettings } from "../fulfillment/notifications";
import { buildDemoClients } from "../staff/demoClients";
import { can, CAPABILITIES } from "../staff/permissions";
import { clientStage, missingDocuments, nextStep, sendableRound } from "../staff/stage";
import type { StaffClient, StaffRound } from "../staff/types";

// Fulfillment (docs/FULFILLMENT.md): notification settings and the
// autopilot's channel choice, monitoring tracking and its reminder, the
// commission reconciliation, document review, the CRC import, graduation.

const NOW = new Date("2026-12-05T18:00:00.000Z"); // noon in Texas
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const dayAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const ON: AutopilotEnv = {
  settings: { ...DEFAULT_AUTOPILOT, roundsEnabled: true, followupsEnabled: true },
  channels: { whatsapp: true, email: true, approvedTemplates: "all", simulated: false },
};

function client(overrides: Partial<StaffClient> = {}): StaffClient {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    firstName: "Rosa",
    lastName: "Prueba",
    phone: "+17135550100",
    email: "rosa@example.com",
    state: "TX",
    addressLines: ["1 Calle Ejemplo", "Houston, TX 77001"],
    salesperson: "ana",
    createdAt: ago(30),
    signedUpAt: ago(30),
    agreementSignedAt: ago(28),
    documents: ["government_id", "proof_of_address"],
    report: parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(20) }),
    answers: {},
    rounds: [],
    billing: { paymentMethod: null, charges: [], pause: null },
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...overrides,
  };
}

const settings = (s: Partial<NotificationSettings>): NotificationSettings => ({ ...DEFAULT_NOTIFICATION_SETTINGS, ...s });

function queued(c: StaffClient, topic: string, at = ago(0.1)): OutboundMessage {
  return {
    id: `q-${topic}`,
    dedupeKey: `status:${c.id}:${topic}`,
    kind: "status",
    topic: topic as OutboundMessage["topic"],
    step: null,
    channel: null,
    template: topic === "payment_receipt" ? "credalti_recibo" : "credalti_reporte_nuevo",
    params: ["Rosa", "https://app.test/caso"],
    locale: "en",
    body: "Hi Rosa, an update. https://app.test/caso",
    link: null,
    status: "queued",
    queuedAt: at,
    sentAt: null,
  };
}

describe("notification settings → the autopilot", () => {
  it("required notices, progress updates and reminders are three groups", () => {
    expect(messageCategory("followup", "agreement_unsigned")).toBe("reminders");
    expect(messageCategory("status", "payment_receipt")).toBe("required");
    expect(messageCategory("status", "letters_mailed")).toBe("required");
    expect(messageCategory("status", "payment_declined")).toBe("required");
    expect(messageCategory("status", "report_changes")).toBe("updates");
    expect(messageCategory("status", "review_request")).toBe("updates");
    // Required notices go whatever the client turned off.
    const off = settings({ reminders: false, updates: false });
    expect(settingsAllow(off, "status", "payment_receipt")).toBe(true);
    expect(settingsAllow(off, "status", "report_changes")).toBe(false);
    expect(settingsAllow(off, "followup", "documents_missing")).toBe(false);
  });

  it("at least one channel stays on", () => {
    expect(settingsProblem({ whatsapp: false, email: false })).toBe("no_channel");
    expect(settingsProblem({ whatsapp: false, email: true })).toBeNull();
  });

  it("the channel follows the client's choice: email only, WhatsApp only, never SMS", () => {
    expect(channelsFor(settings({ whatsapp: false }), ON.channels)).toMatchObject({ whatsapp: false, email: true });
    // The team's own switches still win: the client cannot turn on a channel the team has not set up.
    expect(channelsFor(settings({}), { ...ON.channels, email: false })).toMatchObject({ whatsapp: true, email: false });
    const emailOnly = client({ notificationSettings: settings({ whatsapp: false }), agreementSignedAt: null, signedUpAt: ago(4) });
    const due = dueFollowups(emailOnly, NOW, ON);
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((m) => m.choice.channel === "email")).toBe(true);
    const whatsappOnly = client({ notificationSettings: settings({ email: false }), agreementSignedAt: null, signedUpAt: ago(4) });
    expect(dueFollowups(whatsappOnly, NOW, ON).every((m) => m.choice.channel === "whatsapp")).toBe(true);
    // WhatsApp only, and no approved template outside 24 hours: nothing goes; the item is a person's.
    const blocked = client({ notificationSettings: settings({ email: false }), agreementSignedAt: null, signedUpAt: ago(4) });
    const states = followupStates(blocked, NOW, { ...ON, channels: { ...ON.channels, approvedTemplates: [] } });
    expect(states[0]!.block).toBe("template_not_approved");
  });

  it("reminders off: no follow-up goes, the situation is a person's (like an opt-out)", () => {
    const c = client({ notificationSettings: settings({ reminders: false }), agreementSignedAt: null, signedUpAt: ago(4) });
    expect(dueFollowups(c, NOW, ON)).toEqual([]);
    expect(followupStates(c, NOW, ON)[0]!.block).toBe("reminders_off");
  });

  it("updates off: a queued progress update is closed unsent, a receipt still goes", () => {
    const c = client({ notificationSettings: settings({ updates: false }) });
    c.outbound = [queued(c, "report_changes"), queued(c, "payment_receipt")];
    const plan = planDeliveries(c, NOW, ON);
    expect(plan.cancel).toEqual([{ id: "q-report_changes", note: "client_settings" }]);
    expect(plan.send.filter((m) => m.kind === "status").map((m) => m.topic)).toEqual(["payment_receipt"]);
  });

  it("an opt-out (STOP, or «Stop all» on the screen) still wins over every setting", () => {
    const c = client({ notificationSettings: settings({}), optOut: { at: ago(1), keyword: "STOP", channel: "app" } });
    c.outbound = [queued(c, "payment_receipt")];
    const plan = planDeliveries(c, NOW, ON);
    expect(plan.send).toEqual([]);
    expect(plan.cancel).toEqual([{ id: "q-payment_receipt", note: "opted_out" }]);
  });

  it("the client's screen copy exists in both languages with the same keys, and never says free or promises", () => {
    expect(Object.keys(NOTIFICATION_COPY.en).sort()).toEqual(Object.keys(NOTIFICATION_COPY.es).sort());
    for (const lang of ["en", "es"] as const) {
      for (const value of Object.values(NOTIFICATION_COPY[lang])) {
        const text = typeof value === "function" ? value("Nov 3") : value;
        expect(text).not.toMatch(/\bfree\b|gratis/i);
        expect(checkClaimGuardrails(text), text).toEqual([]);
      }
    }
    expect(NOTIFICATION_COPY.en.neverSms).toMatch(/never send text messages/);
  });
});

describe("monitoring tracking and its reminder", () => {
  const check = (days: number, c: Partial<MonitoringCheck> = {}): MonitoringCheck => ({
    id: `mc-${days}`,
    provider: "identityiq",
    providerName: null,
    enrolledViaLink: "yes",
    status: "active",
    checkedOn: dayAgo(days),
    method: "client_said",
    note: "",
    by: "Marta",
    at: ago(days),
    ...c,
  });
  const mailedRound = (mailedDaysAgo: number): StaffRound => ({ number: 1, status: "mailed", mailedAt: ago(mailedDaysAgo), respondedAt: null, letters: [] });

  it("a report newer than the last check proves the monitoring was working", () => {
    const c = client({ monitoringChecks: [check(30, { status: "cancelled" })] });
    const s = monitoringSummary(c, NOW);
    expect(s.standing).toBe("active");
    expect(s.provenByReport).toBe(true);
    expect(s.looksInactive).toBe(false);
  });

  it("no check and no report: not checked; unknown never messages the client", () => {
    expect(monitoringSummary(client({ report: null }), NOW).standing).toBe("not_checked");
    const unknown = client({ report: parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(40) }), monitoringChecks: [check(2, { status: "unknown" })] });
    expect(monitoringSummary(unknown, NOW).looksInactive).toBe(false);
    expect(earlyMonitoringReminder(unknown, NOW)).toBeNull();
  });

  it("cancelled and a report due within 7 days: the reminder starts early, with its own first message", () => {
    // Round mailed 34 days ago: its re-pull is a few days away.
    const c = client({ report: parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(40) }), rounds: [mailedRound(34)], monitoringChecks: [check(1, { status: "cancelled" })] });
    const early = earlyMonitoringReminder(c, NOW);
    expect(early).not.toBeNull();
    expect(new Date(early!.dueAt).getTime() - new Date(early!.startAt).getTime()).toBeLessThanOrEqual(REMINDER_LEAD_DAYS * DAY);
    const situations = openSituations(c, NOW).filter((s) => s.kind === "monitoring_inactive");
    expect(situations).toHaveLength(1);
    expect(situations[0]!.key).toBe("monitoring_inactive:r1");
    const due = dueFollowups(c, NOW, ON).filter((m) => m.topic === "monitoring_inactive");
    expect(due).toHaveLength(1);
    expect(due[0]!.template.name).toBe("credalti_monitoreo_previo");
    expect(due[0]!.body).toMatch(/needed around/);
    // Same channels and rules as every reminder: reminders off, nothing goes.
    expect(dueFollowups({ ...c, notificationSettings: settings({ reminders: false }) }, NOW, ON)).toEqual([]);
  });

  it("cancelled but the report is weeks away: nothing yet", () => {
    const c = client({ report: parseReport({ ...DEMO_RAW_REPORT, pulledAt: ago(5) }), rounds: [mailedRound(3)], monitoringChecks: [check(1, { status: "cancelled" })] });
    expect(earlyMonitoringReminder(c, NOW)).toBeNull();
    expect(openSituations(c, NOW).some((s) => s.kind === "monitoring_inactive")).toBe(false);
  });

  it("the early message passes the claim rules in both languages", () => {
    const t = ALL_TEMPLATES.find((x) => x.name === "credalti_monitoreo_previo")!;
    for (const lang of ["en", "es"] as const) {
      const body = renderTemplate(t, lang, ["Rosa", "December 12", "https://app.test/x"]);
      expect(checkClaimGuardrails(body), body).toEqual([]);
    }
  });
});

describe("monitoring commissions: reconciliation per client and month", () => {
  const checks = (link: "yes" | "no", status: "active" | "cancelled" = "active"): MonitoringCheck[] => [
    { id: "x", provider: "identityiq", providerName: null, enrolledViaLink: link, status, checkedOn: "2026-10-20", method: "provider_portal", note: "", by: "C", at: "2026-10-20T15:00:00.000Z" },
  ];
  const clients = [
    { id: "a", name: "Ana Uno", email: "ana@x.com", checks: checks("yes") },
    { id: "b", name: "Beto Dos", email: null, checks: checks("yes") },
    { id: "c", name: "Cira Tres", email: null, checks: checks("no") },
    { id: "d", name: "Dora Cuatro", email: null, checks: checks("yes", "cancelled") },
  ];
  const line = (id: string, clientId: string | null, cents: number, extra: Partial<CommissionLine> = {}): CommissionLine => ({
    id,
    clientId,
    provider: "IdentityIQ",
    month: "2026-11",
    amountCents: cents,
    kind: cents < 0 ? "reversal" : "commission",
    memberRef: "",
    paidOn: "2026-12-02",
    source: "manual",
    note: "",
    postedIncomeId: null,
    voidedAt: null,
    voidReason: null,
    by: "C",
    at: "2026-12-02T15:00:00.000Z",
    ...extra,
  });

  it("paid, missing, not expected, reversed, unmatched; voided lines do not count", () => {
    const rec = reconcileMonth(
      "2026-11",
      [line("1", "a", 4000), line("2", "c", 4000), line("3", "a", -4000, { month: "2026-10" }), line("4", null, 4000, { memberRef: "Someone" }), line("5", "b", 4000, { voidedAt: "2026-12-03", voidReason: "typed twice" })],
      clients,
    );
    const by = Object.fromEntries(rec.rows.map((r) => [r.clientId, r.status]));
    expect(by).toEqual({ a: "paid", b: "missing", c: "not_expected" });
    expect(rec.unmatched.map((l) => l.id)).toEqual(["4"]);
    expect(rec.totalCents).toBe(12000);
    expect(rec.unpostedCents).toBe(12000);
    // A month that nets to zero for a client is "reversed".
    const oct = reconcileMonth("2026-10", [line("6", "a", 4000, { month: "2026-10" }), line("7", "a", -4000, { month: "2026-10" })], clients);
    expect(oct.rows.find((r) => r.clientId === "a")!.status).toBe("reversed");
    // Cancelled monitoring is not expected to pay.
    expect(expectedInMonth(clients[3]!.checks, "2026-11")).toBe(false);
  });

  it("posting is one explicit step: the day paid, never twice, never a negative month, warns about Accounting's own entries", () => {
    const rec = reconcileMonth("2026-11", [line("1", "a", 4000), line("2", "b", 4000, { postedIncomeId: "inc-1" })], clients);
    expect(postingPlan(rec, { receivedOn: null, existingMonitoringIncomeCents: 0, confirmNotDuplicate: false })).toEqual({ ok: false, problem: "needs_paid_day" });
    expect(postingPlan(rec, { receivedOn: "2026-12-02", existingMonitoringIncomeCents: 4000, confirmNotDuplicate: false })).toEqual({ ok: false, problem: "existing_income" });
    expect(postingPlan(rec, { receivedOn: "2026-12-02", existingMonitoringIncomeCents: 4000, confirmNotDuplicate: true })).toEqual({ ok: true, amountCents: 4000, receivedOn: "2026-12-02", lineIds: ["1"] });
    const negative = reconcileMonth("2026-11", [line("9", "a", -4000)], clients);
    expect(postingPlan(negative, { receivedOn: "2026-12-02", existingMonitoringIncomeCents: 0, confirmNotDuplicate: false })).toEqual({ ok: false, problem: "not_positive" });
    const done = reconcileMonth("2026-11", [line("2", "b", 4000, { postedIncomeId: "inc-1" })], clients);
    expect(postingPlan(done, { receivedOn: "2026-12-02", existingMonitoringIncomeCents: 0, confirmNotDuplicate: false })).toEqual({ ok: false, problem: "nothing_to_post" });
    expect(incomeSource("IdentityIQ", "2026-11", 1)).toBe("IdentityIQ commissions 2026-11 (1 line)");
  });

  it("reads a statement CSV, never keeping an SSN-like member id; suggests the client by email or name", () => {
    const rows = [
      ["Member Name", "Email", "Period", "Commission", "Paid Date"],
      ["Ana Uno", "ana@x.com", "11/2026", "$40.00", "12/02/2026"],
      ["123-45-6789 Beto", "", "Nov 2026", "(40.00)", ""],
      ["Nadie", "", "", "40", ""],
    ];
    const mapping = detectStatementMapping(rows[0]!);
    expect(mapping).toEqual({ member: 0, email: 1, month: 2, amount: 3, paidOn: 4 });
    const lines = readStatement(rows, mapping);
    expect(lines[0]).toMatchObject({ month: "2026-11", amountCents: 4000, paidOn: "2026-12-02", problem: null });
    expect(lines[1]!.memberRef).toBe("Beto");
    expect(lines[1]!.amountCents).toBe(-4000);
    expect(lines[2]!.problem).toBe("no_month");
    expect(suggestClient(lines[0]!, clients)?.id).toBe("a");
    expect(suggestClient({ memberRef: "beto dos" }, clients)?.id).toBe("b");
    expect(toMonth("2026-11-30")).toBe("2026-11");
  });

  it("only an administrator records commissions; never shown to clients (no client-side read)", () => {
    expect(can("admin", "monitoring.commissions")).toBe(true);
    expect(can("specialist", "monitoring.commissions")).toBe(false);
    expect(can("sales", "monitoring.commissions")).toBe(false);
    const clientApp = ["src/app/(app)/mas/page.tsx", "src/app/(app)/mas/avisos/page.tsx", "src/app/(app)/documentos/page.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(clientApp).not.toMatch(/monitoring_commissions|commissions/);
  });
});

describe("documents: review, the power of attorney flag, no SSN card", () => {
  const review = (r: Partial<DocumentReview>): DocumentReview => ({
    id: "r1",
    kind: "proof_of_address",
    fileId: null,
    documentUploadedAt: ago(5),
    decision: "rejected",
    reasonCode: "too_old",
    note: "",
    askAgain: true,
    by: "Marta",
    at: ago(4),
    ...r,
  });

  it("a rejected required document counts as missing, holds the round, and a newer upload clears it", () => {
    const base = client({ documentUploadedAt: { government_id: ago(5), proof_of_address: ago(5) } });
    expect(missingDocuments(base)).toEqual([]);
    const rejected = { ...base, documentReviews: [review({})] };
    expect(documentRejected(rejected, "proof_of_address")).toBe(true);
    expect(missingDocuments(rejected)).toEqual(["proof_of_address"]);
    expect(clientStage(rejected, NOW)).toBe("documents_pending");
    expect(sendableRound(rejected, NOW)).toBeNull();
    // The client uploads a new one: the old review is out of date.
    const again = { ...rejected, documentUploadedAt: { ...rejected.documentUploadedAt, proof_of_address: ago(1) } };
    expect(reviewState(again, "proof_of_address")).toBe("not_reviewed");
    expect(missingDocuments(again)).toEqual([]);
    // Accepted after a rejection: the newest review wins.
    const accepted = { ...rejected, documentReviews: [review({}), review({ id: "r2", decision: "accepted", reasonCode: null, askAgain: false, at: ago(2) })] };
    expect(currentReview(accepted, "proof_of_address")?.id).toBe("r2");
    expect(missingDocuments(accepted)).toEqual([]);
  });

  it("a rejection restarts the documents reminder from the review", () => {
    const c = client({ agreementSignedAt: ago(28), documentUploadedAt: { government_id: ago(5), proof_of_address: ago(5) }, documentReviews: [review({ at: ago(1) })] });
    const s = openSituations(c, NOW).find((x) => x.kind === "documents_missing");
    expect(s?.startedAt).toBe(ago(1));
  });

  it("the client reads the reason in their language", () => {
    expect(clientReviewLine(review({}), "en")).toBe("It is more than 90 days old. A more recent one is needed. Please upload a new one.");
    expect(clientReviewLine(review({}), "es")).toMatch(/^Tiene más de 90 días/);
    expect(clientReviewLine(review({ decision: "accepted", reasonCode: null }), "en")).toMatch(/accepted/);
  });

  it("the power of attorney slot stays off until the attorney approves this exact version", () => {
    expect(powerOfAttorneyEnabled({})).toBe(false);
    expect(uploadableExtraKinds({})).not.toContain("power_of_attorney");
    expect(powerOfAttorneyEnabled({ NEXT_PUBLIC_POA_APPROVED_VERSION: "something-else" })).toBe(false);
    expect(uploadableExtraKinds({ NEXT_PUBLIC_POA_APPROVED_VERSION: POA_VERSION })).toContain("power_of_attorney");
  });

  it("no screen asks for a Social Security card, and the database refuses one", () => {
    const sql = readFileSync("supabase/migrations/0041_fulfillment.sql", "utf8");
    expect(sql).toMatch(/new\.kind = 'ssn_card'[\s\S]*raise exception/);
    expect(readFileSync("src/components/IdentityDocs.tsx", "utf8")).not.toMatch(/"ssn_card"/);
    expect(readFileSync("src/app/(app)/documentos/page.tsx", "utf8")).not.toMatch(/kind: "ssn_card"|value="ssn_card"/);
  });

  it("only administrators and specialists review documents", () => {
    expect(can("admin", "documents.review")).toBe(true);
    expect(can("specialist", "documents.review")).toBe(true);
    expect(can("sales", "documents.review")).toBe(false);
  });
});

describe("importing from Credit Repair Cloud", () => {
  const header = ["First Name", "Last Name", "Email", "Phone (Mobile)", "Phone (Home)", "Street Address", "City", "State", "Zip Code", "SSN", "Date of Birth", "Status", "Assigned To", "Referred By", "Date Added", "Notes"];
  const row = (first: string, last: string, email: string, phone: string, state: string, status: string, extra: Partial<Record<string, string>> = {}) => [
    first, last, email, phone, "", "1 Main St", "Houston", state, "77001", extra.ssn ?? "123-45-6789", extra.dob ?? "01/02/1980", status, extra.assigned ?? "Ana Prieto", "", "03/01/2026", extra.notes ?? "",
  ];

  it("finds CRC's columns by name, and never maps the SSN or birth date", () => {
    expect(sensitiveColumns(header)).toEqual([9, 10]);
    const mapping = detectMapping(header, "clients");
    expect(mapping).toMatchObject({ firstName: 0, lastName: 1, email: 2, phone: 3, altPhone: 4, city: 6, state: 7, status: 11, assignedTo: 12, referredBy: 13, added: 14 });
    expect(Object.values(mapping)).not.toContain(9);
    expect(Object.values(mapping)).not.toContain(10);
    expect(sensitiveColumns(["Social Security #", "DOB", "Birthdate", "ITIN", "Fecha de nacimiento", "Name"])).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops SSN and DOB even when someone maps them by hand, and blanks an SSN typed in another column", () => {
    const rows = [header, row("Mariana", "Robles", "m@x.com", "(713) 555-0101", "TX", "Client", { notes: "ssn 123-45-6789" })];
    const forced = { ...detectMapping(header, "clients"), city: 9, referredBy: 15 };
    const plan = planImport(rows, forced, "clients", existingFrom({ prospects: [], clients: [] }));
    expect(plan[0]!.city).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/123-45-6789|1980/);
    expect(plan[0]!.reasons).toContain("ssn_value_dropped");
    expect(plan[0]!.outcome).toBe("create");
  });

  it("dedupes by phone or email against the file and what is already here", () => {
    const rows = [
      header,
      row("Mariana", "Robles", "m@x.com", "713-555-0101", "TX", "Client"),
      row("Mariana", "Robles", "other@x.com", "+1 713 555 0101", "TX", "Client"),
      row("Rosa", "Uno", "rosa@x.com", "713-555-0102", "TX", "Lead"),
      row("Beto", "Dos", "beto@x.com", "713-555-0103", "TX", "Client"),
    ];
    const existing = existingFrom({ prospects: [{ phone: "+17135550102", email: null }], clients: [{ phone: null, email: "BETO@x.com" }] });
    const plan = planImport(rows, detectMapping(header, "clients"), "clients", existing);
    expect(plan.map((r) => [r.outcome, r.reasons[0] ?? null])).toEqual([
      ["create", null],
      ["duplicate", "duplicate_in_file"],
      ["duplicate", "duplicate_prospect"],
      ["duplicate", "duplicate_client"],
    ]);
    expect(summarize(plan)).toMatchObject({ rows: 4, create: 1, duplicate: 3, clients: 1 });
  });

  it("only Texas; Georgia never; inactive skipped unless asked; problems explained", () => {
    const rows = [
      header,
      row("Ana", "Tx", "a@x.com", "713-555-0111", "Texas", "Active Client"),
      row("Gina", "Ga", "g@x.com", "404-555-0112", "GA", "Client"),
      row("Flor", "Fl", "f@x.com", "305-555-0113", "FL", "Lead"),
      row("Ivan", "In", "i@x.com", "713-555-0114", "TX", "Inactive"),
      row("Nadie", "", "n@x.com", "713-555-0115", "TX", "Lead"),
      row("Pepe", "Ph", "p@x.com", "12345", "TX", "Lead"),
    ];
    const mapping = detectMapping(header, "clients");
    const plan = planImport(rows, mapping, "clients", existingFrom({ prospects: [], clients: [] }));
    expect(plan.map((r) => [r.outcome, r.reasons[0]])).toEqual([
      ["create", undefined],
      ["problem", "state_never"],
      ["problem", "state_closed"],
      ["skip", "inactive"],
      ["problem", "no_name"],
      ["problem", "bad_phone"],
    ]);
    const withInactive = planImport(rows, mapping, "clients", existingFrom({ prospects: [], clients: [] }), { includeInactive: true });
    expect(withInactive[3]!.outcome).toBe("create");
    expect(plan[0]).toMatchObject({ phoneE164: "+17135550111", state: "TX", status: "client" });
    expect(shortName(plan[0]!)).toBe("Ana T.");
  });

  it("reads CRC's status words, US phones and state names", () => {
    expect(crcStatus("Client", "clients")).toBe("client");
    expect(crcStatus("Lead/Inactive", "leads")).toBe("inactive");
    expect(crcStatus("Prospect", "leads")).toBe("lead");
    expect(crcStatus("", "leads")).toBe("lead");
    expect(toUsE164("1-713-555-0101")).toBe("+17135550101");
    expect(toUsE164("555-0101")).toBeNull();
    expect(toState("texas")).toBe("TX");
    expect(matchSalesperson("Ana Prieto", [{ handle: "ana", name: "Ana Prieto", role: "sales", active: true }], "carmen")).toBe("ana");
    expect(matchSalesperson("Somebody", [{ handle: "ana", name: "Ana Prieto", role: "sales", active: true }], "carmen")).toBe("carmen");
  });

  it("affiliates: a name and a phone or email; no state rule (they apply as partners themselves)", () => {
    const aff = [["Name", "Company", "Email", "Phone"], ["Laura Benitez", "Casa Realty", "laura@x.com", ""], ["Sin Contacto", "", "", ""]];
    const mapping = detectMapping(aff[0]!, "affiliates");
    expect(mapping).toMatchObject({ fullName: 0, company: 1, email: 2, phone: 3 });
    const plan = planImport(aff, mapping, "affiliates", existingFrom({ prospects: [], clients: [], partners: [] }));
    expect(plan.map((r) => r.outcome)).toEqual(["create", "problem"]);
  });

  it("only an administrator imports", () => {
    expect(can("admin", "clients.import")).toBe(true);
    expect(can("specialist", "clients.import")).toBe(false);
    expect(can("sales", "clients.import")).toBe(false);
    expect(CAPABILITIES).toEqual(expect.arrayContaining(["clients.import", "documents.review", "monitoring.commissions"]));
  });
});

describe("graduation in the console", () => {
  it("a graduate is not a pending end-of-service request: no notice, nothing to confirm", () => {
    const demo = buildDemoClients(NOW).find((c) => c.id === "c37")!;
    expect(clientStage(demo, NOW)).toBe("graduated");
    expect(nextStep(demo, NOW, "en")).toMatchObject({ actor: "client" });
    expect(nextStep(demo, NOW, "en").text).toMatch(/Finished the program/);
  });
});
