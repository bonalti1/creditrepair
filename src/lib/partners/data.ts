"use client";

import { useCallback, useEffect, useState } from "react";
import { isDemoMode } from "../supabase/config";
import { buildDemoCommissions, buildDemoPartners } from "./demo";
import { checkCommissionTerms, decidePartner, dollarsToCents, type CommissionRecord, type Partner } from "./rules";

// Where the staff screens get the referral partners. Two implementations, like
// the console's clients (staff/data.ts): the demo (invented partners, plus
// what the person at the keyboard did, kept in this browser) and the database
// one (/api/staff/partners, which checks the role again).

export interface PartnerBook {
  partners: Partner[];
  /** Empty for a role that may not see them (sales). */
  commissions: CommissionRecord[];
}

export type PartnerResult = { ok: true } | { ok: false; message: string };

export interface PartnerData {
  readonly demo: boolean;
  load(): Promise<PartnerBook>;
  setStatus(id: string, status: string): Promise<PartnerResult>;
  setCommission(id: string, basis: string, amount: string, note: string): Promise<PartnerResult>;
  setSalesperson(id: string, handle: string | null): Promise<PartnerResult>;
  recordCommission(id: string, kind: "owed" | "paid", amount: string, note: string, by: string): Promise<PartnerResult>;
}

// ── Demo ────────────────────────────────────────────────────────────────

const KEY = "credalti.demoPartners";

interface DemoPartnerActions {
  /** Partners as changed here, by id. */
  changed: Record<string, Partner>;
  /** Applications sent from /socios in this browser. */
  applied: Partner[];
  recorded: CommissionRecord[];
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
  const book = (): PartnerBook => {
    const now = new Date();
    const actions = loadActions();
    const partners = [...buildDemoPartners(now), ...actions.applied].map((p) => actions.changed[p.id] ?? p);
    return { partners, commissions: [...buildDemoCommissions(now), ...actions.recorded] };
  };
  const change = (id: string, fn: (p: Partner, all: Partner[]) => Partner | string): PartnerResult => {
    const { partners } = book();
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
      const terms = checkCommissionTerms(basis, amount);
      if (!terms.ok) return { ok: false, message: terms.message };
      return change(id, (p) => ({ ...p, commissionBasis: terms.basis, commissionCents: terms.cents, commissionNote: note.trim() || null }));
    },
    async setSalesperson(id, handle) {
      return change(id, (p) => ({ ...p, salesperson: handle }));
    },
    async recordCommission(id, kind, amount, note, by) {
      const cents = dollarsToCents(amount);
      if (cents === null || cents < 1) return { ok: false, message: "Escribe un monto válido." };
      const actions = loadActions();
      const record: CommissionRecord = { id: `pc-demo-${Date.now()}`, partnerId: id, kind, amountCents: cents, referralId: null, note: note.trim() || null, recordedAt: new Date().toISOString(), recordedBy: by };
      saveActions({ ...actions, recorded: [...actions.recorded, record] });
      return { ok: true };
    },
  };
}

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
      if (!res.ok) return { partners: [], commissions: [] };
      return (await res.json()) as PartnerBook;
    },
    setStatus: (id, status) => post({ action: "set_status", id, status }),
    setCommission: (id, basis, amount, note) => post({ action: "set_commission", id, basis, amount, note }),
    setSalesperson: (id, handle) => post({ action: "set_salesperson", id, handle }),
    recordCommission: (id, kind, amount, note) => post({ action: "record_commission", id, kind, amount, note }),
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
    setBook(enabled ? await data.load() : { partners: [], commissions: [] });
  }, [data, enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, book, ready: book !== null, reload };
}
