"use client";

import { useMemo, useState } from "react";
import { bankFeedProvider } from "@/lib/accounting/bankFeeds";
import { CATEGORIES, type CategoryKey } from "@/lib/accounting/categories";
import { BANK_STATUS_LABEL, fileSha256, guessBankMapping, MAX_IMPORT_BYTES, parseCsv, planBankImport, readBankLines, vendorFromDescription, type BankMapping } from "@/lib/accounting/csv";
import type { useAccounting } from "@/lib/accounting/data";
import { demoBankCsv } from "@/lib/accounting/demo";
import { formatCents } from "@/lib/accounting/money";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL, Field, Note, TableCard, TD, TH, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

// A bank statement in: the file, then the mapping step (which column is
// what), then every line with what it would do, then the import. Money in is
// never an expense; a line already in the books is not added twice.

interface Loaded {
  name: string;
  text: string;
  rows: string[][];
}

const TONE: Record<string, string> = {
  new: "bg-green-50 text-green-700",
  inflow: "bg-blue-50 text-blue-700",
  duplicate_file: "bg-amber-100 text-blue-900",
  duplicate_books: "bg-amber-100 text-blue-900",
  closed_month: "bg-slate-100 text-slate-600",
  invalid: "bg-red-50 text-red-700",
  zero: "bg-slate-100 text-slate-600",
};

