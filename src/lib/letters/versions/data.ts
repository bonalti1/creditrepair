import { isDemoMode } from "../../supabase/config";
import type { SourceProblem } from "./validate";
import {
  planDecision,
  planDiscard,
  planDraft,
  planSend,
  type DecisionInput,
  type LetterVersion,
  type VersionResult,
} from "./versions";

// Where the letter editor reads and writes versions.
//
// Like the console's other data (staff/data.ts, mail/data.ts), the screens
// only know this interface: the demo, which keeps the versions in this
// browser and says so on screen, or the database, through
// /api/staff/letters. Picked by the one demo rule (supabase/config.ts).

export type EditorResult<T> = { ok: true; value: T } | { ok: false; problems: SourceProblem[] };

export interface LetterVersionsData {
  readonly demo: boolean;
  /** Every version (the editor) or only the approved ones (previews and printing). */
  list(options?: { approvedOnly?: boolean }): Promise<{ versions: LetterVersion[]; allowUnapproved: boolean }>;
  saveDraft(input: { templateKey: string; subject: string; body: string }, by: string): Promise<EditorResult<LetterVersion>>;
  discardDraft(id: string): Promise<EditorResult<LetterVersion>>;
  sendToAttorney(templateKeys: string[], by: string): Promise<EditorResult<LetterVersion[]>>;
  recordDecision(id: string, input: DecisionInput, by: string): Promise<EditorResult<LetterVersion>>;
}

// ── Demo ────────────────────────────────────────────────────────────────

const DEMO_KEY = "credalti.staffDemo.letterVersions.v1";

let memory: LetterVersion[] | null = null;

export function loadDemoVersions(): LetterVersion[] {
  if (memory) return memory;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(DEMO_KEY);
    memory = raw ? (JSON.parse(raw) as LetterVersion[]) : [];
  } catch {
    memory = [];
  }
  return memory;
}

function saveDemoVersions(versions: LetterVersion[]): void {
  memory = versions;
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(versions));
  } catch {
    // Storage unavailable: the versions last for this visit.
  }
}

/** Demo only: forget the letter versions made in this browser. */
export function resetDemoLetterVersions(): void {
  memory = null;
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // ignore
  }
}

const demoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

function apply<T>(result: VersionResult<T>, write: (value: T) => LetterVersion[]): EditorResult<T> {
  if (!result.ok) return { ok: false, problems: result.problems };
  saveDemoVersions(write(result.value));
  return { ok: true, value: result.value };
}

export const demoLetterVersions: LetterVersionsData = {
  demo: true,
  async list(options = {}) {
    const all = loadDemoVersions();
    return { versions: options.approvedOnly ? all.filter((v) => v.status === "approved") : all, allowUnapproved: false };
  },
  async saveDraft(input, by) {
    const all = loadDemoVersions();
    const plan = planDraft(all, input, by, new Date(), demoId);
    if (!plan.ok) return { ok: false, problems: plan.problems };
    const { version, replaces } = plan.value;
    saveDemoVersions(replaces ? all.map((v) => (v.id === replaces.id ? version : v)) : [...all, version]);
    return { ok: true, value: version };
  },
  async discardDraft(id) {
    const all = loadDemoVersions();
    return apply(planDiscard(all, id), (gone) => all.filter((v) => v.id !== gone.id));
  },
  async sendToAttorney(templateKeys, by) {
    const sent: LetterVersion[] = [];
    let problems: SourceProblem[] = [];
    for (const key of [...new Set(templateKeys)]) {
      const all = loadDemoVersions();
      const plan = planSend(all, key, by, new Date(), demoId);
      if (!plan.ok) {
        problems = plan.problems;
        continue;
      }
      const { version, isNew } = plan.value;
      saveDemoVersions(isNew ? [...all, version] : all.map((v) => (v.id === version.id ? version : v)));
      sent.push(version);
    }
    return sent.length > 0 ? { ok: true, value: sent } : { ok: false, problems };
  },
  async recordDecision(id, input, by) {
    const all = loadDemoVersions();
    return apply(planDecision(all, id, input, by, new Date()), (decided) => all.map((v) => (v.id === decided.id ? decided : v)));
  },
};

// ── Database ────────────────────────────────────────────────────────────

async function post<T>(body: Record<string, unknown>): Promise<EditorResult<T>> {
  try {
    const res = await fetch("/api/staff/letters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; problems?: SourceProblem[]; error?: unknown; message?: string };
    if (res.ok && json.ok) return { ok: true, value: json.result as T };
    if (json.problems?.length) return { ok: false, problems: json.problems };
    const message = json.message || (typeof json.error === "string" ? json.error : "No se pudo guardar. Intenta de nuevo.");
    return { ok: false, problems: [{ code: `http_${res.status}`, message }] };
  } catch {
    return { ok: false, problems: [{ code: "network", message: "No pudimos conectar. Intenta de nuevo." }] };
  }
}

export const databaseLetterVersions: LetterVersionsData = {
  demo: false,
  async list(options = {}) {
    const res = await fetch(options.approvedOnly ? "/api/staff/letters/approved" : "/api/staff/letters", { cache: "no-store" });
    if (!res.ok) throw new Error("No pudimos leer las versiones de las cartas.");
    const body = (await res.json()) as { versions?: LetterVersion[]; allowUnapproved?: boolean };
    return { versions: body.versions ?? [], allowUnapproved: Boolean(body.allowUnapproved) };
  },
  saveDraft: (input) => post({ action: "save_draft", ...input }),
  discardDraft: (id) => post({ action: "discard_draft", id }),
  sendToAttorney: (templateKeys) => post({ action: "send_to_attorney", templateKeys }),
  recordDecision: (id, input) => post({ action: "record_decision", id, ...input }),
};

export function getLetterVersionsData(): LetterVersionsData {
  return isDemoMode() ? demoLetterVersions : databaseLetterVersions;
}
