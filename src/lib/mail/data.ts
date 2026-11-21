import type { StaffClient } from "../staff/types";
import {
  checkFurnisherInput,
  FURNISHER_SEED,
  furnisherChanges,
  type FurnisherEntry,
  type FurnisherInput,
} from "./furnishers";
import { isDemoMode } from "../supabase/config";
import { demoLetterMail } from "./demo";
import type { MailClass } from "./types";

// Where the console gets the furnisher address book and how it mails.
//
// Like StaffData (staff/data.ts), the pages only know this interface: the
// demo (the seed list plus whatever was saved in this browser) or the
// database, at the bottom, picked by the one demo rule (supabase/config.ts).

export type MailMode =
  /** A Lob key is configured on the server: letters really go out. */
  | "lob"
  /** No key, or the demo: sending records the round as sent and nothing is mailed. The screens say "simulado". */
  | "simulated";

export type FurnisherSaveResult = { ok: true; entry: FurnisherEntry } | { ok: false; problems: string[] };

export interface MailData {
  readonly mode: MailMode;
  /** The whole book, by name. */
  listFurnishers(): Promise<FurnisherEntry[]>;
  /**
   * Add an entry (no id) or change one. Checked with checkFurnisherInput; every
   * save adds a line to the entry's history (who, when, what changed), and no
   * line is ever edited or removed.
   */
  saveFurnisher(input: FurnisherInput, by: string): Promise<FurnisherSaveResult>;
}

// ── Demo implementation ─────────────────────────────────────────────────

const BOOK_KEY = "bonalti.staffDemo.furnishers.v1";
const SENDS_KEY = "bonalti.staffDemo.mailSends.v1";
const SEEDED_AT = "2026-11-21T12:00:00.000Z";

/** The seed as saved entries: each with its first history line. */
export function seededBook(): FurnisherEntry[] {
  return FURNISHER_SEED.map((seed) => ({
    ...seed,
    aliases: [...seed.aliases],
    addressLines: [...seed.addressLines],
    updatedAt: SEEDED_AT,
    updatedBy: "sistema",
    history: [{ at: SEEDED_AT, by: "sistema", changes: furnisherChanges(null, seed) }],
  }));
}

let memoryBook: FurnisherEntry[] | null = null;

/** The demo book as it stands in this browser. Synchronous: the demo's send rules read it. */
export function demoFurnisherBook(): FurnisherEntry[] {
  if (memoryBook) return memoryBook;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(BOOK_KEY);
    memoryBook = raw ? (JSON.parse(raw) as FurnisherEntry[]) : seededBook();
  } catch {
    memoryBook = seededBook();
  }
  return memoryBook;
}

function saveBook(book: FurnisherEntry[]): void {
  memoryBook = book;
  try {
    window.localStorage.setItem(BOOK_KEY, JSON.stringify(book));
  } catch {
    // Storage unavailable: the book lasts for this visit.
  }
}

/** Adds or changes one entry of a book. Pure apart from the id it makes up. */
export function saveToBook(book: FurnisherEntry[], input: FurnisherInput, by: string, now: Date): { book: FurnisherEntry[]; result: FurnisherSaveResult } {
  const check = checkFurnisherInput(input, book, now);
  if (!check.ok) return { book, result: { ok: false, problems: check.problems } };
  const at = now.toISOString();
  const who = by.trim() || "equipo";
  const before = check.value.id ? book.find((entry) => entry.id === check.value.id) ?? null : null;
  if (check.value.id && !before) return { book, result: { ok: false, problems: ["No encontramos esa empresa en la libreta."] } };
  const { id: _id, ...fields } = check.value;
  const changes = furnisherChanges(before, fields);
  if (before && changes.length === 0) return { book, result: { ok: true, entry: before } };
  const entry: FurnisherEntry = {
    ...fields,
    id: before?.id ?? `f-${now.getTime().toString(36)}`,
    updatedAt: at,
    updatedBy: who,
    history: [...(before?.history ?? []), { at, by: who, changes }],
  };
  const next = before ? book.map((e) => (e.id === before.id ? entry : e)) : [...book, entry];
  return { book: next.sort((a, b) => a.name.localeCompare(b.name, "es")), result: { ok: true, entry } };
}

