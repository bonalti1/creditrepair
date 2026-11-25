"use client";

import { useMemo, useState } from "react";
import { monthsToPost } from "@/lib/accounting/actions";
import { CATEGORIES, category, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type CategoryKey, type PaymentMethod } from "@/lib/accounting/categories";
import type { useAccounting } from "@/lib/accounting/data";
import { activeExpenses, isClosed, RECEIPT_MAX_BYTES, recurringDue } from "@/lib/accounting/expenses";
import { formatCents, parseMoney, parsePositiveAmount } from "@/lib/accounting/money";
import { dayOf, monthLabel, monthOf, type MonthKey } from "@/lib/accounting/periods";
import { expensesCsv } from "@/lib/accounting/reports";
import type { Expense } from "@/lib/accounting/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import Icon from "@/components/Icon";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL, CONTROL_INLINE, download, Field, Money, Note, TableCard, TD, TH, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

interface FormState {
  id: string | null;
  spentOn: string;
  amount: string;
  category: CategoryKey;
  vendor: string;
  description: string;
  paymentMethod: PaymentMethod;
  adjustment: boolean;
}

const blank = (today: string): FormState => ({ id: null, spentOn: today, amount: "", category: "advertising_meta", vendor: "", description: "", paymentMethod: "business_card", adjustment: false });

