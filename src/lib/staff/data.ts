import { applyAutopilotDemoActions, loadAutopilotDemo, resetAutopilotDemo } from "../autopilot/data";
import { applyFulfillmentDemo, loadFulfillmentDemo, resetFulfillmentDemo } from "../fulfillment/demo";
import { PAUSE_REASON_MIN_CHARS } from "../billing/api";
import { createMemoryChargeStore, runClientBilling } from "../billing/collect";
import { rearmAfterNewPaymentMethod } from "../billing/dunning";
import { createDemoGateway } from "../billing/gateway";
import { cleanRefundReason, refundEligibility, withRefund } from "../billing/refunds";
import type { BillingAccount } from "../billing/types";
import type { RawReport } from "../domain/parser";
import { mergeReport, planImport } from "../reports/merge";
import { demoReportHistory } from "../reports/history";
import { checkStaffReply, MAX_REPLY_CHARS, openQuestions, type ReplyProblem } from "./conversation";
import { buildDemoClients } from "./demoClients";
import { withDemoLeadSources } from "../partners/demo";
import { withDemoPulses } from "../pulse/demo";
import { sampleMethod } from "./billing";
import { applyDemoSends, demoFurnisherBook, loadDemoSends, recordDemoSend, resetDemoMail } from "../mail/data";
import { resetDemoLetterVersions } from "../letters/versions/data";
import { demoClientsWithMail } from "../mail/demo";
import { roundMailPlan } from "../mail/sendPlan";
import type { MailClass } from "../mail/types";
import { clientBilling, sendableRound } from "./stage";
import { isDemoMode } from "../supabase/config";
import { applyTeamActions, loadTeamActions, resetTeamActions } from "./teamStore";
import type { DocumentKind, ReportSample, StaffChatMessage, StaffClient, StaffNote } from "./types";

// Where the console gets its clients and records what staff do.
//
// The pages only know the StaffData interface. There are two implementations:
// the demo (invented clients, demoClients.ts, plus whatever the person at the
// keyboard did, kept in the browser) and the database one at the bottom of
// this file. getStaffData() picks by the one demo rule (supabase/config.ts).

export interface RoundRef {
  clientId: string;
  roundNumber: number;
}

export interface StaffData {
  /** True when the clients are invented. The console shows a "Demo" pill. */
  readonly demo: boolean;
  listClients(): Promise<StaffClient[]>;
  getClient(id: string): Promise<StaffClient | null>;
  /**
   * Mail prepared rounds. In the demo they are only marked as sent. A round is
   * left out if it may not be sent now (sendableRound, with the furnisher
   * address book) or if any of its letters has no address to go to.
   */
  markRoundsSent(rounds: RoundRef[], options?: SendOptions): Promise<void>;
  addNote(clientId: string, text: string, author: string): Promise<StaffNote>;
  /**
   * Mark an exception as handled (see clientExceptions for how long it stays
   * quiet). For an escalated question this records it as answered.
   */
  resolveException(clientId: string, exceptionKey: string): Promise<void>;
  /**
   * Save a report a reader produced (reports/readers.ts) as the client's
   * newest. What that does to the record is reports/merge.ts: mergeReport. It
   * never writes an answer: what the client said about an item stays as it is.
   * Rejects when the report must not be saved (older than the one on file…).
   */
  saveReport(clientId: string, input: ReportInput): Promise<void>;
  /**
   * Keep a report page for a provider that has no reader yet, exactly as it
   * was received. Nothing is read from it and the client's stage does not
   * change. Called only when a member of staff asks for it.
   */
  saveReportSample(clientId: string, input: SampleInput): Promise<SampleSaved>;
  /**
   * A teammate's reply in the client's conversation, stored with source
   * "human" and the teammate's name. A reply that breaks a claim rule is not
   * sent: the problems come back instead. A reply that is sent also answers
   * the questions the assistant had passed to the team.
   */
  sendReply(clientId: string, text: string, author: string): Promise<ReplyResult>;
  /**
   * Return a paid charge to the client, in full, with a written reason. The
   * refund is recorded and the charge stays on file marked as refunded;
   * nothing is deleted. This and the pause below are the only things staff
   * can do about money: there is no way to create a charge by hand and no way
   * to change an amount, here or anywhere else.
   */
  refundCharge(clientId: string, chargeId: string, reason: string, by: string): Promise<BillingActionResult>;
  /** Stop automatic charges for one client, with a reason that is kept. */
  pauseBilling(clientId: string, reason: string, by: string): Promise<BillingActionResult>;
  /** Lift that pause: the system bills again by its rules. */
  resumeBilling(clientId: string): Promise<BillingActionResult>;
  /**
   * A chargeback the processor's portal shows (when it sends no webhook):
   * recorded open on the charge. Only for money that was taken.
   */
  recordChargeback(clientId: string, chargeId: string, input: { reasonCode: string | null; receivedOn: string; note?: string }, by: string): Promise<BillingActionResult>;
  /** Close a chargeback (won, lost, accepted) or mark the evidence sent. */
  setChargebackStatus(clientId: string, chargeId: string, status: "won" | "lost" | "accepted" | "responded"): Promise<BillingActionResult>;
}

