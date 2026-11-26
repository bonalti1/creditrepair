import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLIENT_REPORT, DEMO_RAW_REPORT, DEMO_REPORT, DEMO_SCORE_HISTORY } from "../demo";
import { parseReport } from "../domain/parser";
import { getMailData } from "../mail/data";
import { attestedFlagsFromRows, historyFromRows, letterKey, nextRoundNumber, planNextRound } from "../rounds/plan";
import { caseBodySchema, reportsBodySchema, roundsBodySchema } from "../staff/api";
import { createDatabaseStaffData, getStaffData, RoundsNotSentError } from "../staff/data";
import { clientsFromRows, EMPTY_STAFF_ROWS, letterCategory, plannedLetterId, plannedLetterKey, splitName, type StaffRows } from "../staff/fromRows";
import { getTeamData } from "../staff/teamData";
import { clientStage, sendableRound } from "../staff/stage";
import { isDemoMode, isSupabaseConfigured } from "../supabase/config";
import { roundSnapshot } from "../ux/flagsStore";
import { sessionJourneyState } from "../ux/journey";
import { reportView, withReport } from "../ux/reportStore";

// The database version of the staff console and of the client app, without a
// database: the row mapping (staff/fromRows.ts), the round planning shared by
// the console and the send (rounds/plan.ts), the route schemas, the browser
// data layers' calls, and the one demo rule. The same code against the real
// migrations is in src/lib/__tests__/db/.