export default function Expenses({ acc, month }: { acc: Acc; month: MonthKey }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const today = dayOf(acc.staff.now.getTime() ? acc.staff.now : new Date());
  const [form, setForm] = useState<FormState>(blank(today));
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [filter, setFilter] = useState<CategoryKey | "all">("all");
  const [preview, setPreview] = useState<{ expense: Expense; url: string | null } | null>(null);
  const closes = acc.book.closes;
  const monthClosed = isClosed(month, closes);
  const list = useMemo(
    () => activeExpenses(acc.book.expenses).filter((e) => monthOf(e.spentOn) === month && (filter === "all" || e.category === filter)).sort((a, b) => b.spentOn.localeCompare(a.spentOn)),
    [acc.book.expenses, month, filter],
  );
  const total = list.reduce((a, e) => a + e.amountCents, 0);
  const due = recurringDue(acc.book.recurring, acc.book.expenses, monthsToPost(acc.book, new Date()), today, closes);
  const formClosed = isClosed(monthOf(form.spentOn || today), closes);

  const save = async () => {
    const cents = form.adjustment ? parseMoney(form.amount) : parsePositiveAmount(form.amount);
    if (cents === null || cents === 0) return setMessage({ tone: "bad", text: t("Escribe el monto, como 49.99.", "Write the amount, like 49.99.") });
    const fields = { spentOn: form.spentOn, amountCents: cents, category: form.category, vendor: form.vendor, description: form.description, paymentMethod: form.paymentMethod };
    const result = form.id ? await acc.act({ action: "update_expense", id: form.id, ...fields }) : form.adjustment ? await acc.act({ action: "add_adjustment", ...fields }) : await acc.act({ action: "add_expense", ...fields });
    if (!result.ok) return setMessage({ tone: "bad", text: bi(result.message) });
    setMessage({ tone: "ok", text: form.id ? t("Gasto actualizado.", "Expense updated.") : form.adjustment ? t("Ajuste registrado.", "Adjustment recorded.") : t("Gasto registrado. Puedes adjuntar el recibo en la lista.", "Expense recorded. You can attach the receipt in the list.") });
    setForm(blank(today));
  };

  const voidIt = async (e: Expense) => {
    const reason = window.prompt(t("¿Por qué se anula? (5 caracteres o más)", "Why void it? (5 characters or more)"));
    if (!reason) return;
    const result = await acc.act({ action: "void_expense", id: e.id, reason });
    setMessage(result.ok ? { tone: "ok", text: t("Gasto anulado. Queda en el registro.", "Expense voided. It stays on the record.") } : { tone: "bad", text: bi(result.message) });
  };

  const attach = async (e: Expense, file: File) => {
    if (file.size > RECEIPT_MAX_BYTES) return setMessage({ tone: "bad", text: t("El recibo pesa más de 10 MB.", "The receipt is over 10 MB.") });
    const result = await acc.uploadReceipt(e.id, file);
    setMessage(result.ok ? { tone: result.message ? "warn" : "ok", text: result.message ? bi(result.message) : t("Recibo guardado.", "Receipt saved.") } : { tone: "bad", text: bi(result.message) });
  };

  const view = async (e: Expense) => setPreview({ expense: e, url: e.receipt ? await acc.receiptUrl(e.id, e.receipt.ref) : null });

  const postDue = async () => {
    const result = await acc.act({ action: "post_recurring" });
    setMessage(result.ok ? { tone: "ok", text: bi(result.message) || t("Listo.", "Done.") } : { tone: "bad", text: bi(result.message) });
  };

  return (
    <div className="space-y-6" data-testid="expenses">
      {monthClosed && (
        <Note tone="warn" testId="month-closed-note">
          {t(`${monthLabel(month, locale)} está cerrado: sus gastos no cambian. Para corregir, registra un ajuste con una fecha de ese mes.`, `${monthLabel(month, locale)} is closed: its expenses don't change. To correct it, record an adjustment dated in that month.`)}
        </Note>
      )}

      <section className="card px-5 py-4" aria-labelledby="expense-form">
        <h2 id="expense-form" className="text-[16px] font-semibold text-slate-900">
          {form.id ? t("Cambiar el gasto", "Change the expense") : form.adjustment ? t("Ajuste a un mes cerrado", "Adjustment to a closed month") : t("Nuevo gasto", "New expense")}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("Fecha del pago", "Date paid")}>
            <input className={CONTROL} type="date" max={today} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} data-testid="expense-date" />
          </Field>
          <Field label={t("Monto", "Amount")} hint={form.adjustment ? t("Negativo para restar (por ejemplo -20.00).", "Negative to take away (for example -20.00).") : undefined}>
            <input className={CONTROL} inputMode="decimal" placeholder="49.99" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="expense-amount" />
          </Field>
          <Field label={t("Categoría", "Category")} hint={category(form.category)[locale === "es" ? "hintEs" : "hintEn"]}>
            <select className={CONTROL} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CategoryKey })} data-testid="expense-category">
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c[locale]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Proveedor", "Vendor")}>
            <input className={CONTROL} placeholder="Lob, Meta, Supabase…" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} data-testid="expense-vendor" />
          </Field>
          <Field label={t("Descripción", "Description")}>
            <input className={CONTROL} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="expense-description" />
          </Field>
          <Field label={t("Pagado con", "Paid with")}>
            <select className={CONTROL} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m][locale]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {formClosed && !form.id && (
          <label className="mt-3 flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={form.adjustment} onChange={(e) => setForm({ ...form, adjustment: e.target.checked })} />
            {t("Es un ajuste a este mes cerrado (queda aparte de las cifras cerradas)", "It's an adjustment to this closed month (kept apart from the closed figures)")}
          </label>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={PRIMARY_BUTTON} onClick={save} data-testid="save-expense">
            {form.id ? t("Guardar cambios", "Save changes") : form.adjustment ? t("Registrar ajuste", "Record adjustment") : t("Registrar gasto", "Record expense")}
          </button>
          {(form.id || form.vendor || form.amount) && (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setForm(blank(today))}>
              {t("Limpiar", "Clear")}
            </button>
          )}
        </div>
        {message && (
          <div className="mt-3">
            <Note tone={message.tone}>{message.text}</Note>
          </div>
        )}
      </section>

      <section aria-labelledby="expense-list">
        <SectionTitle
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <select className={CONTROL_INLINE} value={filter} onChange={(e) => setFilter(e.target.value as CategoryKey | "all")} aria-label={t("Categoría", "Category")}>
                <option value="all">{t("Todas las categorías", "All categories")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c[locale]}
                  </option>
                ))}
              </select>
              <button type="button" className={QUIET_BUTTON} onClick={() => download(`credalti-expenses-${month}.csv`, expensesCsv(list))}>
                <Icon name="download" size={16} /> CSV
              </button>
            </div>
          }
        >
          <span id="expense-list">
            {t("Gastos de", "Expenses for")} {monthLabel(month, locale)} · <Money cents={total} />
          </span>
        </SectionTitle>
        <TableCard testId="expense-table" minWidth="min-w-[56rem]">
          <thead>
            <tr className="border-b hairline">
              <th className={TH}>{t("Fecha", "Date")}</th>
              <th className={TH}>{t("Proveedor", "Vendor")}</th>
              <th className={TH}>{t("Categoría", "Category")}</th>
              <th className={`${TH} text-right`}>{t("Monto", "Amount")}</th>
              <th className={TH}>{t("Recibo", "Receipt")}</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-b hairline last:border-b-0" data-testid="expense-row">
                <td className={`${TD} whitespace-nowrap tabular-nums`}>{shortDay(`${e.spentOn}T18:00:00Z`, locale)}</td>
                <td className={TD}>
                  <span className="font-medium text-slate-900">{e.vendor}</span>
                  {e.source !== "manual" && (
                    <span className="ml-1.5">
                      <Chip tone={e.source === "adjustment" ? "bg-amber-100 text-blue-900" : "bg-slate-100 text-slate-600"}>
                        {e.source === "recurring" ? t("mensual", "monthly") : e.source === "bank_import" ? t("del banco", "from bank") : t("ajuste", "adjustment")}
                      </Chip>
                    </span>
                  )}
                  <span className="block text-[12.5px] text-slate-500">
                    {e.description}
                    {e.description ? " · " : ""}
                    {PAYMENT_METHOD_LABEL[e.paymentMethod][locale]}
                  </span>
                </td>
                <td className={`${TD} text-slate-700`}>{category(e.category)[locale]}</td>
                <td className={`${TD} text-right tabular-nums`}>{formatCents(e.amountCents)}</td>
                <td className={TD}>
                  {e.receipt ? (
                    <button type="button" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0" onClick={() => void view(e)} data-testid="view-receipt">
                      <Icon name="doc" size={15} /> {e.receipt.name}
                    </button>
                  ) : (
                    <label className={`${ROW_BUTTON} relative cursor-pointer`}>
                      {t("Adjuntar", "Attach")}
                      <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(ev) => ev.target.files?.[0] && void attach(e, ev.target.files[0])} data-testid="attach-receipt" />
                    </label>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  {!monthClosed && e.source !== "adjustment" && (
                    <>
                      <button
                        type="button"
                        className={QUIET_BUTTON}
                        onClick={() => setForm({ id: e.id, spentOn: e.spentOn, amount: (e.amountCents / 100).toFixed(2), category: e.category, vendor: e.vendor, description: e.description, paymentMethod: e.paymentMethod, adjustment: false })}
                      >
                        {t("Cambiar", "Edit")}
                      </button>
                      <button type="button" className={QUIET_BUTTON} onClick={() => void voidIt(e)}>
                        {t("Anular", "Void")}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                  {t("Sin datos todavía: no hay gastos en este mes.", "No data yet: no expenses this month.")}
                </td>
              </tr>
            )}
          </tbody>
        </TableCard>
        <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Recibos: foto JPG o PNG, o PDF, hasta 10 MB. Se guardan en un archivo privado.", "Receipts: a JPG or PNG photo, or a PDF, up to 10 MB. Kept in private storage.")}</p>
      </section>

      {preview && (
        <section className="card px-5 py-4" aria-label={t("Recibo", "Receipt")} data-testid="receipt-preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-slate-900">
              {preview.expense.vendor} · {formatCents(preview.expense.amountCents)} · {preview.expense.receipt?.name}
            </p>
            <button type="button" className={QUIET_BUTTON} onClick={() => setPreview(null)}>
              {t("Cerrar", "Close")}
            </button>
          </div>
          {!preview.url ? (
            <p className="mt-2 text-[14px] text-slate-500">{t("El demo no guarda este archivo; con la base de datos se abre aquí.", "The demo doesn't keep this file; with the database it opens here.")}</p>
          ) : preview.expense.receipt?.kind === "pdf" ? (
            <a href={preview.url} target="_blank" rel="noreferrer" className={`${ROW_BUTTON} mt-3`}>
              {t("Abrir el PDF", "Open the PDF")}
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.url} alt={t("Recibo", "Receipt")} className="mt-3 max-h-[28rem] max-w-full rounded-xl border hairline" />
          )}
        </section>
      )}

      <section aria-labelledby="recurring">
        <SectionTitle
          aside={
            <button type="button" className={ROW_BUTTON} onClick={postDue} disabled={due.length === 0} data-testid="post-recurring">
              {due.length ? t(`Registrar ${due.length} gasto(s) mensual(es)`, `Post ${due.length} monthly expense(s)`) : t("Todo registrado", "All posted")}
            </button>
          }
        >
          <span id="recurring">{t("Gastos mensuales", "Monthly expenses")}</span>
        </SectionTitle>
        <RecurringRules acc={acc} />
      </section>
    </div>
  );
}

