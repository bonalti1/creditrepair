"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePartners } from "../partners/data";
import { isDemoMode } from "../supabase/config";
import { useStaff } from "../staff/useStaff";
import { applyAction, type ActionContext } from "./actions";
import type { AccountingAction } from "./api";
import { collectionItems } from "./collections";
import { buildDemoBook, demoClosedMonth } from "./demo";
import { checkReceipt } from "./expenses";
import { chargeFacts } from "./facts";
import { snapshotOf, totalsFor, type BooksInput } from "./summary";
import { EMPTY_BOOK, type AccountingBook, type Bilingual } from "./types";

// Where the accounting screens read and write. Like the plan catalogue and
// the partners: the demo keeps the books in this browser (and says so); with
// a database, /api/staff/accounting, which checks the role again. The rules
// are the same pure function either way (actions.ts).

export type ActResult = { ok: true; message?: Bilingual | null } | { ok: false; message: Bilingual };

export interface AccountingData {
  readonly demo: boolean;
  load(seed: () => AccountingBook): Promise<AccountingBook>;
  act(action: AccountingAction, ctx: ActionContext): Promise<ActResult>;
  uploadReceipt(expenseId: string, file: File, ctx: ActionContext): Promise<ActResult>;
  receiptUrl(expenseId: string, ref: string): Promise<string | null>;
}

const DEMO_KEY = "credalti.staffDemo.accounting.v1";
/** Receipts above this are kept for this visit only in the demo (browser storage is small). */
const DEMO_RECEIPT_STORE_MAX = 1_500_000;

let memory: AccountingBook | null = null;

function readDemo(): AccountingBook | null {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as AccountingBook) : null;
  } catch {
    return null;
  }
}

function writeDemo(book: AccountingBook): void {
  memory = book;
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(book));
  } catch {
    // Full or unavailable: the change lasts for this visit.
  }
}

/** Demo only: put the example books back. */
export function resetDemoBooks(): void {
  memory = null;
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // nothing kept
  }
}

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function demoData(): AccountingData {
  return {
    demo: true,
    async load(seed) {
      const kept = readDemo();
      if (kept) return { ...seed(), ...kept, chargeMeta: seed().chargeMeta, demo: true };
      const fresh = seed();
      writeDemo(fresh);
      return fresh;
    },
    async act(action, ctx) {
      const book = readDemo() ?? EMPTY_BOOK;
      const result = applyAction(book, action, ctx);
      if (!result.ok) return result;
      writeDemo(result.book);
      return { ok: true, message: result.message ?? null };
    },
    async uploadReceipt(expenseId, file, ctx) {
      const book = readDemo() ?? EMPTY_BOOK;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = checkReceipt(bytes);
      if (!check.ok) return { ok: false, message: check.message };
      const expense = book.expenses.find((e) => e.id === expenseId);
      if (!expense || expense.voidedAt) return { ok: false, message: { en: "That expense is not in the books.", es: "Ese gasto no está en los libros." } };
      const ref = file.size <= DEMO_RECEIPT_STORE_MAX ? await toDataUrl(file) : "";
      const at = ctx.now.toISOString();
      const receipt = { name: file.name.slice(0, 200) || `receipt.${check.extension}`, kind: check.kind, bytes: bytes.length, ref, uploadedAt: at };
      writeDemo({
        ...book,
        expenses: book.expenses.map((e) => (e.id === expenseId ? { ...e, receipt } : e)),
        audit: [{ id: ctx.newId(), at, actor: ctx.actor, action: "receipt_attached", entity: "expense", entityId: expenseId, detail: { kind: check.kind, bytes: bytes.length } }, ...book.audit],
      });
      return { ok: true, message: ref ? null : { en: "Kept for this visit only (the demo stores receipts up to 1.5 MB).", es: "Guardado solo por esta visita (el demo guarda recibos de hasta 1.5 MB)." } };
    },
    async receiptUrl(_expenseId, ref) {
      return ref || null;
    },
  };
}

