import { isDemoMode } from "../supabase/config";
import {
  demoCatalogue,
  offeredPlan,
  planActivate,
  planDiscard,
  planRecordApproval,
  planRetire,
  planSaveDraft,
  planSetDefault,
  type ApprovalInput,
  type CatalogueResult,
  type DraftInput,
} from "./catalogue";
import { snapshotPlan, type PlanProblem, type PlanSnapshot, type PlanVersion } from "./plans";
import { SWITCHES_OFF, type BillingSwitches } from "./types";

// Where /equipo/planes reads and writes the catalogue. Like the letter editor
// (letters/versions/data.ts): the demo keeps it in this browser and says so;
// the database goes through /api/staff/plans. Picked by the one demo rule.

export interface PlanCatalogueData {
  readonly demo: boolean;
  list(): Promise<{ plans: PlanVersion[]; switches: BillingSwitches }>;
  saveDraft(input: DraftInput, by: string): Promise<CatalogueResult<PlanVersion>>;
  recordApproval(id: string, input: ApprovalInput): Promise<CatalogueResult<PlanVersion>>;
  activate(id: string): Promise<CatalogueResult<unknown>>;
  retire(id: string): Promise<CatalogueResult<unknown>>;
  setDefault(id: string): Promise<CatalogueResult<unknown>>;
  discard(id: string): Promise<CatalogueResult<unknown>>;
  setSwitch(input: { switch: "pay_per_delete" | "referral_credits"; enabled: boolean } & Partial<ApprovalInput> & { referralCreditCents?: number }): Promise<CatalogueResult<unknown>>;
}

// ── Demo ────────────────────────────────────────────────────────────────

const DEMO_KEY = "credalti.staffDemo.billingPlans.v1";
const SWITCH_KEY = "credalti.staffDemo.billingSwitches.v1";

function read<T>(key: string, fallback: () => T): T {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback();
  } catch {
    return fallback();
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the change lasts for this visit only.
  }
}

export function loadDemoPlans(): PlanVersion[] {
  return read(DEMO_KEY, () => demoCatalogue());
}

export function loadDemoSwitches(): BillingSwitches {
  return read(SWITCH_KEY, () => SWITCHES_OFF);
}

/** Demo only: put the example catalogue back. */
export function resetDemoPlans(): void {
  try {
    window.localStorage.removeItem(DEMO_KEY);
    window.localStorage.removeItem(SWITCH_KEY);
  } catch {
    // ignore
  }
}

/** The plan the demo's client would sign: the catalogue's default. */
export function demoOfferedPlan(): PlanSnapshot | null {
  const plan = offeredPlan(loadDemoPlans());
  return plan ? snapshotPlan(plan) : null;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Date.now().toString(36)}`);

function replace(changed: PlanVersion[]): void {
  const ids = new Set(changed.map((p) => p.id));
  write(DEMO_KEY, [...loadDemoPlans().filter((p) => !ids.has(p.id)), ...changed]);
}

export const demoPlanCatalogue: PlanCatalogueData = {
  demo: true,
  async list() {
    return { plans: loadDemoPlans(), switches: loadDemoSwitches() };
  },
  async saveDraft(input, by) {
    const result = planSaveDraft(loadDemoPlans(), input, by, new Date(), newId);
    if (!result.ok) return result;
    replace([result.value.version]);
    return { ok: true, value: result.value.version };
  },
  async recordApproval(id, input) {
    const result = planRecordApproval(loadDemoPlans(), id, input, new Date());
    if (result.ok) replace([result.value]);
    return result;
  },
  async activate(id) {
    const result = planActivate(loadDemoPlans(), id, new Date(), loadDemoSwitches());
    if (result.ok) replace(result.value);
    return result;
  },
  async retire(id) {
    const result = planRetire(loadDemoPlans(), id, new Date());
    if (result.ok) replace([result.value]);
    return result;
  },
  async setDefault(id) {
    const result = planSetDefault(loadDemoPlans(), id);
    if (result.ok) replace(result.value);
    return result;
  },
  async discard(id) {
    const result = planDiscard(loadDemoPlans(), id);
    if (result.ok) write(DEMO_KEY, loadDemoPlans().filter((p) => p.id !== id));
    return result;
  },
  async setSwitch(input) {
    if (input.enabled && (!input.attorneyName || input.attorneyName.trim().length < 3 || !input.approvedOn || !input.confirmed)) {
      return { ok: false, problems: [{ code: "invalid", field: "attorney", message: { en: "Record the attorney's name, the date and confirm the approval.", es: "Registra el nombre del abogado, la fecha y confirma la aprobación." } }] };
    }
    write(SWITCH_KEY, { ...loadDemoSwitches(), [input.switch === "pay_per_delete" ? "payPerDelete" : "referralCredits"]: input.enabled });
    return { ok: true, value: null };
  },
};

// ── Database ────────────────────────────────────────────────────────────

async function post<T>(body: Record<string, unknown>): Promise<CatalogueResult<T>> {
  try {
    const res = await fetch("/api/staff/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; problems?: PlanProblem[]; message?: string };
    if (res.ok && json.ok) return { ok: true, value: json.result as T };
    if (json.problems?.length) return { ok: false, problems: json.problems };
    const message = json.message ?? `HTTP ${res.status}`;
    return { ok: false, problems: [{ code: "invalid", field: "plan", message: { en: message, es: message } }] };
  } catch {
    return { ok: false, problems: [{ code: "invalid", field: "plan", message: { en: "Could not connect. Try again.", es: "No pudimos conectar. Intenta de nuevo." } }] };
  }
}

export const databasePlanCatalogue: PlanCatalogueData = {
  demo: false,
  async list() {
    const res = await fetch("/api/staff/plans", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not read the plans.");
    const body = (await res.json()) as { plans?: PlanVersion[]; switches?: BillingSwitches };
    return { plans: body.plans ?? [], switches: body.switches ?? SWITCHES_OFF };
  },
  saveDraft: (input) => post({ action: "save_draft", ...input }),
  recordApproval: (id, input) => post({ action: "record_approval", id, ...input }),
  activate: (id) => post({ action: "activate", id }),
  retire: (id) => post({ action: "retire", id }),
  setDefault: (id) => post({ action: "set_default", id }),
  discard: (id) => post({ action: "discard", id }),
  setSwitch: (input) => post({ action: "switch", ...input }),
};

export function getPlanCatalogue(): PlanCatalogueData {
  return isDemoMode() ? demoPlanCatalogue : databasePlanCatalogue;
}