export default function BankImport({ acc }: { acc: Acc }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const [file, setFile] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<BankMapping | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [cats, setCats] = useState<Record<number, CategoryKey>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const feed = bankFeedProvider(acc.book.settings.bankFeedProvider);

  const open = (name: string, text: string) => {
    if (text.length > MAX_IMPORT_BYTES) return setMessage({ tone: "bad", text: t("El archivo pesa más de 2 MB.", "The file is over 2 MB.") });
    const rows = parseCsv(text);
    if (rows.length < 2) return setMessage({ tone: "bad", text: t("El archivo no tiene líneas.", "The file has no lines.") });
    setFile({ name, text, rows });
    setMapping(guessBankMapping(rows));
    setPicked({});
    setCats({});
    setMessage(null);
  };

  const plan = useMemo(() => (file && mapping ? planBankImport(readBankLines(file.rows, mapping), acc.book.expenses, acc.book.closes) : []), [file, mapping, acc.book.expenses, acc.book.closes]);
  const isPicked = (line: number, status: string) => picked[line] ?? status === "new";
  // A line that only looks like one already in the books can still be ticked: a person decides.
  const pickable = (status: string) => status === "new" || status === "duplicate_books";
  const chosen = plan.filter((l) => pickable(l.status) && isPicked(l.line, l.status));

  const run = async () => {
    if (!file || chosen.length === 0) return;
    const result = await acc.act({
      action: "import_bank",
      fileName: file.name.slice(0, 200),
      fileSha256: await fileSha256(file.text),
      lines: chosen.map((l) => ({ line: l.line, day: l.day!, description: l.description, vendor: vendorFromDescription(l.description), amountCents: l.amountCents!, category: cats[l.line] ?? l.suggested ?? "other" })),
      skipped: plan.length - chosen.length,
    });
    if (!result.ok) return setMessage({ tone: "bad", text: bi(result.message) });
    setMessage({ tone: "ok", text: bi(result.message) || t("Importado.", "Imported.") });
    setFile(null);
    setMapping(null);
  };

  const header = file && mapping ? (file.rows[mapping.headerRow] ?? []) : [];
  const col = (key: keyof Pick<BankMapping, "date" | "description" | "amount" | "debit" | "credit">, label: string) => (
    <Field label={label}>
      <select className={CONTROL} value={mapping![key] ?? ""} onChange={(e) => setMapping({ ...mapping!, [key]: e.target.value === "" ? null : Number(e.target.value) })} data-testid={`map-${key}`}>
        <option value="">{t("— ninguna —", "— none —")}</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h || `${t("Columna", "Column")} ${i + 1}`}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="space-y-5" data-testid="bank-import">
      <Note>
        {t("Conexión directa con el banco: ", "Direct bank feed: ")}
        <strong>{feed.enabled ? feed.label : t("apagada", "off")}</strong>
        {t(". Por ahora se importa el estado de cuenta en CSV (Chase, Bank of America, Wells Fargo… todos lo exportan).", ". For now the statement comes in as a CSV (Chase, Bank of America, Wells Fargo… all export one).")}
      </Note>

      <div className="card flex flex-wrap items-center gap-3 px-5 py-4">
        <label className={`${PRIMARY_BUTTON} relative cursor-pointer`}>
          {t("Elegir el CSV del banco", "Choose the bank CSV")}
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" data-testid="bank-file" onChange={async (e) => e.target.files?.[0] && open(e.target.files[0].name, await e.target.files[0].text())} />
        </label>
        {acc.demo && (
          <button type="button" className={SECONDARY_BUTTON} onClick={() => open("demo-bank-statement.csv", demoBankCsv(new Date()))} data-testid="bank-sample">
            {t("Usar el estado de cuenta de ejemplo", "Use the sample statement")}
          </button>
        )}
        {file && <span className="text-[13.5px] text-slate-600">{file.name}</span>}
      </div>

      {file && mapping && (
        <>
          <section aria-labelledby="mapping" data-testid="mapping-step">
            <SectionTitle>
              <span id="mapping">{t("1 · Qué es cada columna", "1 · What each column is")}</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label={t("Fila del encabezado", "Header row")}>
                  <input className={CONTROL} type="number" min={1} max={file.rows.length} value={mapping.headerRow + 1} onChange={(e) => setMapping({ ...mapping, headerRow: Math.max(0, Number(e.target.value) - 1) })} />
                </Field>
                {col("date", t("Fecha", "Date"))}
                {col("description", t("Descripción", "Description"))}
                {col("amount", t("Monto (una columna)", "Amount (one column)"))}
                {col("debit", t("Cargos (salidas)", "Debits (money out)"))}
                {col("credit", t("Abonos (entradas)", "Credits (money in)"))}
              </div>
              {mapping.amount !== null && (
                <label className="mt-3 flex min-h-11 items-center gap-2 text-[14px] text-slate-700">
                  <input type="checkbox" className="h-5 w-5" checked={mapping.outflowIs === "positive"} onChange={(e) => setMapping({ ...mapping, outflowIs: e.target.checked ? "positive" : "negative" })} />
                  {t("En este banco los gastos vienen en positivo", "This bank writes money out as positive")}
                </label>
              )}
              <div className="mt-3 overflow-x-auto rounded-xl border hairline">
                <table className="w-full min-w-[36rem] text-[12.5px]">
                  <tbody>
                    {file.rows.slice(mapping.headerRow, mapping.headerRow + 4).map((r, i) => (
                      <tr key={i} className={i === 0 ? "bg-slate-50 font-semibold" : "border-t hairline"}>
                        {r.map((c, j) => (
                          <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section aria-labelledby="review">
            <SectionTitle>
              <span id="review">{t("2 · Revisa cada línea", "2 · Check each line")}</span>
            </SectionTitle>
            <TableCard testId="bank-lines" minWidth="min-w-[50rem]">
              <thead>
                <tr className="border-b hairline">
                  <th className={TH} />
                  <th className={TH}>{t("Fecha", "Date")}</th>
                  <th className={TH}>{t("Descripción", "Description")}</th>
                  <th className={`${TH} text-right`}>{t("Monto", "Amount")}</th>
                  <th className={TH}>{t("Qué pasa", "What happens")}</th>
                  <th className={TH}>{t("Categoría", "Category")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((l) => (
                  <tr key={l.line} className="border-b hairline last:border-b-0">
                    <td className={TD}>
                      <input type="checkbox" className="h-5 w-5" disabled={!pickable(l.status)} checked={pickable(l.status) && isPicked(l.line, l.status)} onChange={(e) => setPicked({ ...picked, [l.line]: e.target.checked })} aria-label={t(`Línea ${l.line}`, `Line ${l.line}`)} />
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{l.day ?? "—"}</td>
                    <td className={`${TD} max-w-72`}>{l.description}</td>
                    <td className={`${TD} text-right tabular-nums`}>{l.amountCents === null ? "—" : formatCents(l.amountCents)}</td>
                    <td className={TD}>
                      <Chip tone={TONE[l.status]!}>{BANK_STATUS_LABEL[l.status][locale]}</Chip>
                      {l.problem && <span className="block text-[12px] text-red-700">{l.problem[locale]}</span>}
                    </td>
                    <td className={TD}>
                      {pickable(l.status) && (
                        <select className={`${CONTROL} min-w-48`} value={cats[l.line] ?? l.suggested ?? "other"} onChange={(e) => setCats({ ...cats, [l.line]: e.target.value as CategoryKey })} aria-label={t("Categoría", "Category")}>
                          {CATEGORIES.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c[locale]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
            <p className="mt-2 px-1 text-[12.5px] text-slate-500">
              {t(
                "Repetida: misma fecha, monto y palabras que otra línea, o un gasto del mismo monto a 3 días o menos con el mismo proveedor. Las entradas (depósitos del procesador) se revisan en Conciliación.",
                "Repeated: the same date, amount and words as another line, or an expense of the same amount within 3 days from the same vendor. Money in (processor deposits) is checked under Reconciliation.",
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={PRIMARY_BUTTON} onClick={run} disabled={chosen.length === 0} data-testid="run-bank-import">
                {t(`Importar ${chosen.length} gasto(s)`, `Import ${chosen.length} expense(s)`)}
              </button>
              <button type="button" className={QUIET_BUTTON} onClick={() => setFile(null)}>
                {t("Cancelar", "Cancel")}
              </button>
            </div>
          </section>
        </>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}

      {acc.book.imports.filter((i) => i.kind === "bank_statement").length > 0 && (
        <section>
          <SectionTitle>{t("Importaciones anteriores", "Earlier imports")}</SectionTitle>
          <ul className="card divide-y divide-slate-900/[0.06]">
            {acc.book.imports
              .filter((i) => i.kind === "bank_statement")
              .map((i) => (
                <li key={i.id} className="px-5 py-2.5 text-[13.5px] text-slate-700">
                  {i.fileName} · {t(`${i.addedCount} agregados, ${i.duplicateCount} sin agregar`, `${i.addedCount} added, ${i.duplicateCount} left out`)} · {i.createdBy}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
