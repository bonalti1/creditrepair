import { buildDemoClients } from "./demoClients";
import type { StaffClient, StaffNote } from "./types";

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
  /** Mail prepared rounds. In the demo they are only marked as sent. */
  markRoundsSent(rounds: RoundRef[]): Promise<void>;
  addNote(clientId: string, text: string, author: string): Promise<StaffNote>;
  /**
   * Mark an exception as handled (see clientExceptions for how long it stays
   * quiet). For an escalated question this records it as answered.
   */
  resolveException(clientId: string, exceptionKey: string): Promise<void>;
}

// ── Demo implementation ─────────────────────────────────────────────────

/** What a member of staff did in the demo, replayed over the invented clients. */
export interface DemoActions {
  /** clientId → round number → ISO time it was sent. */
  sent: Record<string, Record<string, string>>;
  /** clientId → notes added, oldest first. */
  notes: Record<string, StaffNote[]>;
  /** clientId → exception key → ISO time it was marked handled. */
  handled: Record<string, Record<string, string>>;
}

export const EMPTY_ACTIONS: DemoActions = { sent: {}, notes: {}, handled: {} };

const QUESTION_PREFIX = "question:";

/** The demo clients as they stand after the recorded actions. Pure: returns new objects. */
export function applyDemoActions(clients: StaffClient[], actions: DemoActions): StaffClient[] {
  return clients.map((client) => {
    const sent = actions.sent[client.id] ?? {};
    const handled = actions.handled[client.id] ?? {};
    const notes = actions.notes[client.id] ?? [];

    return {
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
    };
  });
}

const STORAGE_KEY = "bonalti.staffDemo.v1";

function loadActions(): DemoActions {
  if (typeof window === "undefined") return structuredClone(EMPTY_ACTIONS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_ACTIONS);
    const parsed = JSON.parse(raw) as Partial<DemoActions>;
    return { sent: parsed.sent ?? {}, notes: parsed.notes ?? {}, handled: parsed.handled ?? {} };
  } catch {
    return structuredClone(EMPTY_ACTIONS);
  }
}

function saveActions(actions: DemoActions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Storage unavailable (private mode): the actions stay in memory for this visit.
  }
}

function createDemoData(): StaffData & { reset(): void } {
  // Built once per visit, so every screen sees the same people and dates.
  let base: StaffClient[] | null = null;
  let actions: DemoActions | null = null;

  const state = () => {
    base ??= buildDemoClients(new Date());
    actions ??= loadActions();
    return { base, actions };
  };
  const current = () => {
    const s = state();
    return applyDemoActions(s.base, s.actions);
  };

  return {
    demo: true,
    async listClients() {
      return current();
    },
    async getClient(id) {
      return current().find((c) => c.id === id) ?? null;
    },
    async markRoundsSent(rounds) {
      const { actions: a } = state();
      const at = new Date().toISOString();
      for (const { clientId, roundNumber } of rounds) {
        a.sent[clientId] = { ...a.sent[clientId], [String(roundNumber)]: at };
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
    reset() {
      actions = structuredClone(EMPTY_ACTIONS);
      base = null;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
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
}

// ── Database implementation ─────────────────────────────────────────────
//
// NOT WRITTEN YET. This is the place for it.
//
// Reads: a signed-in member of staff can select the client tables through the
// "staff read …" policies in supabase/migrations/0007_staff.sql (profiles,
// monitoring_subscriptions, report_pulls, report_items, item_flags,
// attack_rounds, letters, letter_items, identity_documents, chat_messages,
// events). Map those rows to StaffClient.
//
// Writes: staff have no write policies. markRoundsSent, addNote and
// resolveException must call server routes that check is_staff() and write
// with the service role, so every staff action is validated and logged in one
// place. Notes, handled marks and the agreement date have no table yet.
//
// When it exists, return it from getStaffData() when Supabase is configured.

export function getStaffData(): StaffData {
  return demoData;
}
