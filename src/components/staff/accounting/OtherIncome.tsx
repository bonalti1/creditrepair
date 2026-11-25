"use client";

import { useState } from "react";
import { parseCsv, parseDay } from "@/lib/accounting/csv";
import type { useAccounting } from "@/lib/accounting/data";
import { formatCents, parseMoney, parsePositiveAmount } from "@/lib/accounting/money";
import { dayOf } from "@/lib/accounting/periods";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import { PRIMARY_BUTTON, QUIET_BUTTON } from "@/components/staff/ui";
import { CONTROL, Field, Note, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

// Money that does not come from a client's charge: IdentityIQ's referral
// commissions (IDENTITYIQ.md), interest, other. Entered by hand, or brought in
// from a CSV of the provider's statement (a date and an amount per line; the
// same date, amount and source already in the books is skipped).

export default function OtherIncomeCard({ acc }: { acc: Acc }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const today = dayOf(new Date());
  const [form, setForm] = useState({ kind: "monitoring_commission" as "monitoring_commission" | "other", source: "IdentityIQ (IDIQ)", receivedOn: today, amount: "", note: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const live = acc.book.otherIncome.filter((i) => !i.voidedAt);

  const save = async () => {
    const cents = parsePositiveAmount(form.amount);
    if (cents === null) return setMessage({ tone: "bad", text: t("Escribe el monto, como 40.00.", "Write the amount, like 40.00.") });
    const result = await acc.act({ action: "add_income", kind: form.kind, source: form.source, receivedOn: form.receivedOn, amountCents: cents, note: form.note });
    if (!result.ok) return setMessage({ tone: "bad", text: bi(result.message) });
    setForm({ ...form, amount: "", note: "" });
    setMessage({ tone: "ok", text: t("Ingreso registrado.", "Income recorded.") });
  };

  const importFile = async (file: File) => {
    const rows = parseCsv(await file.text());
    const header = (rows[0] ?? []).map((h) => h.toLowerCase());
    const di = header.findIndex((h) => /date|fecha|paid/.test(h));
    const ai = header.findIndex((h) => /amount|commission|monto|payout/.test(h));
    if (di < 0 || ai < 0) return setMessage({ tone: "bad", text: t("El archivo necesita una columna de fecha y una de monto.", "The file needs a date column and an amount column.") });
    let added = 0;
    let skipped = 0;
    for (const r of rows.slice(1, 400)) {
      const day = parseDay(r[di] ?? "");
      const cents = parseMoney(r[ai] ?? "");
      if (!day || cents === null || cents <= 0 || live.some((i) => i.receivedOn === day && i.amountCents === cents && i.source === form.source)) {
        skipped += 1;
        continue;
      }
      const result = await acc.act({ action: "add_income", kind: "monitoring_commission", source: form.source, receivedOn: day, amountCents: cents, note: `Imported from ${file.name}`.slice(0, 500) });
      if (result.ok) added += 1;
      else skipped += 1;
    }
    setMessage({ tone: "ok", text: t(`${added} línea(s) agregada(s), ${skipped} sin agregar (repetidas, de un mes cerrado o ilegibles).`, `${added} line(s) added, ${skipped} left out (repeated, in a closed month or unreadable).`) });
  };

  return (
    <div className="card px-5 py-4" data-testid="other-income">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t("Tipo", "Type")}>
          <select className={CONTROL} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}>
            <option value="monitoring_commission">{t("Comisión de monitoreo", "Monitoring commission")}</option>
            <option value="other">{t("Otro ingreso", "Other income")}</option>
          </select>
        </Field>
        <Field label={t("De quién", "From")}>
          <input className={CONTROL} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </Field>
        <Field label={t("Recibido el", "Received on")}>
          <input className={CONTROL} type="date" max={today} value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} />
        </Field>
        <Field label={t("Monto", "Amount")}>
          <input className={CONTROL} inputMode="decimal" placeholder="40.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label={t("Nota", "Note")}>
          <input className={CONTROL} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY_BUTTON} onClick={save} data-testid="add-income">
          {t("Registrar ingreso", "Record income")}
        </button>
        <label className={`${QUIET_BUTTON} relative cursor-pointer`}>
          {t("Importar CSV del proveedor", "Import the provider's CSV")}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
      </div>
      {message && (
        <div className="mt-3">
          <Note tone={message.tone}>{message.text}</Note>
        </div>
      )}
      <ul className="mt-4 divide-y divide-slate-900/[0.06]">
        {live.slice(0, 12).map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
            <span className="min-w-0">
              <span className="font-medium text-slate-900">{i.source}</span>
              <span className="ml-2 text-slate-500">{shortDay(`${i.receivedOn}T18:00:00Z`, locale)} · {i.note}</span>
            </span>
            <span className="tabular-nums text-slate-900">{formatCents(i.amountCents)}</span>
          </li>
        ))}
        {live.length === 0 && <li className="py-2 text-[14px] text-slate-500">{t("Sin datos todavía.", "No data yet.")}</li>}
      </ul>
    </div>
  );
}