export type BillingActionResult = { ok: true } | { ok: false; message: string };

/** How a send goes out: the class chosen for each letter (letter id → class), and whether it was printed here. */
export interface SendOptions {
  mailClasses?: Record<string, MailClass>;
  /** "print": printed in the office and mailed by hand (/equipo/imprimir). Otherwise through the mail service. */
  via?: "mail" | "print";
}

export interface ReportInput {
  /** The reader that read it. */
  readerKey: string;
  report: RawReport;
  /** The teammate saving it. */
  by: string;
  /**
   * The text exactly as pasted or uploaded. The database version sends this,
   * not `report`: the server reads it again with the reader.
   */
  source?: string;
}

export interface SampleInput {
  /** Reader key of the provider the page came from. */
  provider: string;
  text: string;
  fileName: string | null;
  by: string;
}

export interface SampleSaved {
  sample: ReportSample;
  /**
   * False when the sample could not be written to lasting storage and is held
   * only for this visit (the demo, when the browser's storage is full).
   */
  persisted: boolean;
}

export type ReplyResult = { sent: true; message: StaffChatMessage } | { sent: false; problems: ReplyProblem[] };

// ── Demo implementation ─────────────────────────────────────────────────

/** What a member of staff did in the demo, replayed over the invented clients. */
export interface DemoActions {
  /** clientId → round number → ISO time it was sent. */
  sent: Record<string, Record<string, string>>;
  /** clientId → notes added, oldest first. */
  notes: Record<string, StaffNote[]>;
  /** clientId → exception key → ISO time it was marked handled. */
  handled: Record<string, Record<string, string>>;
  /** clientId → reports imported, oldest first. */
  imports: Record<string, DemoImport[]>;
  /** clientId → report pages kept as samples, oldest first. */
  samples: Record<string, ReportSample[]>;
  /** clientId → replies the team wrote in the conversation, oldest first. */
  replies: Record<string, StaffChatMessage[]>;
  /** clientId → documents the invented client "uploaded" (the demo's stand-in for the client app). */
  documents: Record<string, DocumentKind[]>;
  /**
   * clientId → the client's billing as it stands after something happened to
   * it in the demo (a refund, a pause, a simulated run of the system). It
   * replaces the invented account whole.
   */
  billing: Record<string, BillingAccount>;
}

export interface DemoImport {
  at: string;
  by: string;
  readerKey: string;
  report: RawReport;
}

export const EMPTY_ACTIONS: DemoActions = {
  sent: {},
  notes: {},
  handled: {},
  imports: {},
  samples: {},
  replies: {},
  documents: {},
  billing: {},
};

const QUESTION_PREFIX = "question:";