const NOW = new Date("2026-12-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const C = "00000000-0000-4000-8000-0000000000c1";
const STAFF = "00000000-0000-4000-8000-0000000000s1".replace("s", "a");

type Row = Record<string, unknown>;

/** One client's rows: account, signed agreement, documents, report and answers. */
function baseRows(over: Partial<StaffRows> = {}): StaffRows {
  const raw = { ...structuredClone(DEMO_RAW_REPORT), pulledAt: ago(3) };
  const report = parseReport(raw);
  const items: Row[] = report.items.map((item, i) => ({
    id: `item-${i}`,
    user_id: C,
    fingerprint: item.fingerprint,
    bureau: item.bureau,
    category: item.category,
    name: item.name,
    furnisher: item.furnisher ?? null,
    data: item.data,
    negative: item.negative,
    status: "active",
  }));
  const flags: Row[] = items.map((item, i) => {
    const attest = item.category === "personal_info";
    return {
      id: `flag-${i}`,
      user_id: C,
      item_id: item.id,
      state: attest ? "attested" : "correct",
      attested: attest,
      attested_at: attest ? ago(2) : null,
      attestation_text: attest ? "I believe this item is inaccurate." : null,
      reason: attest ? "No es mía." : "",
      reason_code: attest ? "wrong_personal_info" : null,
      created_at: ago(2),
    };
  });
  return {
    ...EMPTY_STAFF_ROWS,
    profiles: [{ id: C, full_name: "Rosa María Martínez", phone_e164: "+17135550142", state: "TX", referred_by: "ana", address_lines: ["123 Main St", "Houston, TX 77002"], goal: "mortgage", created_at: ago(20) }],
    staffMembers: [{ user_id: STAFF, handle: "marta", display_name: "Marta Leal", role: "specialist", active: true }],
    agreements: [
      {
        user_id: C,
        document_version: "v1",
        disclosure_acknowledged_at: ago(15),
        signed_at: ago(14),
        cancellation_deadline: ago(10),
        terms: { monthlyFee: "89.00" },
        created_at: ago(15),
      },
    ],
    documents: [
      { user_id: C, kind: "government_id", uploaded_at: ago(13) },
      { user_id: C, kind: "proof_of_address", uploaded_at: ago(13) },
    ],
    pulls: [{ id: "pull-1", user_id: C, pulled_at: raw.pulledAt, created_at: ago(3), imported_by_name: "marta", reader_key: "credalti_json", import_summary: { itemCount: report.items.length, removed: 0, added: 0, changed: 0, closedRound: null } }],
    newestRaw: { "pull-1": raw },
    items,
    flags,
    assignments: [{ user_id: C, staff_user_id: STAFF }],
    ...over,
  };
}

describe("staff/fromRows: database rows → StaffClient", () => {
  it("splits a full name and names a letter's category", () => {
    expect(splitName("Rosa María  Martínez")).toEqual({ firstName: "Rosa", lastName: "María Martínez" });
    expect(splitName("Rosa")).toEqual({ firstName: "Rosa", lastName: "" });
    expect(letterCategory("personal_info_cleanup", [])).toBe("personal_info");
    expect(letterCategory("dispute_611_inquiries", [])).toBe("inquiry");
    expect(letterCategory("secondary_bureau_request", [])).toBe("tradeline");
  });

  it("maps who the client is, the agreement, documents, report, answers and assignment", () => {
    const [client] = clientsFromRows(baseRows());
    expect(client).toMatchObject({
      id: C,
      firstName: "Rosa",
      lastName: "María Martínez",
      phone: "+17135550142",
      state: "TX",
      salesperson: "ana",
      goal: "mortgage",
      agreementSignedAt: ago(14),
      cancellationDeadline: ago(10),
      agreementMonthlyFee: "89.00",
      documents: ["government_id", "proof_of_address"],
      assignedTo: "marta",
    });
    expect(client!.report?.items.length).toBe(DEMO_REPORT.items.length);
    const answers = Object.values(client!.answers);
    expect(answers.filter((a) => a.status === "inaccurate").length).toBe(DEMO_REPORT.items.filter((i) => i.category === "personal_info").length);
    expect(answers.find((a) => a.status === "inaccurate")).toMatchObject({ reasonCode: "wrong_personal_info", reason: "No es mía." });
    expect(client!.reportImports).toEqual([expect.objectContaining({ by: "marta", readerKey: "credalti_json", closedRound: null })]);
  });

  it("an answer counts only with its attestation on record; 'flagged' stays pending", () => {
    const rows = baseRows();
    rows.flags = rows.flags.map((f, i) => (i === 0 ? { ...f, state: "flagged", attested: false, attested_at: null } : f));
    const [client] = clientsFromRows(rows);
    expect(client!.answers[String(rows.items[0]!.fingerprint)]).toBeUndefined();
  });

  it("prepares round 1 from the client's confirmed answers once the review is finished, as the engine writes it", () => {
    const [client] = clientsFromRows(baseRows());
    expect(client!.rounds).toHaveLength(1);
    const round = client!.rounds[0]!;
    expect(round).toMatchObject({ number: 1, status: "ready", mailedAt: null });
    expect(round.letters.every((l) => l.templateKey === "personal_info_cleanup" && l.mailStatus === "not_sent")).toBe(true);
    expect(round.letters.every((l) => l.items.every((i) => client!.answers[i.fingerprint]?.status === "inaccurate"))).toBe(true);
    const id = round.letters[0]!.id;
    expect(plannedLetterKey(id, C, 1)).toBe(letterKey("bureau", round.letters[0]!.recipient.key, "personal_info_cleanup"));
    expect(plannedLetterKey(id, C, 2)).toBeNull();
    expect(plannedLetterKey(id, "other", 1)).toBeNull();
    expect(clientStage(client!, NOW)).toBe("ready_to_send");
    expect(sendableRound(client!, NOW, { furnishers: [] })?.number).toBe(1);
  });

  it("no round while the client still has items to review", () => {
    const rows = baseRows();
    rows.flags = rows.flags.slice(0, -1);
    const [client] = clientsFromRows(rows);
    expect(client!.rounds).toEqual([]);
    expect(clientStage(client!, NOW)).toBe("client_review_pending");
  });

  it("a mailed round: its letters, items, mail record and tracking; no next round until it is answered", () => {
    const rows = baseRows();
    const item = rows.items.find((i) => i.category === "personal_info")!;
    rows.rounds = [{ id: "r1", user_id: C, round_number: 1, status: "mailed", mailed_at: ago(1), sent_by: STAFF, results: [] }];
    rows.letters = [
      {
        id: "l1",
        user_id: C,
        round_id: "r1",
        target_type: "bureau",
        target_key: String(item.bureau),
        target_name: "Equifax",
        target_address_lines: ["P.O. Box 740256", "Atlanta, GA 30374"],
        template_key: "personal_info_cleanup",
        escalation_stage: "personal_info_cleanup",
        status: "queued",
        lob_id: "ltr_1",
        mailed_at: ago(1),
        created_at: ago(1),
        mail_class: "certified",
        mail_provider: "lob",
        mail_status: "delivered",
        tracking_number: "9407111899223197428490",
        delivered_at: ago(0.5),
      },
    ];
    rows.letterItems = [{ letter_id: "l1", item_id: item.id, escalation_stage: "personal_info_cleanup" }];
    rows.mailEvents = [{ id: "e1", provider_event_id: "evt_1", letter_id: "l1", user_id: C, kind: "delivered", mail_status: "delivered", occurred_at: ago(0.5) }];
    const [client] = clientsFromRows(rows);
    expect(client!.rounds).toHaveLength(1);
    const round = client!.rounds[0]!;
    expect(round).toMatchObject({ number: 1, status: "mailed", mailedAt: ago(1), sentBy: "marta" });
    const letter = round.letters[0]!;
    expect(letter).toMatchObject({ id: "l1", mailStatus: "delivered", mailClass: "certified", category: "personal_info" });
    expect(letter.items.map((i) => i.fingerprint)).toEqual([item.fingerprint]);
    expect(letter.itemReasons).toEqual({ [String(item.fingerprint)]: "wrong_personal_info" });
    expect(letter.mail).toMatchObject({ provider: "lob", trackingNumber: "9407111899223197428490", events: [expect.objectContaining({ id: "evt_1", kind: "delivered" })] });
    expect(clientStage(client!, NOW)).toBe("waiting_on_bureaus");
  });

  it("an answered round shows as responded with its results, and the next round is prepared", () => {
    const rows = baseRows();
    rows.rounds = [{ id: "r1", user_id: C, round_number: 1, status: "complete", mailed_at: ago(40), responded_at: ago(3), results: [{ fingerprint: "fp-x", outcome: "removed", reportDate: ago(3) }, { bogus: true }] }];
    const [client] = clientsFromRows(rows);
    expect(client!.rounds.map((r) => [r.number, r.status])).toEqual([
      [1, "responded"],
      [2, "ready"],
    ]);
    expect(client!.rounds[0]!.results).toEqual([{ fingerprint: "fp-x", outcome: "removed", reportDate: ago(3) }]);
    expect(client!.rounds[0]!.respondedAt).toBe(ago(3));
  });

  it("billing: the method in use, charges oldest first with their refund, and an open pause", () => {
    const rows = baseRows({
      paymentMethods: [
        { user_id: C, brand: "visa", last4: "0002", created_at: ago(30), removed_at: ago(20), authorization_version: "v", authorized_at: ago(30) },
        { user_id: C, brand: "visa", last4: "4242", created_at: ago(20), removed_at: null, authorization_version: "v", authorized_at: ago(20) },
      ],
      charges: [
        { id: "ch2", user_id: C, round_number: 2, amount_cents: 8900, status: "pending", work_date: ago(2), created_at: ago(1) },
        { id: "ch1", user_id: C, round_number: 1, amount_cents: 8900, status: "refunded", work_date: ago(40), created_at: ago(39), charged_at: ago(39), gateway_reference: "x" },
      ],
      refunds: [{ id: "re1", charge_id: "ch1", user_id: C, amount_cents: 8900, reason: "Error del equipo", requested_by_name: "carmen", created_at: ago(5), completed_at: ago(5) }],
      pauses: [{ user_id: C, reason: "Reclamo abierto", paused_by_name: "carmen", created_at: ago(4), lifted_at: null }],
    });
    const [client] = clientsFromRows(rows);
    expect(client!.billing.paymentMethod?.last4).toBe("4242");
    expect(client!.billing.charges.map((c) => c.id)).toEqual(["ch1", "ch2"]);
    expect(client!.billing.charges[0]!.refund).toMatchObject({ by: "carmen", amountCents: 8900 });
    expect(client!.billing.pause).toMatchObject({ by: "carmen", reason: "Reclamo abierto" });
  });

  it("the team's records: notes in order, the latest handled mark per notice, the conversation, samples, questions", () => {
    const rows = baseRows({
      notes: [
        { id: "n2", user_id: C, author_name: "marta", body: "Segunda", created_at: ago(1) },
        { id: "n1", user_id: C, author_name: "ana", body: "Primera", created_at: ago(2) },
      ],
      marks: [
        { user_id: C, exception_key: "documents_missing", handled_at: ago(5) },
        { user_id: C, exception_key: "documents_missing", handled_at: ago(1) },
      ],
      chat: [
        { id: "m2", user_id: C, channel: "app", role: "assistant", source: "human", author_name: "Marta", body: "Hola", created_at: ago(1) },
        { id: "m1", user_id: C, channel: "app", role: "user", source: "journey", author_name: "nope", body: "¿Cuándo?", created_at: ago(2) },
        { id: "w1", user_id: C, channel: "whatsapp", role: "user", source: "journey", body: "wa", created_at: ago(2) },
      ],
      events: [{ id: "q1", user_id: C, kind: "question_escalated", payload: { text: "¿Pueden llamarme?" }, created_at: ago(3) }],
      samples: [{ id: "s1", user_id: C, provider: "identityiq", body: "<html/>", saved_by_name: "marta", saved_at: ago(2), file_name: null }],
    });
    const [client] = clientsFromRows(rows);
    expect(client!.notes.map((n) => n.text)).toEqual(["Primera", "Segunda"]);
    expect(client!.handled).toEqual({ documents_missing: ago(1) });
    expect(client!.conversation?.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(client!.conversation?.[0]).not.toHaveProperty("authorName");
    expect(client!.conversation?.[1]).toMatchObject({ source: "human", authorName: "Marta" });
    expect(client!.questions).toEqual([{ id: "q1", askedAt: ago(3), text: "¿Pueden llamarme?", answeredAt: ago(1) }]);
    expect(client!.reportSamples).toEqual([{ id: "s1", provider: "identityiq", savedAt: ago(2), savedBy: "marta", fileName: null, text: "<html/>" }]);
  });

  it("members of staff are never listed as clients; a prospect is a lead until an account has its phone", () => {
    const rows = baseRows({
      profiles: [...baseRows().profiles, { id: STAFF, full_name: "Marta Leal", created_at: ago(30) }],
      prospects: [
        { id: "p1", first_name: "Norma", last_name: "Ybarra", phone_e164: "+19035550135", state: "TX", goal: "auto", salesperson: "ana", created_by: STAFF, created_at: ago(4), assigned_to: STAFF },
        { id: "p2", first_name: "Rosa", last_name: "M", phone_e164: "+17135550142", state: "TX", goal: "card", salesperson: "ana", created_by: STAFF, created_at: ago(25), email: "rosa@x.com" },
      ],
    });
    const clients = clientsFromRows(rows);
    expect(clients.map((c) => c.id)).toEqual([C, "p1"]);
    const lead = clients[1]!;
    expect(lead).toMatchObject({ firstName: "Norma", signedUpAt: null, assignedTo: "marta", addedBy: "marta" });
    expect(clientStage(lead, NOW)).toBe("lead");
    // The client whose phone matched p2 keeps the first contact date and the email sales wrote down.
    expect(clients[0]).toMatchObject({ createdAt: ago(25), email: "rosa@x.com", addedBy: "marta" });
  });

  it("a report that no longer reads is not shown as a report", () => {
    const [client] = clientsFromRows(baseRows({ newestRaw: { "pull-1": { nonsense: true } } }));
    expect(client!.report).toBeNull();
  });

  it("sales' rows (no case) read as an empty case, never as an error", () => {
    const rows = baseRows({ pulls: [], newestRaw: {}, items: [], flags: [], assignments: [] });
    const [client] = clientsFromRows(rows);
    expect(client).toMatchObject({ report: null, answers: {}, rounds: [], assignedTo: null });
  });
});

describe("rounds/plan: the next round, the same for the console and the send", () => {
  it("numbers the first round 1 with personal information to correct, else 2; then one after an answered round", () => {
    expect(nextRoundNumber([], true)).toBe(1);
    expect(nextRoundNumber([], false)).toBe(2);
    expect(nextRoundNumber([{ round_number: 1, status: "mailed" }], true)).toBeNull();
    expect(nextRoundNumber([{ round_number: 1, status: "complete" }], true)).toBe(2);
    expect(nextRoundNumber([{ round_number: 2, status: "complete" }, { round_number: 3, status: "draft" }], false)).toBe(3);
    // A stray draft (an old self-serve build) does not change the numbering.
    expect(nextRoundNumber([{ round_number: 1, status: "draft" }], false)).toBe(2);
  });

  it("counts an answer only with the attestation text on record", () => {
    const fp = new Map([["i1", "fp1"], ["i2", "fp2"]]);
    const { flags, itemReasons } = attestedFlagsFromRows(
      [
        { item_id: "i1", attested: true, attested_at: ago(1), attestation_text: "I believe…", reason_code: "not_mine" },
        { item_id: "i2", attested: true, attested_at: ago(1), attestation_text: null, reason_code: "not_mine" },
      ],
      fp,
    );
    expect(flags.filter((f) => f.attested).map((f) => f.fingerprint)).toEqual(["fp1"]);
    expect(itemReasons).toEqual({ fp1: "not_mine" });
  });

  it("history: the highest stage mailed per item, leaving out the round being sent and unsent letters", () => {
    const fp = new Map([["i1", "fp1"]]);
    const letters = [
      { id: "a", round_id: "r1", status: "queued" },
      { id: "b", round_id: "r2", status: "mailed" },
      { id: "c", round_id: "r3", status: "draft" },
    ];
    const links = [
      { letter_id: "a", item_id: "i1", escalation_stage: "dispute" },
      { letter_id: "b", item_id: "i1", escalation_stage: "mov" },
      { letter_id: "c", item_id: "i1", escalation_stage: "furnisher_direct" },
    ];
    expect(historyFromRows(letters, links, fp)).toEqual({ fp1: "mov" });
    expect(historyFromRows(letters, links, fp, "r2")).toEqual({ fp1: "dispute" });
  });

  it("planNextRound reuses the draft row a stopped send left", () => {
    const rows = baseRows();
    const next = planNextRound({ itemRows: rows.items, flagRows: rows.flags, roundRows: [{ id: "r1", round_number: 1, status: "draft" }], letterRows: [], letterItemRows: [] });
    expect(next).toMatchObject({ roundNumber: 1, roundId: "r1" });
    expect(next!.plan.letters.length).toBeGreaterThan(0);
  });
});

describe("the staff routes' bodies", () => {
  const id = "3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77";
  it("case: note, resolve, reply; strict; a real client id; no author from the browser", () => {
    expect(caseBodySchema.safeParse({ action: "note", clientId: id, text: "hola" }).success).toBe(true);
    expect(caseBodySchema.safeParse({ action: "note", clientId: id, text: "hola", author: "x" }).success).toBe(false);
    expect(caseBodySchema.safeParse({ action: "note", clientId: "c07", text: "hola" }).success).toBe(false);
    expect(caseBodySchema.safeParse({ action: "note", clientId: id, text: "   " }).success).toBe(false);
    expect(caseBodySchema.safeParse({ action: "resolve", clientId: id, key: "payment_past_due:3f2b" }).success).toBe(true);
    expect(caseBodySchema.safeParse({ action: "resolve", clientId: id, key: "Payment" }).success).toBe(false);
    expect(caseBodySchema.safeParse({ action: "reply", clientId: id, text: "x".repeat(4001) }).success).toBe(false);
    expect(caseBodySchema.safeParse({ action: "dispute", clientId: id, fingerprint: "x" }).success).toBe(false);
  });

  it("reports: the source text, never a parsed report; samples up to 5 MB", () => {
    expect(reportsBodySchema.safeParse({ action: "import", clientId: id, readerKey: "credalti_json", source: "{}" }).success).toBe(true);
    expect(reportsBodySchema.safeParse({ action: "import", clientId: id, readerKey: "credalti_json", report: {} }).success).toBe(false);
    expect(reportsBodySchema.safeParse({ action: "import", clientId: id, readerKey: "Bad Key", source: "{}" }).success).toBe(false);
    expect(reportsBodySchema.safeParse({ action: "sample", clientId: id, provider: "identityiq", text: "x".repeat(5 * 1024 * 1024 + 1) }).success).toBe(false);
  });

  it("rounds: at least one, at most 50, mail or print, known classes only; no letters or plan from the browser", () => {
    const ref = { clientId: id, roundNumber: 1 };
    expect(roundsBodySchema.safeParse({ rounds: [ref], via: "mail", mailClasses: { x: "certified" } }).success).toBe(true);
    expect(roundsBodySchema.safeParse({ rounds: [ref], via: "mail", mailClasses: { x: "overnight" } }).success).toBe(false);
    expect(roundsBodySchema.safeParse({ rounds: [ref], via: "mail", letters: [] }).success).toBe(false);
    expect(roundsBodySchema.safeParse({ rounds: Array.from({ length: 51 }, () => ref), via: "mail" }).success).toBe(false);
    expect(roundsBodySchema.safeParse({ rounds: [{ ...ref, userId: id }], via: "mail" }).success).toBe(false);
  });
});

describe("one demo rule, and the stores switch on it", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  afterEach(() => {
    for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
  });

  it("is the demo without the two public Supabase settings, and the database with both", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isDemoMode()).toBe(true);
    expect(getStaffData().demo).toBe(true);
    expect(getTeamData().demo).toBe(true);
    const demoMail = getMailData();
    expect(demoMail.mode).toBe("simulated");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(isSupabaseConfigured()).toBe(false);
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    expect(isSupabaseConfigured()).toBe(true);
    expect(getStaffData().demo).toBe(false);
    expect(getTeamData().demo).toBe(false);
    expect(getMailData()).not.toBe(demoMail);
  });

  it("every place that asked the question itself now asks supabase/config.ts", () => {
    for (const file of ["src/lib/supabase/client.ts", "src/lib/supabase/server.ts", "src/proxy.ts", "src/lib/agreement/readiness.ts", "src/lib/staff/data.ts", "src/lib/mail/data.ts", "src/lib/ux/reportStore.ts", "src/lib/ux/flagsStore.ts"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/from "(\.\/|\.\.\/supabase\/|@\/lib\/supabase\/)config"/);
    }
  });

  it("the client's report: the sample in the demo; their own, or 'waiting', with a database", () => {
    expect(reportView({ authenticated: false })).toMatchObject({ live: false, ready: true, waiting: false, report: DEMO_CLIENT_REPORT, scoreHistory: DEMO_SCORE_HISTORY });
    expect(reportView(null)).toMatchObject({ live: true, ready: false });
    const waiting = reportView({ authenticated: true, report: null, scoreHistory: [], profile: { fullName: "Rosa", addressLines: [] } });
    expect(waiting).toMatchObject({ live: true, ready: true, waiting: true, items: [] });
    const own = reportView({ authenticated: true, report: DEMO_REPORT, scoreHistory: [], profile: { fullName: "Rosa", addressLines: ["1 A St", "Houston, TX 77002"] } });
    expect(own).toMatchObject({ live: true, waiting: false, profile: { fullName: "Rosa" } });
  });

  it("the journey: unchanged in the demo; with a database and no report, the import step", () => {
    const state = sessionJourneyState([], {}, false, null, undefined);
    expect(withReport(state, { live: false, waiting: true })).toBe(state);
    expect(withReport(state, { live: true, waiting: true }).reportImported).toBe(false);
    expect(withReport({ ...state, roundApproved: true }, { live: true, waiting: false }, ago(3)).mailedAt).toBe(ago(3));
  });

  it("a mailed round's snapshot: every item its letters cover, as confirmed", () => {
    const flags = { a: { state: "attested" as const, attestedAt: ago(5), reasonCode: "not_mine" as const }, b: { state: "correct" as const } };
    expect(roundSnapshot(flags, ["a", "b"], ago(1))).toEqual({ a: flags.a, b: { state: "attested", attestedAt: ago(1) } });
  });
});

