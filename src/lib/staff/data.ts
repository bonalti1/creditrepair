import { PAUSE_REASON_MIN_CHARS } from "../billing/api";
import { createMemoryChargeStore, runClientBilling } from "../billing/collect";
import { rearmAfterNewPaymentMethod } from "../billing/dunning";
import { createDemoGateway } from "../billing/gateway";
import { cleanRefundReason, refundEligibility, withRefund } from "../billing/refunds";
import type { BillingAccount } from "../billing/types";
import type { RawReport } from "../domain/parser";
import { mergeReport, planImport } from "../reports/merge";
import { checkStaffReply, MAX_REPLY_CHARS, openQuestions, type ReplyProblem } from "./conversation";
import { buildDemoClients } from "./demoClients";
import { sampleMethod } from "./billing";
import { applyDemoSends, demoFurnisherBook, loadDemoSends, recordDemoSend, resetDemoMail } from "../mail/data";
import { demoClientsWithMail } from "../mail/demo";
import { roundMailPlan } from "../mail/sendPlan";
import type { MailClass } from "../mail/types";
import { clientBilling, sendableRound } from "./stage";
import type { DocumentKind, ReportSample, StaffChatMessage, StaffClient, StaffNote } from "./types";

// Where the console gets its clients and records what staff do.
//
// The pages only know the StaffData interface. Today the one implementation
// is the demo: invented clients (demoClients.ts) plus whatever the person at
// the keyboard did, kept in the browser. The database implementation goes at
// the bottom of this file, in the marked place.

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
   * the questions Capi had passed to the team.
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
    return [...(actions.imports[client.id] ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .reduce((current, imported) => {
        try {
          return mergeReport(current, imported.report, imported);
        } catch {
          // A stored import that no longer applies (the demo data moved on) is skipped.
          return current;
        }
      }, acted);
  });
}

/**
 * The actions with a teammate's reply added. The reply also answers every
 * question Capi had passed to the team before it, through the same "answered"
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
      base = demoClientsWithMail(buildDemoClients(now), now);
    }
    actions ??= loadActions();
    return { base, actions };
  };
  const current = () => {
    const s = state();
    return applyDemoSends(applyDemoActions(s.base, s.actions), loadDemoSends());
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
    async runBilling(clientId, options = {}) {
      const client = current().find((c) => c.id === clientId);
      if (!client) return;
      const account = await demoBillingRun(client, new Date(), options);
      const { actions: a } = state();
      a.billing[clientId] = account;
      saveActions(a);
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
  resetDemoMail();
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
// NOT WRITTEN YET. This is the place for it.
//
// Reads: a signed-in member of staff can select the client tables through the
// "staff read …" policies in supabase/migrations/0007_staff.sql (profiles,
// monitoring_subscriptions, report_pulls, report_items, item_flags,
// attack_rounds, letters, letter_items, identity_documents, chat_messages,
// events) and "staff read agreements" in 0010_service_agreements.sql
// (service_agreements: the newest row per client gives agreementSignedAt,
// disclosureAcknowledgedAt, agreementVersion, cancellationDeadline,
// agreementCancelledAt, cancelledWithinWindow, serviceEndRequestedAt and
// serviceEndReason). Map those rows to StaffClient.
//
// Billing (migration 0011): "staff read payment methods", "staff read
// charges", "staff read refunds" and "staff read billing pauses" give
// StaffClient.billing; service_agreements.terms->>'monthlyFee' of the newest
// signed row gives agreementMonthlyFee. refundCharge calls POST
// /api/billing/refund and pauseBilling / resumeBilling call POST
// /api/billing/pause; both routes exist, check is_staff() and write with the
// service role. There is no route that creates a charge for staff, and there
// must never be one: charges come only from /api/cron/billing.
//
// Writes: staff have no write policies. markRoundsSent, addNote,
// resolveException, saveReport, saveReportSample and sendReply must call
// server routes that check is_staff() and write with the service role, so
// every staff action is validated and logged in one place. The route behind
// markRoundsSent must apply workMayStart (src/lib/agreement/gate.ts) on the
// server, as /api/attacks/approve does. Notes, handled marks and report
// samples have no table yet.
//
// saveReport: the route must read the source again with the reader on the
// server (never trust a report parsed in the browser), then write a
// report_pulls row and its report_items; mergeReport is the specification of
// what else changes. sendReply: run checkStaffReply on the server, then
// storeMessage with source "human" and authorName (chat/history.ts,
// chat_messages.author_name from migration 0009).
//
// When it exists, return it from getStaffData() when Supabase is configured.

export function getStaffData(): StaffData {
  return demoData;
}