/** The demo clients as they stand after the recorded actions. Pure: returns new objects. */
export function applyDemoActions(clients: StaffClient[], actions: DemoActions): StaffClient[] {
  return clients.map((client) => {
    const sent = actions.sent[client.id] ?? {};
    const handled = actions.handled[client.id] ?? {};
    const notes = actions.notes[client.id] ?? [];
    const replies = actions.replies[client.id] ?? [];
    const samples = actions.samples[client.id] ?? [];
    const documents = (actions.documents[client.id] ?? []).filter((kind) => !client.documents.includes(kind));

    const acted: StaffClient = {
      ...client,
      rounds: client.rounds.map((round) => {
        const sentAt = sent[String(round.number)];
        if (!sentAt || round.status !== "ready") return round;
        return {
          ...round,
          status: "mailed" as const,
          mailedAt: sentAt,
          letters: round.letters.map((letter) => ({ ...letter, mailStatus: "in_transit" as const })),
        };
      }),
      notes: [...client.notes, ...notes],
      questions: client.questions.map((q) => {
        const answeredAt = handled[`${QUESTION_PREFIX}${q.id}`];
        return answeredAt && !q.answeredAt ? { ...q, answeredAt } : q;
      }),
      handled: { ...client.handled, ...handled },
      ...(actions.billing?.[client.id] ? { billing: actions.billing[client.id]! } : {}),
      ...(documents.length > 0 ? { documents: [...client.documents, ...documents] } : {}),
      ...(replies.length > 0 ? { conversation: [...(client.conversation ?? []), ...replies] } : {}),
      ...(samples.length > 0 ? { reportSamples: [...(client.reportSamples ?? []), ...samples] } : {}),
    };

    // Reports last and in the order they were imported: each one is merged
    // into the record as it stood then (a round sent after an import is not
    // answered by it; mergeReport reads the dates).
    const imports = [...(actions.imports[client.id] ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    if (imports.length === 0) return acted;
    const merged = imports.reduce((current, imported) => {
      try {
        return mergeReport(current, imported.report, imported);
      } catch {
        // A stored import that no longer applies (the demo data moved on) is skipped.
        return current;
      }
    }, acted);
    // The Reports tab: the invented report on file first, then each import (reports/history.ts).
    return { ...merged, reportHistory: demoReportHistory(acted.report, (merged.reportImports ?? []).slice((acted.reportImports ?? []).length)) };
  });
}

/** Demo only: the report as it was brought in, for the Reports tab's open and download. Null when there is none. */
export function demoImportedReport(clientId: string, at: string): RawReport | null {
  const found = (loadActions().imports[clientId] ?? []).find((imported) => imported.at === at);
  return found ? found.report : null;
}

/**
 * The actions with a teammate's reply added. The reply also answers every
 * question the assistant had passed to the team before it, through the same "answered"
 * mark that resolveException writes. Pure: returns new actions.
 */
export function withReply(actions: DemoActions, client: StaffClient, message: StaffChatMessage): DemoActions {
  const answered = Object.fromEntries(
    openQuestions(client)
      .filter((q) => q.askedAt <= message.at)
      .map((q) => [`${QUESTION_PREFIX}${q.id}`, message.at]),
  );
  return {
    ...actions,
    replies: { ...actions.replies, [client.id]: [...(actions.replies[client.id] ?? []), message] },
    handled: { ...actions.handled, [client.id]: { ...actions.handled[client.id], ...answered } },
  };
}

/**
 * Demo only: what the system's billing run would do for this client right
 * now, with the demo processor (no money moves). It is the real collection
 * code (billing/collect.ts) over the client's record: it retries what is due
 * and charges the next mailed round if the rule allows one, and nothing else.
 * With `newMethod`, the invented client first puts a working payment method
 * on file, which gives a declined charge one more try. Pure apart from the
 * clock: returns the account as it stands afterwards.
 */
export async function demoBillingRun(client: StaffClient, now: Date, options: { newMethod?: boolean } = {}): Promise<BillingAccount> {
  let account = client.billing;
  if (options.newMethod) {
    account = {
      ...account,
      paymentMethod: sampleMethod(now.toISOString()),
      charges: account.charges.map((charge) => rearmAfterNewPaymentMethod(charge, now)),
    };
  }
  const method = account.paymentMethod;
  const store = createMemoryChargeStore(account.charges, (roundNumber) => `${client.id}-ch${roundNumber}`);
  const report = await runClientBilling(
    { gateway: createDemoGateway(), store },
    { ...clientBilling(client), account },
    method ? { customerRef: `demo_cus_${client.id}`, paymentMethodRef: `demo_pm_${method.brand}_${method.last4}` } : null,
    now,
  );
  return { ...account, charges: report.charges };
}

const STORAGE_KEY = "bonalti.staffDemo.v1";
// Samples can be several megabytes each, so they are kept under their own key:
// a sample that does not fit must not stop everything else from being saved.
const SAMPLES_KEY = "bonalti.staffDemo.samples.v1";

function loadActions(): DemoActions {
  if (typeof window === "undefined") return structuredClone(EMPTY_ACTIONS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<DemoActions>) : {};
    const rawSamples = window.localStorage.getItem(SAMPLES_KEY);
    return {
      sent: parsed.sent ?? {},
      notes: parsed.notes ?? {},
      handled: parsed.handled ?? {},
      imports: parsed.imports ?? {},
      samples: rawSamples ? (JSON.parse(rawSamples) as DemoActions["samples"]) : {},
      replies: parsed.replies ?? {},
      documents: parsed.documents ?? {},
      billing: parsed.billing ?? {},
    };
  } catch {
    return structuredClone(EMPTY_ACTIONS);
  }
}

/** True when the actions were written to the browser's storage. */
function saveActions(actions: DemoActions): boolean {
  try {
    const { samples: _samples, ...rest } = actions;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    return true;
  } catch {
    // Storage unavailable (private mode): the actions stay in memory for this visit.
    return false;
  }
}

/** True when the samples were written to the browser's storage. */
function saveSamples(samples: DemoActions["samples"]): boolean {
  try {
    window.localStorage.setItem(SAMPLES_KEY, JSON.stringify(samples));
    return true;
  } catch {
    // Too large for this browser's storage, or storage unavailable.
    return false;
  }
}

function createDemoData(): StaffData & {
  reset(): void;
  baseReport(clientId: string): StaffClient["report"];
  receiveDocument(clientId: string, kind: DocumentKind): void;
  runBilling(clientId: string, options?: { newMethod?: boolean }): Promise<void>;
} {
  // Built once per visit, so every screen sees the same people and dates.
  let base: StaffClient[] | null = null;
  let actions: DemoActions | null = null;

  const state = () => {
    if (!base) {
      const now = new Date();
      // The invented clients, with what a mail service would have reported for their letters (mail/demo.ts).
      // Plus where some of them came from: partners' referrals and leads from HighLevel (partners/demo.ts).
      // And a few invented answers to "¿Cómo vamos?" (pulse/demo.ts).
      base = withDemoPulses(withDemoLeadSources(demoClientsWithMail(buildDemoClients(now), now), now), now);
    }
    actions ??= loadActions();
    return { base, actions };
  };
  const current = () => {
    const s = state();
    // The team's own record (teamStore.ts): people added by hand join the
    // invented ones first, then assignments and senders are applied, then the
    // rounds sent from the send screen (mail/demo.ts).
    const team = loadTeamActions();
    // Last, the holds and opt-outs a person recorded on the autopilot (autopilot/data.ts).
    // Then the monitoring checks and document reviews a person recorded (fulfillment/demo.ts).
    return applyFulfillmentDemo(
      applyAutopilotDemoActions(applyDemoSends(applyTeamActions(applyDemoActions([...s.base, ...team.added], s.actions), team), loadDemoSends()), loadAutopilotDemo()),
      loadFulfillmentDemo(),
    );
  };

  return {
    demo: true,
    async listClients() {
      return current();
    },
    async getClient(id) {
      return current().find((c) => c.id === id) ?? null;
    },
    async markRoundsSent(rounds, options = {}) {
      const { actions: a } = state();
      const now = new Date();
      const at = now.toISOString();
      const clients = current();
      const furnishers = demoFurnisherBook();
      for (const { clientId, roundNumber } of rounds) {
        // The same rule the screens show, applied again where the round is
        // marked: a round goes out only if it may be sent right now (agreement
        // in force and past its cancellation window, current report, a checked
        // address for every creditor and collector…).
        const client = clients.find((c) => c.id === clientId);
        const round = client ? sendableRound(client, now, { furnishers }) : null;
        if (!client || !round || round.number !== roundNumber) continue;
        const plan = roundMailPlan(client, round, furnishers, now, options.mailClasses);
        if (plan.blockers.length > 0) continue;
        a.sent[clientId] = { ...a.sent[clientId], [String(roundNumber)]: at };
        recordDemoSend(clientId, roundNumber, {
          via: options.via === "print" ? "print" : "simulated",
          classes: Object.fromEntries(plan.letters.map((l) => [l.letter.id, l.mailClass])),
          addresses: Object.fromEntries(plan.letters.flatMap((l) => (l.to ? [[l.letter.id, l.to]] : []))),
        });
      }
      saveActions(a);
    },
    async addNote(clientId, text, author) {
      const { actions: a } = state();
      const at = new Date().toISOString();
      const note: StaffNote = { id: `${clientId}-n-${at}`, at, author, text: text.trim() };
      a.notes[clientId] = [...(a.notes[clientId] ?? []), note];
      saveActions(a);
      return note;
    },
    async resolveException(clientId, exceptionKey) {
      const { actions: a } = state();
      a.handled[clientId] = { ...a.handled[clientId], [exceptionKey]: new Date().toISOString() };
      saveActions(a);
    },
    async saveReport(clientId, { readerKey, report, by }) {
      const client = current().find((c) => c.id === clientId);
      if (!client) throw new Error("No encontramos a este cliente.");
      const at = new Date().toISOString();
      // Checked here too, not only on the screen: nothing is stored unless it may be.
      const plan = planImport(client, report, at);
      if (plan.blocked) throw new Error(plan.blocked);
      const { actions: a } = state();
      a.imports[clientId] = [...(a.imports[clientId] ?? []), { at, by, readerKey, report }];
      saveActions(a);
    },
    async saveReportSample(clientId, { provider, text, fileName, by }) {
      const { actions: a } = state();
      const savedAt = new Date().toISOString();
      const sample: ReportSample = { id: `${clientId}-s-${savedAt}`, provider, savedAt, savedBy: by, fileName, text };
      a.samples[clientId] = [...(a.samples[clientId] ?? []), sample];
      return { sample, persisted: saveSamples(a.samples) };
    },
    async sendReply(clientId, text, author) {
      const body = text.trim().slice(0, MAX_REPLY_CHARS);
      const name = author.trim();
      if (!body || !name) return { sent: false, problems: [] };
      const problems = checkStaffReply(body);
      if (problems.length > 0) return { sent: false, problems };
      const client = current().find((c) => c.id === clientId);
      if (!client) throw new Error("No encontramos a este cliente.");
      const at = new Date().toISOString();
      const message: StaffChatMessage = {
        id: `${clientId}-m-${at}`,
        at,
        role: "assistant",
        source: "human",
        authorName: name,
        text: body,
      };
      actions = withReply(state().actions, client, message);
      saveActions(actions);
      return { sent: true, message };
    },
    async refundCharge(clientId, chargeId, reason, by) {
      const client = current().find((c) => c.id === clientId);
      const charge = client?.billing.charges.find((c) => c.id === chargeId);
      if (!client || !charge) return { ok: false, message: "No encontramos ese cobro." };
      // The same rule the server route applies: paid, not yet returned, and a written reason.
      const allowed = refundEligibility(charge, reason);
      if (!allowed.allowed) return { ok: false, message: allowed.reason.es };
      const at = new Date().toISOString();
      const refunded = withRefund(charge, {
        id: `${chargeId}-re`,
        amountCents: allowed.amountCents,
        reason: cleanRefundReason(reason),
        by: by.trim() || "equipo",
        at,
        completedAt: at,
      });
      const { actions: a } = state();
      a.billing[clientId] = { ...client.billing, charges: client.billing.charges.map((c) => (c.id === chargeId ? refunded : c)) };
      saveActions(a);
      return { ok: true };
    },
    async pauseBilling(clientId, reason, by) {
      const client = current().find((c) => c.id === clientId);
      if (!client) return { ok: false, message: "No encontramos a este cliente." };
      const why = reason.replace(/\s+/g, " ").trim();
      if (why.length < PAUSE_REASON_MIN_CHARS) return { ok: false, message: "Escribe el motivo de la pausa. Queda en el registro." };
      const { actions: a } = state();
      a.billing[clientId] = { ...client.billing, pause: { at: new Date().toISOString(), by: by.trim() || "equipo", reason: why.slice(0, 1000) } };
      saveActions(a);
      return { ok: true };
    },
    async resumeBilling(clientId) {
      const client = current().find((c) => c.id === clientId);
      if (!client) return { ok: false, message: "No encontramos a este cliente." };
      const { actions: a } = state();
      a.billing[clientId] = { ...client.billing, pause: null };
      saveActions(a);
      return { ok: true };
    },
    async recordChargeback(clientId, chargeId, input, by) {
      const client = current().find((c) => c.id === clientId);
      const charge = client?.billing.charges.find((c) => c.id === chargeId);
      if (!client || !charge) return { ok: false, message: "No encontramos ese cobro." };
      // The same rule as the database: only money that was taken can be disputed, once.
      if (!charge.chargedAt) return { ok: false, message: "Solo se puede disputar dinero que se cobró." };
      if (charge.chargeback) return { ok: false, message: "Este cobro ya tiene un contracargo." };
      const at = new Date(`${input.receivedOn}T12:00:00Z`).toISOString();
      const disputed = {
        ...charge,
        chargeback: {
          id: `${chargeId}-cb`,
          status: "open" as const,
          reasonCode: input.reasonCode,
          amountCents: charge.amountCents - (charge.creditCents ?? 0),
          receivedAt: at,
          source: "manual" as const,
          respondedAt: null,
        },
      };
      void by;
      const { actions: a } = state();
      a.billing[clientId] = { ...client.billing, charges: client.billing.charges.map((c) => (c.id === chargeId ? disputed : c)) };
      saveActions(a);
      return { ok: true };
    },
    async setChargebackStatus(clientId, chargeId, status) {
      const client = current().find((c) => c.id === clientId);
      const charge = client?.billing.charges.find((c) => c.id === chargeId);
      if (!client || !charge?.chargeback) return { ok: false, message: "No encontramos ese contracargo." };
      if (charge.chargeback.status !== "open") return { ok: false, message: "Un contracargo cerrado sigue cerrado." };
      const chargeback = status === "responded" ? { ...charge.chargeback, respondedAt: new Date().toISOString() } : { ...charge.chargeback, status };
      const { actions: a } = state();
      a.billing[clientId] = { ...client.billing, charges: client.billing.charges.map((c) => (c.id === chargeId ? { ...charge, chargeback } : c)) };
      saveActions(a);
      return { ok: true };
    },
    async runBilling(clientId, options = {}) {
      const client = current().find((c) => c.id === clientId);
      if (!client) return;
      const account = await demoBillingRun(client, new Date(), options);
      const { actions: a } = state();
      a.billing[clientId] = account;
      saveActions(a);
    },
    baseReport(clientId) {
      return state().base.find((c) => c.id === clientId)?.report ?? null;
    },
    receiveDocument(clientId, kind) {
      const { actions: a } = state();
      a.documents[clientId] = [...new Set([...(a.documents[clientId] ?? []), kind])];
      saveActions(a);
    },
    reset() {
      actions = structuredClone(EMPTY_ACTIONS);
      base = null;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(SAMPLES_KEY);
        resetFulfillmentDemo();
      } catch {
        // ignore
      }
    },
  };
}

