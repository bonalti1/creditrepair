"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import { getStaffData } from "../staff/data";
import { buildDemoCommissions, buildDemoPartners } from "./demo";
import { checkProgramChange, PROGRAM_OFF, type PartnerProgram, type ProgramChangeInput } from "./program";
import { checkCommissionTerms, decidePartner, dollarsToCents, type CommissionRecord, type Partner } from "./rules";
import { demoShares, demoViews } from "./sharingDemo";
import type { StaffShareRow, StaffViewRow } from "./sharingStaff";

// Where the staff screens get the referral partners. Two implementations, like
// the console's clients (staff/data.ts): the demo (invented partners, plus
// what the person at the keyboard did, kept in this browser) and the database
// one (/api/staff/partners, which checks the role again).

export interface PartnerBook {
  partners: Partner[];
  /** Empty for a role that may not see them (sales). */
  commissions: CommissionRecord[];
  /** "Comisiones a socios" (program.ts). Off unless an administrator recorded the attorney's approval. */
  program: PartnerProgram;
  /** Who shares their progress with which partner, at what level (migration 0023). */
  shares: StaffShareRow[];
  /** Partner views of client pages, newest first. Administrators only; empty for others. */
  views: StaffViewRow[];
}

const EMPTY_BOOK: PartnerBook = { partners: [], commissions: [], program: PROGRAM_OFF, shares: [], views: [] };

export type PartnerResult = { ok: true } | { ok: false; message: string };

export interface PartnerData {
  readonly demo: boolean;
  load(): Promise<PartnerBook>;
  setStatus(id: string, status: string): Promise<PartnerResult>;
  setCommission(id: string, basis: string, amount: string, note: string): Promise<PartnerResult>;
  setSalesperson(id: string, handle: string | null): Promise<PartnerResult>;
  recordCommission(id: string, kind: "owed" | "paid", amount: string, note: string, by: string): Promise<PartnerResult>;
  setProgram(change: ProgramChangeInput, by: string): Promise<PartnerResult>;
  setLogo(id: string, status: "approved" | "rejected"): Promise<PartnerResult>;
}

// ── Demo ────────────────────────────────────────────────────────────────

const KEY = "credalti.demoPartners";

interface DemoPartnerActions {
  /** Partners as changed here, by id. */
  changed: Record<string, Partner>;
  /** Applications sent from /socios in this browser. */
  applied: Partner[];
  recorded: CommissionRecord[];
  /** "Comisiones a socios" as set here. Absent: off, like a new database. */
  program?: PartnerProgram;
}

/** The demo's program setting (also read by the demo portal and the "Cómo funciona" page). */
export function demoProgram(): PartnerProgram {
  if (typeof window === "undefined") return PROGRAM_OFF;
  return loadActions().program ?? PROGRAM_OFF;
}

function loadActions(): DemoPartnerActions {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { changed: {}, applied: [], recorded: [], ...(JSON.parse(raw) as Partial<DemoPartnerActions>) };
  } catch {
    // Storage unavailable: start clean.
  }
  return { changed: {}, applied: [], recorded: [] };
}

function saveActions(actions: DemoPartnerActions): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(actions));
  } catch {
    // The change lasts for this visit only.
  }
}

/** A /socios application in the demo: kept in this browser, shown on /equipo/socios. */
export function demoApply(partner: Partner): void {
  const actions = loadActions();
  saveActions({ ...actions, applied: [...actions.applied.filter((p) => p.phone !== partner.phone), partner] });
}

