"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fileSha256, parseCsv } from "@/lib/accounting/csv";
import { formatCents, parseMoney } from "@/lib/accounting/money";
import { commissionClientsFrom, demoCommissionLines, type CommissionsView } from "@/lib/fulfillment/commissionData";
import {
  detectStatementMapping,
  MONTH_STATUS_LABEL,
  POST_PROBLEM_TEXT,
  postingPlan,
  readStatement,
  reconcileMonth,
  suggestClient,
  type CommissionLine,
  type StatementField,
  type StatementMapping,
} from "@/lib/fulfillment/commissions";
import { deniedReason } from "@/lib/staff/permissions";
import { useStaff } from "@/lib/staff/useStaff";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { Chip, EmptyState, NoAccess, pillTab, PRIMARY_BUTTON, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

// Monitoring commissions (/equipo/monitoreo, administrators; section 5 Payments
// & Accounting; docs/FULFILLMENT.md "Monitoring"). What the monitoring
// provider pays Credalti for clients who enrolled through our link: recorded
// by hand or from the provider's statement CSV, reconciled per client and
// month against the team's monitoring checks, and posted to the books in one
// explicit step (ONE other_income row per post, on the day the provider paid:
// the money rule in src/lib/accounting/ledger.ts). Never shown to a client or
// a partner; the commission disclosure on the client's monitoring step stays
// as it is.

const DEMO_KEY = "credalti.staffDemo.monitoringCommissions.v1";
const field = "h-11 w-full rounded-xl bg-white px-3 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.12)] outline-none focus:ring-2 focus:ring-blue-300";

const STATUS_TONE = { paid: "bg-green-50 text-green-700", missing: "bg-red-50 text-red-700", reversed: "bg-slate-100 text-slate-600", not_expected: "bg-amber-100 text-blue-900" } as const;

function readDemo(now: Date): CommissionLine[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "null") as CommissionLine[] | null;
    if (raw) return raw;
  } catch {
    // ignore
  }
  return demoCommissionLines(now);
}

function writeDemo(lines: CommissionLine[]) {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(lines));
  } catch {
    // Storage unavailable: lasts for this visit.
  }
}

const texasToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export default function MonitoreoPage() {
  const { ready, can, data, locale, clients, viewer } = useStaff();
  const t = useTx();
  const demo = data.demo;
  const [view, setView] = useState<CommissionsView | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ clientId: "", month: texasToday().slice(0, 7), amount: "", memberRef: "", paidOn: "" });
  const [statement, setStatement] = useState<{ name: string; sha: string; rows: string[][]; mapping: StatementMapping } | null>(null);
  const [receivedOn, setReceivedOn] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (demo) {
      setView({ lines: readDemo(new Date()), clients: commissionClientsFrom(clients.filter((c) => c.signedUpAt)), booksByMonth: {} });
      return;
    }
    const res = await fetch("/api/staff/monitoring", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setView({ lines: [], clients: [], booksByMonth: {} });
    setView((await res.json()) as CommissionsView);
  }, [demo, clients]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const months = useMemo(() => {
    const set = new Set((view?.lines ?? []).filter((l) => !l.voidedAt).map((l) => l.month));
    set.add(texasToday().slice(0, 7));
    return [...set].sort().reverse().slice(0, 12);
  }, [view]);
  const current = month ?? months.find((m) => (view?.lines ?? []).some((l) => l.month === m && !l.voidedAt)) ?? months[0] ?? texasToday().slice(0, 7);
  const rec = useMemo(() => (view ? reconcileMonth(current, view.lines, view.clients) : null), [view, current]);

  if (!ready || !view || !rec) return null;
  if (!can("monitoring.commissions")) return <NoAccess title={t("Comisiones del monitoreo", "Monitoring commissions")} reason={deniedReason("monitoring.commissions", locale)} />;

  const money = (cents: number) => formatCents(cents);
  const nameOf = (id: string | null) => (id ? (view.clients.find((c) => c.id === id)?.name ?? "—") : t("Sin cliente", "No client"));
  const by = viewer?.name ?? "";

  const act = async (payload: Record<string, unknown>, demoChange: (lines: CommissionLine[]) => CommissionLine[]): Promise<boolean> => {
    setMessage(null);
    if (demo) {
      const next = demoChange(view.lines);
      writeDemo(next);
      setView({ ...view, lines: next });
      return true;
    }
    const res = await fetch("/api/staff/monitoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
      const problem = body?.code && body.code in POST_PROBLEM_TEXT.en ? POST_PROBLEM_TEXT[locale][body.code as keyof (typeof POST_PROBLEM_TEXT)["en"]] : null;
      setMessage(problem ?? (body?.code === "closed_month" ? t("Ese mes está cerrado en Contabilidad: regístralo como ajuste allí.", "That month is closed in Accounting: record it as an adjustment there.") : (body?.error ?? t("No se pudo guardar.", "Couldn't save it."))));
      return false;
    }
    await load();
    return true;
  };

  const newLine = (l: Omit<CommissionLine, "id" | "postedIncomeId" | "voidedAt" | "voidReason" | "by" | "at" | "provider" | "kind" | "note">): CommissionLine => ({
    ...l,
    id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    provider: "IdentityIQ",
    kind: l.amountCents < 0 ? "reversal" : "commission",
    note: "",
    postedIncomeId: null,
    voidedAt: null,
    voidReason: null,
    by,
    at: new Date().toISOString(),
  });

  const record = async () => {
    const cents = parseMoney(form.amount);
    if (!cents || !/^\d{4}-\d{2}$/.test(form.month)) return setMessage(t("Escribe el mes y una cantidad (negativa para una reversión).", "Enter the month and an amount (negative for a reversal)."));
    const line = { clientId: form.clientId || null, month: form.month, amountCents: cents, memberRef: form.memberRef.trim(), paidOn: form.paidOn || null, source: "manual" as const };
    if (await act({ action: "record", ...line }, (lines) => [...lines, newLine(line)])) {
      setForm({ ...form, amount: "", memberRef: "", clientId: "" });
      setMonth(line.month);
    }
  };

  const statementLines = statement ? readStatement(statement.rows, statement.mapping) : [];
  const importStatement = async () => {
    if (!statement) return;
    const good = statementLines.filter((l) => !l.problem);
    const lines = good.map((l) => ({ month: l.month!, amountCents: l.amountCents!, memberRef: l.memberRef, paidOn: l.paidOn, clientId: suggestClient(l, view.clients)?.id ?? null }));
    const ok = await act({ action: "import", fileName: statement.name, fileSha256: statement.sha, lines }, (all) => [...all, ...lines.map((l) => ({ ...newLine({ ...l, source: "csv" as const }) }))]);
    if (ok) {
      setStatement(null);
      setMessage(t(`Se agregaron ${lines.length} líneas. Revisa las que quedaron sin cliente.`, `${lines.length} lines added. Check the ones left without a client.`));
    }
  };

  // The day the provider paid: the newest "paid on" among the lines to post, unless the person typed one.
  const suggestedDay = view.lines.filter((l) => rec.unpostedLineIds.includes(l.id) && l.paidOn).map((l) => l.paidOn!).sort().at(-1) ?? "";
  const day = receivedOn || suggestedDay;
  const plan = postingPlan(rec, { receivedOn: day || null, existingMonitoringIncomeCents: view.booksByMonth[day.slice(0, 7)] ?? 0, confirmNotDuplicate: confirmed });
  const post = async () => {
    if (!plan.ok) return setMessage(POST_PROBLEM_TEXT[locale][plan.problem]);
    const ok = await act({ action: "post", month: current, receivedOn: day, confirmNotDuplicate: confirmed }, (lines) => lines.map((l) => (plan.lineIds.includes(l.id) ? { ...l, postedIncomeId: "demo-income" } : l)));
    if (ok) setMessage(demo ? t("Demo: las líneas quedan marcadas como pasadas; los libros de ejemplo de Contabilidad no cambian.", "Demo: the lines are marked as posted; Accounting's example books don't change.") : t(`Pasado a los libros: ${money(plan.amountCents)} el ${day}.`, `Posted to the books: ${money(plan.amountCents)} on ${day}.`));
  };

  const statementFields: StatementField[] = ["member", "email", "month", "amount", "paidOn"];
  const statementLabel: Record<StatementField, string> = {
    member: t("Miembro", "Member"),
    email: t("Correo", "Email"),
    month: t("Periodo", "Period"),
    amount: t("Comisión", "Commission"),
    paidOn: t("Pagada el", "Paid on"),
  };

  return (
    <main className="animate-rise space-y-6" data-testid="monitoring-commissions">
      <header>
        <h1 className="page-title">{t("Comisiones del monitoreo", "Monitoring commissions")}</h1>
        <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-slate-600">
          {t(
            "Lo que paga el proveedor del monitoreo (IdentityIQ) por los clientes que se inscribieron con nuestro enlace. Regístralo a mano o con el CSV de su estado de cuenta, concílialo por cliente y mes, y pásalo a los libros en un solo paso. El cliente nunca ve estas cantidades; el aviso de comisión en su paso de monitoreo no cambia.",
            "What the monitoring provider (IdentityIQ) pays for clients who enrolled through our link. Record it by hand or from their statement CSV, reconcile it per client and month, and post it to the books in one step. Clients never see these amounts; the commission disclosure on their monitoring step doesn't change.",
          )}
        </p>
        {demo && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] text-blue-900">{t("Demo: un estado de cuenta inventado. Lo que hagas se guarda solo en este navegador.", "Demo: a made-up statement. What you do is kept only in this browser.")}</p>}
      </header>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("Mes", "Month")}>
        {months.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === current} className={pillTab(m === current)} onClick={() => setMonth(m)}>
            {m}
          </button>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t("Totales del mes", "Month totals")}>
        {(
          [
            [t("Total del mes", "Month total"), rec.totalCents],
            [t("Ya en los libros", "Already in the books"), rec.postedCents],
            [t("Por pasar a los libros", "To post to the books"), rec.unpostedCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="card px-5 py-4">
            <p className="console-label">{label}</p>
            <p className="mt-1 font-display text-[26px] font-semibold tabular-nums text-blue-900">{money(cents)}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="conciliacion">
        <SectionTitle>
          <span id="conciliacion">{t("Conciliación por cliente", "Reconciliation by client")}</span>
        </SectionTitle>
        {rec.rows.length === 0 ? (
          <EmptyState pose="thinking" title={t("Nada que conciliar este mes", "Nothing to reconcile this month")}>
            {t("Aparece un cliente cuando el equipo registró que se inscribió con nuestro enlace, o cuando llega una comisión suya.", "A client appears once the team recorded that they enrolled through our link, or when a commission for them comes in.")}
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead>
                <tr>
                  <th className="px-4 py-2.5">{t("Cliente", "Client")}</th>
                  <th className="px-4 py-2.5">{t("Inscrito con nuestro enlace", "Enrolled through our link")}</th>
                  <th className="px-4 py-2.5 text-right">{t("Neto", "Net")}</th>
                  <th className="px-4 py-2.5">{t("Estado", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rec.rows.map((r) => (
                  <tr key={r.clientId} className="border-t hairline">
                    <td className="px-4 py-2.5">
                      <Link href={`/equipo/clientes/${r.clientId}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.expected ? t("Sí, y activo", "Yes, and active") : t("No registrado", "Not on record")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(r.netCents)}</td>
                    <td className="px-4 py-2.5">
                      <Chip tone={STATUS_TONE[r.status]}>{MONTH_STATUS_LABEL[locale][r.status]}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          {t(
            "«Esperada, sin pago»: el equipo registró la inscripción con nuestro enlace y el monitoreo activo, y el proveedor no pagó. «Sin inscripción registrada»: llegó un pago y en la ficha del cliente no dice que se inscribió con el enlace: actualiza su monitoreo.",
            "“Expected, not paid”: the team recorded enrollment through our link and active monitoring, and the provider didn't pay. “No link enrollment on record”: a payment came in and the client's page doesn't say they enrolled through the link: update their monitoring.",
          )}
        </p>
      </section>

      {rec.unmatched.length > 0 && (
        <section aria-labelledby="sin-cliente">
          <SectionTitle>
            <span id="sin-cliente">{t("Líneas sin cliente", "Lines without a client")}</span>
          </SectionTitle>
          <ul className="card overflow-hidden">
            {rec.unmatched.map((l, i) => {
              const suggestion = suggestClient(l, view.clients);
              return (
                <li key={l.id} className={`flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between ${i > 0 ? "border-t hairline" : ""}`}>
                  <span className="text-[14px] text-slate-800">
                    {l.memberRef || "—"} · <span className="tabular-nums">{money(l.amountCents)}</span>
                  </span>
                  <select
                    className={`${field} sm:w-64`}
                    defaultValue={suggestion?.id ?? ""}
                    aria-label={t("Cliente", "Client")}
                    onChange={(e) => void act({ action: "match", lineId: l.id, clientId: e.target.value || null }, (lines) => lines.map((x) => (x.id === l.id ? { ...x, clientId: e.target.value || null } : x)))}
                  >
                    <option value="">{t("— elige el cliente —", "— choose the client —")}</option>
                    {view.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {suggestion?.id === c.id ? t(" (sugerido)", " (suggested)") : ""}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card px-5 py-5" aria-labelledby="a-los-libros" data-testid="post-to-books">
        <h2 id="a-los-libros" className="console-label">
          {t("Pasar este mes a los libros", "Post this month to the books")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
          {t(
            "Agrega UNA línea de «Comisión de monitoreo» en Contabilidad por lo que falta pasar, el día en que el proveedor pagó (los libros cuentan el dinero el día en que se movió). No se hace solo, para no contar el mismo dinero dos veces.",
            "Adds ONE “Monitoring commission” line in Accounting for what is not posted yet, on the day the provider paid (the books count money on the day it moved). It is not automatic, so the same money is never counted twice.",
          )}
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block text-[13px] font-medium text-slate-700 sm:w-56">
            {t("Día en que pagó el proveedor", "Day the provider paid")}
            <input type="date" className={`${field} mt-1`} value={day} max={texasToday()} onChange={(e) => setReceivedOn(e.target.value)} />
          </label>
          <button type="button" disabled={rec.unpostedLineIds.length === 0} onClick={() => void post()} className={PRIMARY_BUTTON} data-testid="post-month">
            {t(`Pasar ${money(rec.unpostedCents)}`, `Post ${money(rec.unpostedCents)}`)}
          </button>
        </div>
        {!plan.ok && plan.problem === "existing_income" && (
          <label className="mt-3 flex min-h-11 items-start gap-2 text-[14px] text-blue-900">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {POST_PROBLEM_TEXT[locale].existing_income}
          </label>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card px-5 py-5">
          <h2 className="console-label">{t("Registrar a mano", "Record by hand")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] font-medium text-slate-700 sm:col-span-2">
              {t("Cliente", "Client")}
              <select className={`${field} mt-1`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                <option value="">{t("— sin cliente todavía —", "— no client yet —")}</option>
                {view.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Mes (AAAA-MM)", "Month (YYYY-MM)")}
              <input className={`${field} mt-1`} value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Cantidad", "Amount")}
              <input className={`${field} mt-1`} inputMode="decimal" value={form.amount} placeholder="40.00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Como lo nombra el estado de cuenta", "As the statement names them")}
              <input className={`${field} mt-1`} value={form.memberRef} maxLength={120} onChange={(e) => setForm({ ...form, memberRef: e.target.value })} />
            </label>
            <label className="block text-[13px] font-medium text-slate-700">
              {t("Pagada el (si se sabe)", "Paid on (if known)")}
              <input type="date" className={`${field} mt-1`} value={form.paidOn} max={texasToday()} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
            </label>
          </div>
          <button type="button" onClick={() => void record()} className={`${ROW_BUTTON} mt-4`} data-testid="record-commission">
            {t("Guardar la línea", "Save the line")}
          </button>
        </div>

        <div className="card px-5 py-5">
          <h2 className="console-label">{t("Importar el estado de cuenta (CSV)", "Import the statement (CSV)")}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
            {t(
              "El formato del proveedor no es público: revisa las columnas. Un archivo se importa una vez y una línea igual no se repite. Un número que parezca de Seguro Social no se guarda.",
              "The provider's format isn't public: check the columns. A file is imported once and the same line never twice. A number that looks like an SSN is not kept.",
            )}
          </p>
          <label className={`${ROW_BUTTON} mt-3 cursor-pointer`}>
            {t("Elegir el CSV", "Choose the CSV")}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const text = await f.text();
                const rows = parseCsv(text);
                if (rows.length < 2) return setMessage(t("El archivo no tiene filas.", "The file has no rows."));
                setStatement({ name: f.name, sha: await fileSha256(text), rows, mapping: detectStatementMapping(rows[0]!) });
              }}
            />
          </label>
          {statement && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {statementFields.map((f) => (
                  <label key={f} className="block text-[13px] font-medium text-slate-700">
                    {statementLabel[f]}
                    <select
                      className={`${field} mt-1`}
                      value={statement.mapping[f] ?? ""}
                      onChange={(e) => setStatement({ ...statement, mapping: { ...statement.mapping, [f]: e.target.value === "" ? undefined : Number(e.target.value) } })}
                    >
                      <option value="">{t("— sin usar —", "— not used —")}</option>
                      {statement.rows[0]!.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="text-[13px] text-slate-600">
                {t(
                  `${statementLines.filter((l) => !l.problem).length} líneas listas, ${statementLines.filter((l) => l.problem).length} sin mes o cantidad.`,
                  `${statementLines.filter((l) => !l.problem).length} lines ready, ${statementLines.filter((l) => l.problem).length} without a month or amount.`,
                )}
              </p>
              <button type="button" onClick={() => void importStatement()} className={ROW_BUTTON}>
                {t("Importar las líneas", "Import the lines")}
              </button>
            </div>
          )}
        </div>
      </section>

      {message && (
        <p role="status" className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] text-slate-800">
          {message}
        </p>
      )}

      <section aria-labelledby="lineas">
        <SectionTitle>
          <span id="lineas">{t(`Líneas de ${current}`, `Lines for ${current}`)}</span>
        </SectionTitle>
        <ul className="card overflow-hidden">
          {view.lines.filter((l) => l.month === current).length === 0 && <li className="px-5 py-4 text-[14px] text-slate-500">{t("Ninguna todavía.", "None yet.")}</li>}
          {view.lines
            .filter((l) => l.month === current)
            .map((l, i) => (
              <li key={l.id} className={`flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between ${i > 0 ? "border-t hairline" : ""} ${l.voidedAt ? "opacity-60" : ""}`}>
                <span className="min-w-0 text-[14px] text-slate-800">
                  {nameOf(l.clientId)} · {l.memberRef || "—"} · <span className="tabular-nums">{money(l.amountCents)}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {l.source === "csv" ? "CSV" : t("a mano", "by hand")}
                    {l.paidOn ? ` · ${t("pagada", "paid")} ${l.paidOn}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {l.voidedAt ? (
                    <Chip tone="bg-slate-100 text-slate-600">{t("Anulada", "Voided")}</Chip>
                  ) : l.postedIncomeId ? (
                    <Chip tone="bg-green-50 text-green-700">{t("En los libros", "In the books")}</Chip>
                  ) : (
                    <button
                      type="button"
                      className="pressable inline-flex h-11 items-center px-2 text-[14px] font-medium text-blue-700 md:h-9"
                      onClick={() => {
                        const reason = window.prompt(t("¿Por qué se anula? (5 letras o más)", "Why is it voided? (5 letters or more)")) ?? "";
                        if (reason.trim().length >= 5) void act({ action: "void", lineId: l.id, reason: reason.trim() }, (lines) => lines.map((x) => (x.id === l.id ? { ...x, voidedAt: new Date().toISOString(), voidReason: reason.trim() } : x)));
                      }}
                    >
                      {t("Anular", "Void")}
                    </button>
                  )}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