async function post(body: unknown): Promise<ActResult> {
  try {
    const res = await fetch("/api/staff/accounting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: Bilingual | null };
    if (res.ok && json.ok) return { ok: true, message: json.message ?? null };
    return { ok: false, message: json.message ?? { en: `The server refused it (${res.status}).`, es: `El servidor lo rechazó (${res.status}).` } };
  } catch {
    return { ok: false, message: { en: "No connection. Try again.", es: "Sin conexión. Inténtalo de nuevo." } };
  }
}

function dbData(): AccountingData {
  return {
    demo: false,
    async load() {
      const res = await fetch("/api/staff/accounting", { cache: "no-store" });
      if (!res.ok) return EMPTY_BOOK;
      return ((await res.json()) as { book: AccountingBook }).book;
    },
    act: (action) => post(action),
    async uploadReceipt(expenseId, file) {
      const form = new FormData();
      form.set("expenseId", expenseId);
      form.set("file", file);
      try {
        const res = await fetch("/api/staff/accounting/receipt", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: Bilingual };
        return res.ok && json.ok ? { ok: true } : { ok: false, message: json.message ?? { en: "The receipt could not be saved.", es: "No se pudo guardar el recibo." } };
      } catch {
        return { ok: false, message: { en: "No connection. Try again.", es: "Sin conexión. Inténtalo de nuevo." } };
      }
    },
    async receiptUrl(expenseId) {
      const res = await fetch(`/api/staff/accounting/receipt?expenseId=${encodeURIComponent(expenseId)}`, { cache: "no-store" });
      return res.ok ? ((await res.json()) as { url: string }).url : null;
    },
  };
}

let instance: AccountingData | null = null;

export function getAccountingData(): AccountingData {
  instance ??= isDemoMode() ? demoData() : dbData();
  return instance;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Everything an accounting screen needs, with the viewer's permission applied. */
export function useAccounting() {
  const staff = useStaff();
  const allowed = staff.can("accounting");
  const partners = usePartners(staff.ready && allowed);
  const data = getAccountingData();
  const [book, setBook] = useState<AccountingBook | null>(null);
  const { clients, now } = staff;

  const reload = useCallback(async () => {
    if (!staff.ready) return;
    if (!allowed) return setBook(EMPTY_BOOK);
    const loaded = await data.load(() => {
      const seed = buildDemoBook(clients, now);
      // The demo's closed month, with its figures as the rules compute them.
      const month = demoClosedMonth(now);
      const facts = chargeFacts(clients, seed.chargeMeta);
      const totals = totalsFor({ facts, expenses: seed.expenses, otherIncome: seed.otherIncome, commissions: [], collectionActions: seed.collectionActions }, [month]);
      return { ...seed, closes: [{ month, closedAt: new Date(now.getTime() - 20 * 86_400_000).toISOString(), closedBy: "carmen", totals: snapshotOf(totals), note: "Demo: closed after checking the bank statement." }] };
    });
    setBook(loaded);
  }, [staff.ready, allowed, data, clients, now]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const commissionsOn = Boolean(partners.book?.program.commissionsEnabled);
  const facts = useMemo(() => chargeFacts(clients, book?.chargeMeta ?? {}), [clients, book]);
  const input: BooksInput = useMemo(
    () => ({
      facts,
      expenses: book?.expenses ?? [],
      otherIncome: book?.otherIncome ?? [],
      // While "Comisiones a socios" is off the books show no commission figures (PARTNERS.md).
      commissions: commissionsOn ? (partners.book?.commissions ?? []) : [],
      collectionActions: book?.collectionActions ?? [],
    }),
    [facts, book, commissionsOn, partners.book],
  );

  const context = useCallback(
    (): ActionContext => ({
      actor: staff.viewer?.handle ?? "equipo",
      now: new Date(),
      newId,
      totalsFor: (month) => totalsFor(input, [month]),
      collections: collectionItems(facts, clients, book?.collectionActions ?? [], new Date()),
      chargeClient: new Map(facts.map((f) => [f.id, f.clientId])),
    }),
    [staff.viewer, input, facts, clients, book],
  );

  const act = useCallback(
    async (action: AccountingAction): Promise<ActResult> => {
      const result = await data.act(action, context());
      if (result.ok) await reload();
      return result;
    },
    [data, context, reload],
  );

  const uploadReceipt = useCallback(
    async (expenseId: string, file: File): Promise<ActResult> => {
      const result = await data.uploadReceipt(expenseId, file, context());
      if (result.ok) await reload();
      return result;
    },
    [data, context, reload],
  );

  return {
    staff,
    allowed,
    ready: staff.ready && book !== null && partners.ready,
    book: book ?? EMPTY_BOOK,
    facts,
    input,
    partners: partners.book,
    commissionsOn,
    act,
    uploadReceipt,
    receiptUrl: data.receiptUrl,
    demo: data.demo,
    reload,
  };
}