export function resetDemoPartners(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

function demoData(): PartnerData {
  const book = async (): Promise<PartnerBook> => {
    const now = new Date();
    const actions = loadActions();
    const program = actions.program ?? PROGRAM_OFF;
    // While commissions are off, the demo partners carry no terms and no records, as the database would refuse them.
    const partners = [...buildDemoPartners(now), ...actions.applied]
      .map((p) => (p.id === "p-jorge" ? { ...p, logoStatus: "pending" as const, logo: DEMO_LOGO } : p))
      .map((p) => actions.changed[p.id] ?? p)
      .map((p) => (program.commissionsEnabled ? p : { ...p, commissionBasis: "none" as const, commissionCents: 0 }));
    const clients = await getStaffData().listClients();
    return {
      partners,
      commissions: program.commissionsEnabled ? [...buildDemoCommissions(now), ...actions.recorded] : [],
      program,
      shares: demoShares(clients, now),
      views: demoViews(clients, now),
    };
  };
  const change = async (id: string, fn: (p: Partner, all: Partner[]) => Partner | string): Promise<PartnerResult> => {
    const { partners } = await book();
    const partner = partners.find((p) => p.id === id);
    if (!partner) return { ok: false, message: "No encontramos a ese socio." };
    const next = fn(partner, partners);
    if (typeof next === "string") return { ok: false, message: next };
    const actions = loadActions();
    saveActions({ ...actions, changed: { ...actions.changed, [id]: next } });
    return { ok: true };
  };
  return {
    demo: true,
    async load() {
      return book();
    },
    async setStatus(id, status) {
      return change(id, (p, all) => {
        const result = decidePartner(p, status, all.map((x) => x.referralCode).filter((c): c is string => Boolean(c)), new Date());
        return result.ok ? result.partner : result.message;
      });
    },
    async setCommission(id, basis, amount, note) {
      if (basis !== "none" && !(loadActions().program?.commissionsEnabled ?? false)) return { ok: false, message: PROGRAM_OFF_MESSAGE };
      const terms = checkCommissionTerms(basis, amount);
      if (!terms.ok) return { ok: false, message: terms.message };
      return change(id, (p) => ({ ...p, commissionBasis: terms.basis, commissionCents: terms.cents, commissionNote: note.trim() || null }));
    },
    async setSalesperson(id, handle) {
      return change(id, (p) => ({ ...p, salesperson: handle }));
    },
    async recordCommission(id, kind, amount, note, by) {
      if (!(loadActions().program?.commissionsEnabled ?? false)) return { ok: false, message: PROGRAM_OFF_MESSAGE };
      const cents = dollarsToCents(amount);
      if (cents === null || cents < 1) return { ok: false, message: "Escribe un monto válido." };
      const actions = loadActions();
      const record: CommissionRecord = { id: `pc-demo-${Date.now()}`, partnerId: id, kind, amountCents: cents, referralId: null, note: note.trim() || null, recordedAt: new Date().toISOString(), recordedBy: by };
      saveActions({ ...actions, recorded: [...actions.recorded, record] });
      return { ok: true };
    },
    async setProgram(input, by) {
      const checked = checkProgramChange(input);
      if (!checked.ok) return { ok: false, message: checked.message };
      const actions = loadActions();
      const program: PartnerProgram = { commissionsEnabled: checked.value.enabled, changedAt: new Date().toISOString(), changedBy: by, attorneyName: checked.value.attorneyName, attorneyApprovedOn: checked.value.attorneyApprovedOn };
      saveActions({ ...actions, program });
      return { ok: true };
    },
    async setLogo(id, status) {
      return change(id, (p) => ({ ...p, logoStatus: status }));
    },
  };
}

const PROGRAM_OFF_MESSAGE = "Las comisiones a socios están apagadas. Una persona administradora las enciende cuando el abogado lo apruebe.";

/** A plain square for the demo's logo waiting for review (a data URL: nothing loads from elsewhere). */
const DEMO_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' rx='16' fill='#1e3a8a'/><text x='40' y='50' font-family='Arial' font-size='26' font-weight='700' fill='#fbbf24' text-anchor='middle'>HV</text></svg>");

// ── Database ────────────────────────────────────────────────────────────

async function post(body: Record<string, unknown>): Promise<PartnerResult> {
  try {
    const res = await fetch("/api/staff/partners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, message: data.message ?? "No se pudo guardar. Inténtalo de nuevo." };
  } catch {
    return { ok: false, message: "No se pudo guardar. Revisa tu conexión." };
  }
}

function dbData(): PartnerData {
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/partners", { cache: "no-store" });
      if (!res.ok) return EMPTY_BOOK;
      return { ...EMPTY_BOOK, ...((await res.json()) as Partial<PartnerBook>) };
    },
    setStatus: (id, status) => post({ action: "set_status", id, status }),
    setCommission: (id, basis, amount, note) => post({ action: "set_commission", id, basis, amount, note }),
    setSalesperson: (id, handle) => post({ action: "set_salesperson", id, handle }),
    recordCommission: (id, kind, amount, note) => post({ action: "record_commission", id, kind, amount, note }),
    setProgram: (change) => post({ action: "set_program", ...change }),
    setLogo: (id, status) => post({ action: "set_logo", id, status }),
  };
}

let instance: PartnerData | null = null;

export function getPartnerData(): PartnerData {
  instance ??= isDemoMode() ? demoData() : dbData();
  return instance;
}

/** The partners for a staff screen. Call `reload` after a change. */
export function usePartners(enabled = true) {
  const data = getPartnerData();
  const [book, setBook] = useState<PartnerBook | null>(null);
  const reload = useCallback(async () => {
    setBook(enabled ? await data.load() : EMPTY_BOOK);
  }, [data, enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, book, ready: book !== null, reload };
}