const demoData = createDemoData();

/** Demo only: forget everything done in this browser and start again. */
export function resetDemo(): void {
  demoData.reset();
  resetAutopilotDemo();
  resetTeamActions();
  resetDemoMail();
  resetDemoLetterVersions();
}

/** Demo only: the invented report a client had before any import (the Reports tab's first entry). */
export function demoOnFileReport(clientId: string): StaffClient["report"] {
  return demoData.baseReport(clientId);
}

/**
 * Demo only: act as the invented client and put a document on file. In the
 * real product documents come from the client's own upload; the console's
 * clients are fictional, so this stands in for it. Deliberately not part of
 * StaffData: it is not something staff do.
 */
export function demoClientUploads(clientId: string, kind: DocumentKind): void {
  demoData.receiveDocument(clientId, kind);
}

/**
 * Demo only: stand in for the system's billing run for one invented client
 * (and, with `newMethod`, for the client putting a working payment method on
 * file first). In the real product the run is /api/cron/billing and the
 * payment method comes from the client's own "Mis pagos" screen. Deliberately
 * not part of StaffData: nobody on the team charges anyone.
 */
export function demoRunsBilling(clientId: string, options: { newMethod?: boolean } = {}): Promise<void> {
  return demoData.runBilling(clientId, options);
}

