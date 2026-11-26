import { DEMO_SAVED_ANSWERS, type SavedAnswer } from "../staff/answers";
import { checkStaffReply, type ReplyProblem } from "../staff/conversation";
import { can, type Viewer } from "../staff/permissions";
import type { StaffLocale } from "../staff/i18n/locale";
import { isDemoMode } from "../supabase/config";
import { buildDemoLeadRecords, latestHandoff, withFacts, type DemoLead } from "./demo";
import { demoLeadFunnelsHere } from "../live/data";
import type { LeadDraftOutcome } from "./drafts";
import { isPersonStage, leadLanguage, whatsappWindow } from "./inbox";
import { LEAD_FOLLOWUP_TEMPLATE, renderLeadTemplate } from "./templates";
import { DEFAULT_LEAD_AUTOPILOT, type Lead, type LeadAutoMessage, type LeadAutopilotSettings, type LeadMessage, type LeadNote, type LeadStageEvent, type LeadThread, type PersonStage } from "./types";

// Where the lead inbox's screens get their leads and record what a teammate
// does. Two implementations, picked by the one demo rule (supabase/config.ts):
// the demo (invented leads, demo.ts, plus what the person at the keyboard did,
// kept in this browser; nothing is sent) and the database one (the
// /api/staff/leads routes, which check everything again on the server).

export type LeadActionOutcome = { ok: true } | { ok: false; message: string; problems?: ReplyProblem[] };

export interface LeadList {
  leads: Lead[];
  /** Approved WhatsApp templates the server may send outside the 24-hour window. */
  templates: string[];
  /** WhatsApp is connected on the server (always "simulated" in the demo). */
  whatsapp: boolean;
  /** The team's approved saved answers (general words, no client's details), for the reply box. */
  answers: SavedAnswer[];
}

export interface AutopilotView {
  settings: LeadAutopilotSettings;
  recent: Array<LeadAutoMessage & { leadId: string }>;
  whatsapp: boolean;
}

export interface LeadData {
  readonly demo: boolean;
  list(): Promise<LeadList>;
  thread(id: string): Promise<LeadThread | null>;
  reply(id: string, text: string): Promise<LeadActionOutcome>;
  sendTemplate(id: string, template: string): Promise<LeadActionOutcome>;
  note(id: string, text: string): Promise<LeadActionOutcome>;
  move(id: string, to: PersonStage): Promise<LeadActionOutcome>;
  assign(id: string, to: string | null): Promise<LeadActionOutcome>;
  invited(id: string): Promise<void>;
  suggest(id: string): Promise<LeadDraftOutcome & { demoDraft?: boolean }>;
  autopilot(): Promise<AutopilotView>;
  saveAutopilot(patch: Partial<LeadAutopilotSettings>): Promise<LeadActionOutcome>;
}

const W: Record<StaffLocale, Record<string, string>> = {
  en: {
    notAllowed: "Your role doesn't work leads.",
    notYours: "This lead is another salesperson's. Ask an administrator to reassign it.",
    optedOut: "They asked us to stop writing (STOP). Nothing can be sent until they write START.",
    windowClosed: "More than 24 hours since their last message: WhatsApp only allows an approved template now.",
    windowOpen: "Their WhatsApp window is open: write a normal reply instead.",
    notFound: "We couldn't find this lead.",
    signed: "Signed is set by itself when they sign, and Invited when the invitation goes out.",
    same: "The lead is already in that stage.",
    assign: "Only an administrator assigns leads to someone else. You can take one that nobody has.",
    admin: "Only an administrator can set up the autopilot.",
    offline: "We couldn't connect. Check your connection and try again.",
  },
  es: {
    notAllowed: "Tu rol no atiende prospectos.",
    notYours: "Este prospecto es de otra persona de ventas. Pide a un administrador que lo reasigne.",
    optedOut: "Pidió que no le escribamos (BAJA). No se puede enviar nada hasta que escriba ALTA.",
    windowClosed: "Pasaron más de 24 horas desde su último mensaje: WhatsApp solo permite una plantilla aprobada.",
    windowOpen: "Su ventana de WhatsApp está abierta: escribe una respuesta normal.",
    notFound: "No encontramos este prospecto.",
    signed: "«Firmó» se pone solo cuando firma, e «Invitado» cuando sale la invitación.",
    same: "El prospecto ya está en esa etapa.",
    assign: "Solo un administrador asigna prospectos a otra persona. Puedes tomar uno que no tiene nadie.",
    admin: "Solo un administrador configura el piloto automático.",
    offline: "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
  },
};