const demoMail: MailData & { reset(): void } = {
  // The demo never mails: there is no key in a browser, and the clients are invented.
  mode: "simulated",
  async listFurnishers() {
    return [...demoFurnisherBook()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
  async saveFurnisher(input, by) {
    const { book, result } = saveToBook(demoFurnisherBook(), input, by, new Date());
    if (result.ok) saveBook(book);
    return result;
  },
  reset() {
    memoryBook = null;
    try {
      window.localStorage.removeItem(BOOK_KEY);
      window.localStorage.removeItem(SENDS_KEY);
    } catch {
      // ignore
    }
  },
};

// ── Demo sends ──────────────────────────────────────────────────────────

/** What one demo send recorded for a round: the class and the address of each letter. */
export interface DemoSend {
  /** "print": printed in the office and mailed by hand. */
  via?: "simulated" | "print";
  classes: Record<string, MailClass>;
  addresses: Record<string, { name: string; addressLines: string[] }>;
}

/** clientId → round number → what the send recorded. */
export type DemoSends = Record<string, Record<string, DemoSend>>;

export function loadDemoSends(): DemoSends {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(SENDS_KEY);
    return raw ? (JSON.parse(raw) as DemoSends) : {};
  } catch {
    return {};
  }
}

export function recordDemoSend(clientId: string, roundNumber: number, send: DemoSend): void {
  const sends = loadDemoSends();
  sends[clientId] = { ...sends[clientId], [String(roundNumber)]: send };
  try {
    window.localStorage.setItem(SENDS_KEY, JSON.stringify(sends));
  } catch {
    // Storage unavailable: the round still shows as sent, with default classes.
  }
}

/**
 * The demo clients with the mail record of each round sent in this browser:
 * the class chosen, the address used, and a "mailed" event on the day it was
 * sent. Simulated: nothing reached a post office, so nothing more happens.
 */
export function applyDemoSends(clients: StaffClient[], sends: DemoSends): StaffClient[] {
  return clients.map((client) => {
    const mine = sends[client.id];
    if (!mine) return client;
    return {
      ...client,
      rounds: client.rounds.map((round) => {
        const send = mine[String(round.number)];
        if (!send || !round.mailedAt || round.status !== "mailed") return round;
        return {
          ...round,
          letters: round.letters.map((letter) => {
            const to = send.addresses[letter.id];
            const recipient = to ? { ...letter.recipient, name: to.name, addressLines: to.addressLines } : letter.recipient;
            const sent = { ...letter, recipient, mailClass: send.classes[letter.id] ?? letter.mailClass };
            const mail = demoLetterMail(sent, round.mailedAt!, "in_transit", sent.mailClass);
            // A printed letter has no tracking number unless someone types one in; the simulated one has none either.
            return { ...sent, mail: { ...mail, provider: send.via === "print" ? ("print" as const) : mail.provider, trackingNumber: null, events: mail.events.slice(0, 1) } };
          }),
        };
      }),
    };
  });
}

/** Demo only: forget the address book edits and the sends made in this browser. */
export function resetDemoMail(): void {
  demoMail.reset();
}

// ── Database implementation ─────────────────────────────────────────────
//
// Selected when Supabase is configured (supabase/config.ts), like the staff
// data. It holds nothing of its own:
//   - listFurnishers and mode: GET /api/staff/mail, read through the member's
//     own connection ("staff read furnishers", migration 0013); "lob" when the
//     server has LOB_API_KEY (the key never reaches the browser), else
//     "simulated". Until the first read answers, the mode reads "simulated".
//   - saveFurnisher: POST /api/furnishers, which checks the member's role
//     (rounds.send), runs checkFurnisherInput on the server and writes with
//     the service role. The history line is written by the database itself
//     (furnishers_history trigger), signed with the member's own handle.

export function createDatabaseMailData(): MailData {
  let mode: MailMode = "simulated";
  return {
    get mode() {
      return mode;
    },
    async listFurnishers() {
      const res = await fetch("/api/staff/mail", { cache: "no-store" });
      if (!res.ok) throw new Error("No pudimos leer la libreta de direcciones.");
      const body = (await res.json()) as { mode?: MailMode; furnishers?: FurnisherEntry[] };
      mode = body.mode === "lob" ? "lob" : "simulated";
      return [...(body.furnishers ?? [])].sort((a, b) => a.name.localeCompare(b.name, "es"));
    },
    async saveFurnisher(input) {
      try {
        const res = await fetch("/api/furnishers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
        const body = (await res.json().catch(() => ({}))) as { entry?: FurnisherEntry; problems?: string[]; error?: string };
        if (res.ok && body.entry) return { ok: true, entry: body.entry };
        return { ok: false, problems: body.problems?.length ? body.problems : [body.error || "No se pudo guardar. Intenta de nuevo."] };
      } catch {
        return { ok: false, problems: ["No pudimos conectar. Intenta de nuevo."] };
      }
    },
  };
}

let databaseMail: MailData | null = null;

/** The address book and mail mode: the database when Supabase is configured, the demo otherwise. */
export function getMailData(): MailData {
  if (isDemoMode()) return demoMail;
  databaseMail ??= createDatabaseMailData();
  return databaseMail;
}