// ── Database implementation ─────────────────────────────────────────────
//
// Selected by getStaffData() when Supabase is configured (supabase/config.ts,
// the one demo rule). It runs in the browser and holds no data of its own:
//
// Reads: GET /api/staff/clients. The server reads through the member's OWN
// connection, so the role-scoped "staff read" policies of migration 0012
// decide what this person sees, and maps the rows to StaffClient
// (staff/fromRows.ts). Never the service role for a read.
//
// Writes: each action calls a staff route, which checks the member's role on
// the server from their own staff_members row (requireCapability), checks they
// may see the client through their own connection, validates the body, and
// writes with the service role (staff/actions.ts):
//   markRoundsSent          POST /api/staff/rounds (rounds/send.ts: the agreement gate,
//                           attestation on every item, addresses, idempotent)
//   addNote, resolveException, sendReply   POST /api/staff/case
//   saveReport, saveReportSample           POST /api/staff/reports (the server reads
//                           the source again with the reader; it never trusts a parsed report)
//   refundCharge            POST /api/billing/refund
//   pauseBilling, resumeBilling            POST /api/billing/pause
// There is no route that creates a charge for staff, and there must never be
// one: charges come only from /api/cron/billing.
//
// The `author` / `by` arguments are for the demo: the routes sign every record
// with the member's own handle and ignore them.