// ── Demo ────────────────────────────────────────────────────────────────

const DEMO_KEY = "credalti.demo.leads.v1";

interface DemoLeadActions {
  replies: Record<string, LeadMessage[]>;
  notes: Record<string, LeadNote[]>;
  moves: Record<string, LeadStageEvent[]>;
  assigned: Record<string, { to: string | null; at: string }>;
  invited: Record<string, string>;
  autopilot: Partial<LeadAutopilotSettings>;
}

const EMPTY: DemoLeadActions = { replies: {}, notes: {}, moves: {}, assigned: {}, invited: {}, autopilot: {} };

function readDemo(): DemoLeadActions {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<DemoLeadActions>) } : structuredClone(EMPTY);
  } catch {
    return structuredClone(EMPTY);
  }
}

function writeDemo(actions: DemoLeadActions): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(actions));
  } catch {
    // Storage full or blocked: the action lasts for this visit only.
  }
}

export function resetDemoLeads(): void {
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing kept.
  }
}

/** The invented leads with what was done to them in this browser. */
export function applyDemoLeadActions(records: DemoLead[], actions: DemoLeadActions): DemoLead[] {
  return records.map((entry) => {
    const id = entry.lead.id;
    let next: DemoLead = { ...entry, messages: [...entry.messages, ...(actions.replies[id] ?? [])], notes: [...entry.notes, ...(actions.notes[id] ?? [])] };
    const moves = actions.moves[id] ?? [];
    const lastMove = moves[moves.length - 1];
    const assigned = actions.assigned[id];
    next = {
      ...next,
      stageEvents: [...entry.stageEvents, ...moves],
      lead: {
        ...next.lead,
        ...(lastMove ? { stage: lastMove.to, stageAt: lastMove.at } : {}),
        ...(assigned ? { salesperson: assigned.to, assignedAt: assigned.at } : {}),
        ...(actions.invited[id] && !next.lead.invitedAt ? { invitedAt: actions.invited[id] } : {}),
      },
    };
    next = withFacts(next);
    return { ...next, lead: { ...next.lead, handoff: latestHandoff(next) } };
  });
}

function mayWork(viewer: Viewer | null, lead: Lead): boolean {
  if (!viewer || !can(viewer.role, "leads.work")) return false;
  return viewer.role === "admin" || lead.salesperson === null || lead.salesperson === viewer.handle;
}

