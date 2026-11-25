"use client";

import { useState } from "react";
import Link from "next/link";
import { form1099List, NEC_THRESHOLD_CENTS, partnerPayables } from "@/lib/accounting/commissions";
import type { useAccounting } from "@/lib/accounting/data";
import { formatCents } from "@/lib/accounting/money";
import { toCsv } from "@/lib/billing/invoices";
import { centsToDecimal } from "@/lib/accounting/money";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { Chip, QUIET_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";
import Icon from "@/components/Icon";
import { CONTROL, CONTROL_INLINE, download, Note, TableCard, TD, TH, useBi } from "./bits";

type Acc = ReturnType<typeof useAccounting>;

export default function Commissions({ acc }: { acc: Acc }) {
  const t = useTx();
  const bi = useBi();
  const book = acc.partners;
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ legalName: "", w9: "", exempt: false });
  const [error, setError] = useState<string | null>(null);
  if (!book) return null;
  const partners = book.partners;
  // The 1099 list reads PAYMENTS on record whatever the switch says now: a payment made while it was on still counts for that year.
  const records = book.commissions;
  const payables = partnerPayables(partners, records);
  const nec = form1099List(partners, records, acc.book.partnerTax, year);

  const save = async (partnerId: string) => {
    const result = await acc.act({ action: "partner_tax", partnerId, legalName: form.legalName, w9ReceivedOn: form.w9 || null, exempt: form.exempt });
    if (!result.ok) return setError(bi(result.message));
    setEditing(null);
    setError(null);
  };

  return (
    <div className="space-y-6" data-testid="commissions">
      {!acc.commissionsOn ? (
        <Note tone="warn" testId="commissions-off">
          {t(
            "«Comisiones a socios» está apagado: no se registra ni se paga ninguna comisión hasta que un administrador registre la aprobación del abogado (RESPA §8, Código de Finanzas de Texas cap. 393). Por eso aquí no hay montos por pagar.",
            "“Partner commissions” is off: no commission is recorded or paid until an administrator records the attorney's approval (RESPA §8, Texas Finance Code ch. 393). That is why there is nothing payable here.",
          )}{" "}
          <Link href="/equipo/socios" className="font-semibold underline">
            {t("Ir a Socios", "Go to Partners")}
          </Link>
        </Note>
      ) : (
        <section aria-labelledby="payables">
          <SectionTitle>
            <span id="payables">{t("Por pagar a cada socio", "Owed to each partner")}</span>
          </SectionTitle>
          <TableCard testId="payables" minWidth="min-w-[40rem]">
            <thead>
              <tr className="border-b hairline">
                <th className={TH}>{t("Socio", "Partner")}</th>
                <th className={`${TH} text-right`}>{t("Registrado como debido", "Recorded as owed")}</th>
                <th className={`${TH} text-right`}>{t("Pagado", "Paid")}</th>
                <th className={`${TH} text-right`}>{t("Por pagar", "Balance")}</th>
                <th className={TH}>{t("Estado", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {payables.map((p) => (
                <tr key={p.partner.id} className="border-b hairline last:border-b-0">
                  <td className={TD}>
                    <span className="font-medium text-slate-900">{p.partner.name}</span>
                    {p.partner.company && <span className="block text-[12.5px] text-slate-500">{p.partner.company}</span>}
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatCents(p.owedCents)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatCents(p.paidCents)}</td>
                  <td className={`${TD} text-right font-semibold tabular-nums`}>{formatCents(p.balanceCents)}</td>
                  <td className={TD}>
                    <Chip tone={p.balanceCents > 0 ? "bg-amber-100 text-blue-900" : "bg-green-50 text-green-700"}>{p.balanceCents > 0 ? t("Se le debe", "Owed") : t("Al día", "Paid up")}</Chip>
                  </td>
                </tr>
              ))}
              {payables.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    {t("Sin datos todavía: no hay comisiones registradas.", "No data yet: no commissions recorded.")}
                  </td>
                </tr>
              )}
            </tbody>
          </TableCard>
          <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Los montos los registra un administrador en Socios. La app no calcula ni paga comisiones, y nunca por resultados.", "An administrator records the amounts under Partners. The app never computes or pays a commission, and never per result.")}</p>
        </section>
      )}

      <section aria-labelledby="nec">
        <SectionTitle
          aside={
            <div className="flex items-center gap-2">
              <select className={CONTROL_INLINE} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t("Año", "Year")}>
                {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button type="button" className={SECONDARY_BUTTON} disabled={nec.length === 0} onClick={() => download(`credalti-1099-nec-${year}.csv`, toCsv(["Year", "Legal name", "Partner", "Paid", "W-9 on file", "Exempt per W-9"], nec.map((l) => [year, l.legalName, l.partner.name, centsToDecimal(l.paidCents), l.w9OnFile ? "yes" : "no", l.exempt ? "yes" : "no"])))}>
                <Icon name="download" size={18} className="mr-1.5" />
                CSV
              </button>
            </div>
          }
        >
          <span id="nec">{t(`Resumen 1099-NEC de ${year} (pagos de $600 o más)`, `${year} 1099-NEC summary (paid $600 or more)`)}</span>
        </SectionTitle>
        <TableCard testId="nec-list" minWidth="min-w-[40rem]">
          <thead>
            <tr className="border-b hairline">
              <th className={TH}>{t("Nombre legal", "Legal name")}</th>
              <th className={`${TH} text-right`}>{t(`Pagado en ${year}`, `Paid in ${year}`)}</th>
              <th className={TH}>W-9</th>
              <th className={TH}>{t("Qué falta", "What's missing")}</th>
            </tr>
          </thead>
          <tbody>
            {nec.map((l) => (
              <tr key={l.partner.id} className="border-b hairline last:border-b-0">
                <td className={TD}>
                  <span className="font-medium text-slate-900">{l.legalName}</span>
                  <span className="block text-[12.5px] text-slate-500">{l.partner.name}</span>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{formatCents(l.paidCents)}</td>
                <td className={TD}>{l.w9OnFile ? (l.exempt ? t("Sí · exento", "Yes · exempt") : t("Sí", "Yes")) : t("No", "No")}</td>
                <td className={`${TD} text-[13px] text-slate-600`}>{l.todo ? bi(l.todo) : t("Listo para el contador", "Ready for the CPA")}</td>
              </tr>
            ))}
            {nec.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-slate-500">
                  {t(`Nadie recibió ${formatCents(NEC_THRESHOLD_CENTS)} o más en pagos registrados en ${year}.`, `Nobody was paid ${formatCents(NEC_THRESHOLD_CENTS)} or more in recorded payments in ${year}.`)}
                </td>
              </tr>
            )}
          </tbody>
        </TableCard>
        <p className="mt-2 px-1 text-[12.5px] text-slate-500">{t("Un punto de partida para el contador: él decide qué se presenta (vence el 31 de enero). Aquí nunca se guarda el número de identificación fiscal; solo si el W-9 está en el expediente.", "A starting point for the CPA, who decides what is filed (due January 31). The tax id is never stored here; only whether the W-9 is on file.")}</p>
      </section>

      <section aria-labelledby="w9">
        <SectionTitle>
          <span id="w9">{t("W-9 de cada socio", "Each partner's W-9")}</span>
        </SectionTitle>
        <ul className="card divide-y divide-slate-900/[0.06]" data-testid="w9-list">
          {partners.filter((p) => p.status === "approved").map((p) => {
            const info = acc.book.partnerTax.find((x) => x.partnerId === p.id);
            return (
              <li key={p.id} className="px-5 py-3 text-[14px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-slate-900">{p.name}</span>
                    <span className="ml-2 text-slate-500">{info?.w9ReceivedOn ? t(`W-9 recibido ${info.w9ReceivedOn}`, `W-9 received ${info.w9ReceivedOn}`) : t("Sin W-9", "No W-9")}</span>
                  </span>
                  <button type="button" className={QUIET_BUTTON} onClick={() => { setEditing(p.id); setForm({ legalName: info?.legalName ?? "", w9: info?.w9ReceivedOn ?? "", exempt: info?.exempt ?? false }); }}>
                    {t("Cambiar", "Edit")}
                  </button>
                </div>
                {editing === p.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_12rem_auto_auto]">
                    <input className={CONTROL} placeholder={t("Nombre legal del W-9", "Legal name from the W-9")} value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
                    <input className={CONTROL} type="date" value={form.w9} onChange={(e) => setForm({ ...form, w9: e.target.value })} aria-label={t("W-9 recibido el", "W-9 received on")} />
                    <label className="flex min-h-11 items-center gap-2 text-[13.5px]">
                      <input type="checkbox" className="h-5 w-5" checked={form.exempt} onChange={(e) => setForm({ ...form, exempt: e.target.checked })} />
                      {t("Exento según el W-9", "Exempt per the W-9")}
                    </label>
                    <button type="button" className={SECONDARY_BUTTON} onClick={() => void save(p.id)}>
                      {t("Guardar", "Save")}
                    </button>
                    {error && <p className="text-[13px] text-red-700 sm:col-span-4">{error}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