interface Answer {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

async function request(path: string, body?: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: "No pudimos conectar. Revisa tu conexión e intenta de nuevo." } };
  }
}

/** The route's sentence for staff, or a plain one. */
function messageOf(answer: Answer, fallback: string): string {
  const { message, error, problems } = answer.data;
  const lines = Array.isArray(problems) ? problems.filter((p): p is string => typeof p === "string") : [];
  if (lines.length > 0) return lines.join(" ");
  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** Thrown by markRoundsSent when some rounds did not go. The message says which and why. */
export class RoundsNotSentError extends Error {
  constructor(
    message: string,
    readonly held: Array<{ clientId: string; roundNumber: number; reason: string }>,
  ) {
    super(message);
    this.name = "RoundsNotSentError";
  }
}

export function createDatabaseStaffData(): StaffData {
  // One read of the list serves every screen until something changes it.
  let list: Promise<StaffClient[]> | null = null;
  const invalidate = () => {
    list = null;
  };
  const load = (): Promise<StaffClient[]> => {
    list ??= request("/api/staff/clients").then((answer) => {
      if (!answer.ok) {
        list = null;
        throw new Error(messageOf(answer, "No pudimos leer los clientes."));
      }
      return (answer.data.clients as StaffClient[] | undefined) ?? [];
    });
    return list;
  };
  const billing = async (path: string, body: unknown): Promise<BillingActionResult> => {
    const answer = await request(path, body);
    invalidate();
    return answer.ok ? { ok: true } : { ok: false, message: messageOf(answer, "No se pudo guardar. Intenta de nuevo.") };
  };

  return {
    demo: false,
    listClients: load,
    async getClient(id) {
      return (await load()).find((c) => c.id === id) ?? null;
    },
    async markRoundsSent(rounds, options = {}) {
      if (rounds.length === 0) return;
      const answer = await request("/api/staff/rounds", { rounds, via: options.via === "print" ? "print" : "mail", mailClasses: options.mailClasses });
      invalidate();
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo enviar. Intenta de nuevo."));
      const outcomes = (answer.data.outcomes as Array<{ clientId: string; roundNumber: number; sent: boolean; reason?: string }> | undefined) ?? [];
      const held = outcomes.filter((o) => !o.sent).map((o) => ({ clientId: o.clientId, roundNumber: o.roundNumber, reason: o.reason ?? "No se pudo enviar." }));
      if (held.length > 0) {
        const sent = outcomes.length - held.length;
        throw new RoundsNotSentError(
          `${sent > 0 ? `Se ${sent === 1 ? "envió 1 ronda" : `enviaron ${sent} rondas`}. ` : ""}${held.length === 1 ? "Una ronda no salió" : `${held.length} rondas no salieron`}: ${held.map((h) => `ronda ${h.roundNumber} — ${h.reason}`).join(" · ")}`,
          held,
        );
      }
    },
    async addNote(clientId, text) {
      const answer = await request("/api/staff/case", { action: "note", clientId, text: text.trim() });
      invalidate();
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo guardar la nota."));
      return answer.data.note as StaffNote;
    },
    async resolveException(clientId, exceptionKey) {
      const answer = await request("/api/staff/case", { action: "resolve", clientId, key: exceptionKey });
      invalidate();
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo marcar como atendido."));
    },
    async saveReport(clientId, { readerKey, source }) {
      // The server reads the text again itself: a report parsed here is never sent as the record.
      if (!source) throw new Error("Falta el texto del reporte.");
      const answer = await request("/api/staff/reports", { action: "import", clientId, readerKey, source });
      invalidate();
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo guardar el reporte."));
    },
    async saveReportSample(clientId, { provider, text, fileName }) {
      const answer = await request("/api/staff/reports", { action: "sample", clientId, provider, text, fileName });
      invalidate();
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo guardar la muestra."));
      return { sample: answer.data.sample as ReportSample, persisted: true };
    },
    async sendReply(clientId, text) {
      const body = text.trim().slice(0, MAX_REPLY_CHARS);
      if (!body) return { sent: false, problems: [] };
      // Checked here too, so the screen answers at once; the route checks again.
      const problems = checkStaffReply(body);
      if (problems.length > 0) return { sent: false, problems };
      const answer = await request("/api/staff/case", { action: "reply", clientId, text: body });
      invalidate();
      if (answer.status === 422 && Array.isArray(answer.data.problems)) return { sent: false, problems: answer.data.problems as ReplyProblem[] };
      if (!answer.ok) throw new Error(messageOf(answer, "No se pudo enviar la respuesta."));
      return { sent: true, message: answer.data.message as StaffChatMessage };
    },
    refundCharge: (_clientId, chargeId, reason) => billing("/api/billing/refund", { chargeId, reason }),
    pauseBilling: (clientId, reason) => billing("/api/billing/pause", { userId: clientId, action: "pause", reason }),
    resumeBilling: (clientId) => billing("/api/billing/pause", { userId: clientId, action: "resume" }),
    recordChargeback: (_clientId, chargeId, input) =>
      billing("/api/staff/billing", { action: "chargeback", chargeId, reasonCode: input.reasonCode, receivedOn: input.receivedOn, ...(input.note ? { note: input.note } : {}) }),
    setChargebackStatus: async (clientId, chargeId, status) => {
      const client = (await load()).find((c) => c.id === clientId);
      const id = client?.billing.charges.find((c) => c.id === chargeId)?.chargeback?.id;
      if (!id) return { ok: false, message: "No encontramos ese contracargo." };
      return billing("/api/staff/billing", { action: "chargeback_status", chargebackId: id, status });
    },
  };
}

let databaseData: StaffData | null = null;

/** The console's data: the database when Supabase is configured, the demo otherwise. */
export function getStaffData(): StaffData {
  if (isDemoMode()) return demoData;
  databaseData ??= createDatabaseStaffData();
  return databaseData;
}