function RecurringRules({ acc }: { acc: Acc }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vendor: "", description: "", category: "software" as CategoryKey, amount: "", dayOfMonth: "1", startsOn: dayOf(new Date()), paymentMethod: "business_card" as PaymentMethod });
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    const cents = parsePositiveAmount(f.amount);
    if (cents === null) return setError(t("Escribe el monto.", "Write the amount."));
    const result = await acc.act({ action: "add_recurring", vendor: f.vendor, description: f.description, category: f.category, amountCents: cents, dayOfMonth: Number(f.dayOfMonth), paymentMethod: f.paymentMethod, startsOn: f.startsOn, endsOn: null });
    if (!result.ok) return setError(bi(result.message));
    setError(null);
    setOpen(false);
  };
  return (
    <div className="card overflow-hidden" data-testid="recurring-rules">
      <ul className="divide-y divide-slate-900/[0.06]">
        {acc.book.recurring.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px]">
            <span className="min-w-0">
              <span className={`font-medium ${r.active ? "text-slate-900" : "text-slate-400 line-through"}`}>{r.vendor}</span>
              <span className="ml-2 text-slate-500">
                {category(r.category)[locale]} · {t(`el día ${r.dayOfMonth}`, `day ${r.dayOfMonth}`)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-slate-900">{formatCents(r.amountCents)}</span>
              <button type="button" className={QUIET_BUTTON} onClick={() => void acc.act({ action: "set_recurring_active", id: r.id, active: !r.active })}>
                {r.active ? t("Detener", "Stop") : t("Reanudar", "Resume")}
              </button>
            </span>
          </li>
        ))}
        {acc.book.recurring.length === 0 && <li className="px-5 py-3 text-[14px] text-slate-500">{t("Ningún gasto mensual todavía.", "No monthly expenses yet.")}</li>}
      </ul>
      <div className="border-t hairline px-5 py-3">
        {!open ? (
          <button type="button" className={QUIET_BUTTON} onClick={() => setOpen(true)}>
            <Icon name="plus" size={16} /> {t("Agregar un gasto mensual", "Add a monthly expense")}
          </button>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("Proveedor", "Vendor")}>
              <input className={CONTROL} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
            </Field>
            <Field label={t("Monto", "Amount")}>
              <input className={CONTROL} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Field>
            <Field label={t("Día del mes", "Day of the month")}>
              <input className={CONTROL} type="number" min={1} max={31} value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: e.target.value })} />
            </Field>
            <Field label={t("Categoría", "Category")}>
              <select className={CONTROL} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as CategoryKey })}>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c[locale]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Desde", "Starting")}>
              <input className={CONTROL} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            </Field>
            <Field label={t("Descripción", "Description")}>
              <input className={CONTROL} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <button type="button" className={PRIMARY_BUTTON} onClick={add}>
                {t("Guardar", "Save")}
              </button>
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setOpen(false)}>
                {t("Cancelar", "Cancel")}
              </button>
            </div>
            {error && <p className="text-[13px] text-red-700 sm:col-span-3">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