describe("the console's database data layer (browser side)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (routes: Record<string, (body: unknown) => { status?: number; body: unknown }>) => {
    const calls: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      const handler = routes[path];
      const answer = handler ? handler(body) : { status: 404, body: {} };
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    });
    return calls;
  };

  it("reads the list once until something changes it", async () => {
    const calls = respond({ "/api/staff/clients": () => ({ body: { clients: [{ id: C }] } }), "/api/staff/case": () => ({ body: { ok: true, note: { id: "n" } } }) });
    const data = createDatabaseStaffData();
    expect(data.demo).toBe(false);
    await data.listClients();
    await data.getClient(C);
    expect(calls.filter((c) => c.path === "/api/staff/clients")).toHaveLength(1);
    await data.addNote(C, "  hola ", "ignored");
    expect(calls.at(-1)).toEqual({ path: "/api/staff/case", body: { action: "note", clientId: C, text: "hola" } });
    await data.listClients();
    expect(calls.filter((c) => c.path === "/api/staff/clients")).toHaveLength(2);
  });

  it("sends rounds with the chosen classes and says which did not go", async () => {
    const calls = respond({
      "/api/staff/rounds": () => ({ body: { ok: true, outcomes: [{ clientId: C, roundNumber: 1, sent: true }, { clientId: "x", roundNumber: 2, sent: false, reason: "Falta la dirección." }] } }),
    });
    const data = createDatabaseStaffData();
    const error = await data.markRoundsSent([{ clientId: C, roundNumber: 1 }, { clientId: "x", roundNumber: 2 }], { mailClasses: { l: "certified" } }).catch((e) => e);
    expect(error).toBeInstanceOf(RoundsNotSentError);
    expect((error as RoundsNotSentError).held).toEqual([{ clientId: "x", roundNumber: 2, reason: "Falta la dirección." }]);
    expect(calls[0]!.body).toEqual({ rounds: [{ clientId: C, roundNumber: 1 }, { clientId: "x", roundNumber: 2 }], via: "mail", mailClasses: { l: "certified" } });
  });

  it("sends the report's text (never the parsed report), refuses without it, and passes the server's reasons on", async () => {
    const calls = respond({ "/api/staff/reports": () => ({ status: 409, body: { message: "Este reporte es más antiguo." } }) });
    const data = createDatabaseStaffData();
    await expect(data.saveReport(C, { readerKey: "credalti_json", report: DEMO_RAW_REPORT, by: "x" })).rejects.toThrow(/Falta el texto/);
    await expect(data.saveReport(C, { readerKey: "credalti_json", report: DEMO_RAW_REPORT, by: "x", source: "{}" })).rejects.toThrow(/más antiguo/);
    expect(calls[0]!.body).toEqual({ action: "import", clientId: C, readerKey: "credalti_json", source: "{}" });
  });

  it("a reply that breaks a claim rule never leaves the browser; the server's own refusal comes back as problems", async () => {
    const calls = respond({ "/api/staff/case": () => ({ status: 422, body: { problems: [{ phrase: "x", why: "y" }] } }) });
    const data = createDatabaseStaffData();
    const local = await data.sendReply(C, "Te garantizamos que eliminamos todo.", "x");
    expect(local.sent).toBe(false);
    expect(calls).toHaveLength(0);
    const remote = await data.sendReply(C, "Hola Rosa.", "x");
    expect(remote).toEqual({ sent: false, problems: [{ phrase: "x", why: "y" }] });
  });

  it("billing actions call the existing routes and send no name", async () => {
    const calls = respond({ "/api/billing/refund": () => ({ body: { ok: true } }), "/api/billing/pause": () => ({ status: 403, body: { message: "Solo un administrador puede pausar." } }) });
    const data = createDatabaseStaffData();
    expect(await data.refundCharge(C, "ch1", "Error del equipo al cobrar", "Impostor")).toEqual({ ok: true });
    expect(calls[0]!.body).toEqual({ chargeId: "ch1", reason: "Error del equipo al cobrar" });
    expect(await data.pauseBilling(C, "Motivo largo", "Impostor")).toEqual({ ok: false, message: "Solo un administrador puede pausar." });
    expect(calls[1]!.body).toEqual({ userId: C, action: "pause", reason: "Motivo largo" });
  });
});

describe("the client approval route under full service", () => {
  it("refuses a stranger, and refuses a Credalti Complete client before anything is prepared: letters leave only from the staff send", async () => {
    const route = await import("@/app/api/attacks/approve/route");
    const res = await route.POST(new Request("https://app.test/api/attacks/approve", { method: "POST", body: JSON.stringify({ roundNumber: 1 }), headers: { "x-forwarded-for": "10.9.9.9" } }));
    expect(res.status).toBe(401);
    // The option is the client's own (docs/SERVICE-OPTIONS.md): read first, and full service stops there.
    const source = readFileSync("src/app/api/attacks/approve/route.ts", "utf8");
    const refusal = source.indexOf('code: "full_service_team_sends"');
    expect(source.indexOf('(await clientOption(db, userId)) === "full_service"')).toBeGreaterThan(0);
    expect(refusal).toBeGreaterThan(source.indexOf('(await clientOption(db, userId)) === "full_service"'));
    expect(source.indexOf("await sendRound(")).toBeGreaterThan(refusal);
    // And what it does for Credalti DIY only prepares: nothing is mailed here.
    expect(source).toMatch(/via: "prepare"/);
  });
});
