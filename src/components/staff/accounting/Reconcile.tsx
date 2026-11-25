"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { fileSha256, MAX_IMPORT_BYTES, parseCsv } from "@/lib/accounting/csv";
import type { useAccounting } from "@/lib/accounting/data";
import { demoSettlementCsv } from "@/lib/accounting/demo";
import { shownName } from "@/lib/accounting/facts";
import { formatCents } from "@/lib/accounting/money";
import { guessSettlementMapping, readSettlement, reconcile, RECON_STATUS_LABEL, SETTLEMENT_FIELDS, type ReconLine, type ReconStatus, type SettlementMapping } from "@/lib/accounting/reconcile";
import type { Gateway, SettlementKind } from "@/lib/accounting/types";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { shortDay } from "@/lib/staff/format";
import { Chip, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import { CONTROL, Field, Money, Note, TableCard, TD, Tile, TileGrid, TH, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

const TONE: Record<ReconStatus, string> = {
  matched: "bg-green-50 text-green-700",
  amount_mismatch: "bg-red-50 text-red-700",
  processor_only: "bg-red-50 text-red-700",
  app_only: "bg-amber-100 text-blue-900",
  suggested: "bg-blue-50 text-blue-700",
  explained: "bg-slate-100 text-slate-600",
};

const KIND_LABEL: Record<SettlementKind, { en: string; es: string }> = {
  sale: { en: "sale", es: "venta" },
  refund: { en: "refund", es: "reembolso" },
  void: { en: "void", es: "anulación" },
  chargeback: { en: "chargeback", es: "contracargo" },
  return: { en: "ACH return", es: "ACH devuelto" },
  fee: { en: "fee", es: "comisión" },
  other: { en: "other", es: "otro" },
};

const FIELD_LABEL: Record<keyof SettlementMapping, { en: string; es: string }> = {
  transactionId: { en: "Transaction id", es: "Núm. de transacción" },
  orderId: { en: "Order / invoice", es: "Orden / factura" },
  type: { en: "Type", es: "Tipo" },
  status: { en: "Status", es: "Estado" },
  amount: { en: "Amount", es: "Monto" },
  fee: { en: "Fee", es: "Comisión" },
  date: { en: "Date", es: "Fecha" },
  batch: { en: "Batch", es: "Lote" },
};

export default function Reconcile({ acc, reveal }: { acc: Acc; reveal: boolean }) {
  const t = useTx();
  const bi = useBi();
  const { locale } = useStaffLocale();
  const [gateway, setGateway] = useState<Gateway>("nmi");
  const [file, setFile] = useState<{ name: string; text: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<SettlementMapping | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const recon = useMemo(() => reconcile(acc.facts, acc.book.settlement, acc.book.decisions), [acc.facts, acc.book.settlement, acc.book.decisions]);
  const read = file && mapping ? readSettlement(file.rows, mapping, gateway) : null;

  const open = (name: string, text: string, g: Gateway = gateway) => {
    if (text.length > MAX_IMPORT_BYTES) return setMessage({ tone: "bad", text: t("El archivo pesa más de 2 MB.", "The file is over 2 MB.") });
    const rows = parseCsv(text);
    setFile({ name, text, rows });
    setMapping(guessSettlementMapping(rows[0] ?? [], g));
    setMessage(null);
  };

  const run = async () => {
    if (!file || !read || read.rows.length === 0) return;
    const result = await acc.act({ action: "import_settlement", gateway, fileName: file.name.slice(0, 200), fileSha256: await fileSha256(file.text), rows: read.rows });
    setMessage(result.ok ? { tone: "ok", text: bi(result.message) || t("Importado.", "Imported.") } : { tone: "bad", text: bi(result.message) });
    if (result.ok) setFile(null);
  };

  const decide = async (line: ReconLine, decision: "manual_match" | "explained") => {
    const note = window.prompt(decision === "manual_match" ? t("¿Por qué es el mismo cobro? (5 caracteres o más)", "Why is it the same charge? (5 characters or more)") : t("¿Qué explica la diferencia? (5 caracteres o más)", "What explains the difference? (5 characters or more)"));
    if (!note) return;
    const result = await acc.act({ action: "decide_match", settlementRowId: line.row?.id ?? null, chargeId: line.fact?.id ?? null, decision, note });
    if (!result.ok) setMessage({ tone: "bad", text: bi(result.message) });
  };

  const lines = onlyOpen ? recon.lines.filter((l) => l.status !== "matched" && l.status !== "explained") : recon.lines;
  const header = file?.rows[0] ?? [];

  return (
    <div className="space-y-6" data-testid="reconciliation">
      <Note>
        {t(
          "Compara los cobros de la app con la exportación del procesador (NMI o Authorize.Net). El procesador dice qué dinero se movió de verdad. Los nombres de columnas de cada exportación están SIN VERIFICAR: revisa el paso de columnas.",
          "Compares the app's charges with the processor's export (NMI or Authorize.Net). The processor says what money really moved. Each export's column names are UNVERIFIED: check the column step.",
        )}
      </Note>

      <div className="card flex flex-wrap items-end gap-3 px-5 py-4">
        <Field label={t("Procesador", "Processor")} className="w-48">
          <select className={CONTROL} value={gateway} onChange={(e) => { setGateway(e.target.value as Gateway); if (file) setMapping(guessSettlementMapping(file.rows[0] ?? [], e.target.value as Gateway)); }}>
            <option value="nmi">NMI</option>
            <option value="authorize_net">Authorize.Net</option>
          </select>
        </Field>
        <label className={`${PRIMARY_BUTTON} relative cursor-pointer`}>
          {t("Elegir la exportación (CSV)", "Choose the export (CSV)")}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => e.target.files?.[0] && open(e.target.files[0].name, await e.target.files[0].text())} data-testid="settlement-file" />
        </label>
        {acc.demo && (
          <button type="button" className={SECONDARY_BUTTON} onClick={() => { setGateway("nmi"); open("demo-nmi-transactions.csv", demoSettlementCsv(acc.staff.clients, new Date()), "nmi"); }} data-testid="settlement-sample">
            {t("Usar la exportación de ejemplo", "Use the sample export")}
          </button>
        )}
      </div>

      {file && mapping && read && (
        <section className="card px-5 py-4" data-testid="settlement-mapping">
          <p className="text-[15px] font-semibold text-slate-900">{file.name}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {SETTLEMENT_FIELDS.map((k) => (
              <Field key={k} label={FIELD_LABEL[k][locale]}>
                <select className={CONTROL} value={mapping[k] ?? ""} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">{t("— ninguna —", "— none —")}</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <p className="mt-3 text-[13.5px] text-slate-700">
            {t(`${read.rows.length} línea(s) leídas`, `${read.rows.length} line(s) read`)}
            {read.problems.length > 0 && t(`, ${read.problems.length} sin leer (línea ${read.problems[0]!.line}: ${read.problems[0]!.message.es})`, `, ${read.problems.length} unreadable (line ${read.problems[0]!.line}: ${read.problems[0]!.message.en})`)}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={PRIMARY_BUTTON} onClick={run} disabled={read.rows.length === 0} data-testid="run-settlement-import">
              {t("Importar y conciliar", "Import and reconcile")}
            </button>
            <button type="button" className={QUIET_BUTTON} onClick={() => setFile(null)}>
              {t("Cancelar", "Cancel")}
            </button>
          </div>
        </section>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}

      {acc.book.settlement.length === 0 ? (
        <Note tone="info">{t("Sin datos todavía: importa una exportación del procesador para conciliar.", "No data yet: import a processor export to reconcile.")}</Note>
      ) : (
        <>
          <TileGrid cols="grid-cols-2 lg:grid-cols-5">
            <Tile label={t("Coinciden", "Matched")} testId="recon-matched">{recon.counts.matched}</Tile>
            <Tile label={t("Montos distintos", "Amounts differ")}>{recon.counts.amount_mismatch}</Tile>
            <Tile label={t("Solo en el procesador", "Only in the processor")}>{recon.counts.processor_only}</Tile>
            <Tile label={t("Solo en la app", "Only in the app")}>{recon.counts.app_only}</Tile>
            <Tile label={t("Comisiones del procesador", "Processor fees")} note={recon.from && recon.to ? `${recon.from} → ${recon.to}` : undefined}>
              {formatCents(recon.feesCents)}
            </Tile>
          </TileGrid>

          <section aria-labelledby="recon-lines">
            <SectionTitle
              aside={
                <label className="flex min-h-11 items-center gap-2 text-[13.5px] text-slate-700">
                  <input type="checkbox" className="h-5 w-5" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
                  {t("Solo lo que hay que revisar", "Only what needs a look")}
                </label>
              }
            >
              <span id="recon-lines">{t("Líneas", "Lines")}</span>
            </SectionTitle>
            <TableCard testId="recon-table" minWidth="min-w-[58rem]">
              <thead>
                <tr className="border-b hairline">
                  <th className={TH}>{t("Estado", "Status")}</th>
                  <th className={TH}>{t("Procesador", "Processor")}</th>
                  <th className={TH}>{t("App", "App")}</th>
                  <th className={`${TH} text-right`}>{t("Diferencia", "Difference")}</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-b hairline last:border-b-0">
                    <td className={TD}>
                      <Chip tone={TONE[l.status]}>{RECON_STATUS_LABEL[l.status][locale]}</Chip>
                      {l.decision && <span className="mt-1 block text-[12px] text-slate-500">“{l.decision.note}” · {l.decision.by}</span>}
                    </td>
                    <td className={`${TD} text-[13px]`}>
                      {l.row ? (
                        <>
                          <span className="font-mono">{l.row.transactionId}</span>
                          <span className="block text-slate-500">
                            {KIND_LABEL[l.row.kind][locale]} · {l.row.settledOn} · {formatCents(l.row.amountCents)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className={`${TD} text-[13px]`}>
                      {l.fact ? (
                        <>
                          <Link href={`/equipo/cobros/${encodeURIComponent(l.fact.id)}`} className="font-mono text-blue-700 underline-offset-2 hover:underline">
                            {l.fact.invoice}
                          </Link>
                          <span className="block text-slate-500">
                            {shownName(l.fact.clientName, reveal)} · {l.fact.charge.chargedAt ? shortDay(l.fact.charge.chargedAt, locale) : "—"} · {formatCents(l.fact.collectedCents)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{l.status === "matched" ? "—" : <Money cents={l.differenceCents} signed />}</td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      {l.status === "suggested" && (
                        <button type="button" className={QUIET_BUTTON} onClick={() => void decide(l, "manual_match")}>
                          {t("Confirmar", "Confirm")}
                        </button>
                      )}
                      {l.status !== "matched" && l.status !== "explained" && (
                        <button type="button" className={QUIET_BUTTON} onClick={() => void decide({ ...l, fact: l.status === "suggested" ? null : l.fact }, "explained")}>
                          {t("Explicar", "Explain")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-green-700">
                      {t("Todo coincide.", "Everything matches.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </TableCard>
          </section>

          <section aria-labelledby="deposits">
            <SectionTitle>
              <span id="deposits">{t("Depósitos esperados, por día", "Expected deposits, by day")}</span>
            </SectionTitle>
            <TableCard testId="deposits" minWidth="min-w-[40rem]">
              <thead>
                <tr className="border-b hairline">
                  <th className={TH}>{t("Día · lote", "Day · batch")}</th>
                  <th className={`${TH} text-right`}>{t("Ventas", "Sales")}</th>
                  <th className={`${TH} text-right`}>{t("Devoluciones", "Refunds")}</th>
                  <th className={`${TH} text-right`}>{t("Comisiones", "Fees")}</th>
                  <th className={`${TH} text-right`}>{t("Neto al banco", "Net to the bank")}</th>
                </tr>
              </thead>
              <tbody>
                {recon.deposits.slice(0, 31).map((d) => (
                  <tr key={`${d.day}|${d.batchId}`} className="border-b hairline last:border-b-0">
                    <td className={`${TD} tabular-nums`}>
                      {d.day}
                      {d.batchId && <span className="ml-1.5 text-[12px] text-slate-500">{d.batchId}</span>}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCents(d.salesCents)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCents(d.refundsCents + d.chargebacksCents)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCents(d.feesCents)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{formatCents(d.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
            <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Compara el neto de cada día con el depósito en el estado de cuenta del banco.", "Compare each day's net with the deposit on the bank statement.")}</p>
          </section>
        </>
      )}
    </div>
  );
}