export function createDemoLeadData(viewer: Viewer | null, locale: StaffLocale): LeadData {
  const w = W[locale];
  const now = () => new Date();
  const records = () => {
    const at = now();
    // Three invented leads came through the live funnel (live/demoFunnels.ts): their funnel line, with what
    // was done in this browser's review queue and on the demo video page (live/data.ts).
    const funnels = demoLeadFunnelsHere(at);
    return applyDemoLeadActions(buildDemoLeadRecords(at), readDemo())
      .filter((e) => mayWork(viewer, e.lead))
      .map((e) => (funnels[e.lead.id] ? { ...e, lead: { ...e.lead, funnel: funnels[e.lead.id]! } } : e));
  };
  const find = (id: string) => records().find((e) => e.lead.id === id) ?? null;
  const save = (edit: (a: DemoLeadActions) => void) => {
    const a = readDemo();
    edit(a);
    writeDemo(a);
  };
  const author = () => (viewer?.name.split(" ")[0] ?? viewer?.handle ?? "");
  const guard = (id: string): { entry: DemoLead } | { ok: false; message: string } => {
    if (!viewer || !can(viewer.role, "leads.work")) return { ok: false, message: w.notAllowed };
    const entry = find(id);
    return entry ? { entry } : { ok: false, message: w.notFound };
  };
  const settings = (): LeadAutopilotSettings => ({ ...DEFAULT_LEAD_AUTOPILOT, ...readDemo().autopilot });
  return {
    demo: true,
    async list() {
      return { leads: records().map((e) => e.lead), templates: [LEAD_FOLLOWUP_TEMPLATE.name], whatsapp: true, answers: DEMO_SAVED_ANSWERS.filter((a) => a.status === "approved") };
    },
    async thread(id) {
      const entry = find(id);
      return entry ? { lead: entry.lead, messages: entry.messages, notes: entry.notes, stageEvents: entry.stageEvents, autoMessages: entry.autoMessages, external: null } : null;
    },
    async reply(id, text) {
      const g = guard(id);
      if ("ok" in g) return g;
      const { lead } = g.entry;
      if (lead.optedOutAt) return { ok: false, message: w.optedOut };
      if (whatsappWindow(lead.lastInboundAt, now()).state === "closed") return { ok: false, message: w.windowClosed };
      const problems = checkStaffReply(text, locale);
      if (problems.length > 0) return { ok: false, message: problems.map((p) => p.why).join(" "), problems };
      save((a) => {
        a.replies[id] = [...(a.replies[id] ?? []), { id: `r-${Date.now()}`, at: now().toISOString(), role: "assistant", source: "human", authorName: author(), text: text.trim() }];
      });
      return { ok: true };
    },
    async sendTemplate(id) {
      const g = guard(id);
      if ("ok" in g) return g;
      const { lead } = g.entry;
      if (lead.optedOutAt) return { ok: false, message: w.optedOut };
      if (whatsappWindow(lead.lastInboundAt, now()).state === "open") return { ok: false, message: w.windowOpen };
      const text = renderLeadTemplate(LEAD_FOLLOWUP_TEMPLATE, leadLanguage(lead), [lead.name?.split(" ")[0] ?? "", author()]);
      save((a) => {
        a.replies[id] = [...(a.replies[id] ?? []), { id: `t-${Date.now()}`, at: now().toISOString(), role: "assistant", source: "human", authorName: author(), text }];
      });
      return { ok: true };
    },
    async note(id, text) {
      const g = guard(id);
      if ("ok" in g) return g;
      save((a) => {
        a.notes[id] = [...(a.notes[id] ?? []), { id: `n-${Date.now()}`, at: now().toISOString(), author: author(), text: text.trim() }];
      });
      return { ok: true };
    },
    async move(id, to) {
      const g = guard(id);
      if ("ok" in g) return g;
      if (!isPersonStage(to)) return { ok: false, message: w.signed };
      if (g.entry.lead.stage === to) return { ok: false, message: w.same };
      save((a) => {
        a.moves[id] = [...(a.moves[id] ?? []), { id: `m-${Date.now()}`, at: now().toISOString(), from: g.entry.lead.stage, to, by: viewer?.handle ?? "" }];
      });
      return { ok: true };
    },
    async assign(id, to) {
      const g = guard(id);
      if ("ok" in g) return g;
      const others = can(viewer?.role, "clients.assign");
      if (!others && !(g.entry.lead.salesperson === null && to === viewer?.handle)) return { ok: false, message: w.assign };
      save((a) => {
        a.assigned[id] = { to, at: now().toISOString() };
      });
      return { ok: true };
    },
    async invited(id) {
      save((a) => {
        a.invited[id] ??= now().toISOString();
      });
    },
    async suggest(id) {
      try {
        const res = await fetch("/api/staff/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "suggest", id, locale, viewAs: viewer?.role }) });
        return (await res.json()) as LeadDraftOutcome & { demoDraft?: boolean };
      } catch {
        return { ok: false, code: "model_error", message: w.offline, savedAnswer: null };
      }
    },
    async autopilot() {
      const recent = buildDemoLeadRecords(now()).flatMap((e) => e.autoMessages.map((m) => ({ ...m, leadId: e.lead.id }))).sort((a, b) => b.at.localeCompare(a.at));
      return { settings: settings(), recent, whatsapp: true };
    },
    async saveAutopilot(patch) {
      if (!can(viewer?.role, "autopilot.manage")) return { ok: false, message: w.admin };
      const current = settings();
      const turnedOn = !current.enabled && patch.enabled === true;
      save((a) => {
        a.autopilot = { ...a.autopilot, ...patch, updatedAt: now().toISOString(), updatedBy: viewer?.name ?? null, ...(turnedOn ? { enabledAt: now().toISOString() } : {}) };
      });
      return { ok: true };
    },
  };
}

// ── Database ────────────────────────────────────────────────────────────

async function call(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export function createDatabaseLeadData(locale: StaffLocale): LeadData {
  const w = W[locale];
  const outcome = (answer: { ok: boolean; data: Record<string, unknown> }): LeadActionOutcome =>
    answer.ok
      ? { ok: true }
      : {
          ok: false,
          message: typeof answer.data.message === "string" ? answer.data.message : w.offline,
          problems: Array.isArray(answer.data.problems) ? (answer.data.problems as ReplyProblem[]) : undefined,
        };
  const act = async (body: Record<string, unknown>) => outcome(await call("/api/staff/leads", { ...body, locale }));
  return {
    demo: false,
    async list() {
      const answer = await call("/api/staff/leads");
      if (!answer.ok) throw new Error(typeof answer.data.message === "string" ? answer.data.message : w.offline);
      return { leads: (answer.data.leads as Lead[]) ?? [], templates: (answer.data.templates as string[]) ?? [], whatsapp: answer.data.whatsapp === true, answers: (answer.data.answers as SavedAnswer[]) ?? [] };
    },
    async thread(id) {
      const answer = await call(`/api/staff/leads?id=${encodeURIComponent(id)}`);
      return answer.ok ? ((answer.data.thread as LeadThread) ?? null) : null;
    },
    reply: (id, text) => act({ action: "reply", id, text }),
    sendTemplate: (id, template) => act({ action: "template", id, template }),
    note: (id, text) => act({ action: "note", id, text }),
    move: (id, to) => act({ action: "stage", id, to }),
    assign: (id, to) => act({ action: "assign", id, to }),
    async invited(id) {
      await call("/api/staff/leads", { action: "invited", id, locale });
    },
    async suggest(id) {
      const answer = await call("/api/staff/leads", { action: "suggest", id, locale });
      return answer.data as unknown as LeadDraftOutcome;
    },
    async autopilot() {
      const answer = await call("/api/staff/leads/autopilot");
      if (!answer.ok) throw new Error(w.offline);
      return answer.data as unknown as AutopilotView;
    },
    async saveAutopilot(patch) {
      const { enabled, replyDelaySeconds, perLeadDailyCap, dailyCap, quietStartHour, quietEndHour, sendSignupLink } = patch;
      const body = Object.fromEntries(Object.entries({ enabled, replyDelaySeconds, perLeadDailyCap, dailyCap, quietStartHour, quietEndHour, sendSignupLink }).filter(([, v]) => v !== undefined));
      return outcome(await call("/api/staff/leads/autopilot", body));
    },
  };
}

export function getLeadData(viewer: Viewer | null, locale: StaffLocale): LeadData {
  return isDemoMode() ? createDemoLeadData(viewer, locale) : createDatabaseLeadData(locale);
}

