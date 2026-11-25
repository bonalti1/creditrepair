"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCents } from "@/lib/billing/rules";
import { partnerRules } from "@/lib/partners/copy";
import { usePartners } from "@/lib/partners/data";
import {
  COMMISSION_BASES,
  COMMISSION_BASIS_LABEL,
  COMMISSION_BASIS_LABEL_EN,
  commissionTotals,
  PARTNER_KIND_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_LABEL_EN,
  referralStatus,
  type Partner,
  type PartnerStatus,
} from "@/lib/partners/rules";
import { formatPhone, shortDay } from "@/lib/staff/format";
import { SHARE_LEVEL_LABEL } from "@/lib/partners/sharing";
import type { PartnerProgram } from "@/lib/partners/program";
import { deniedReason } from "@/lib/staff/permissions";
import { memberName } from "@/lib/staff/team";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { useStaffLocale, useTx, type Tx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import { dateLocale, type StaffLocale } from "@/lib/staff/i18n/locale";
import Icon from "@/components/Icon";
import { Chip, DeniedNote, EmptyState, NoAccess, QUIET_BUTTON, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

// Referral partners: realtors, loan officers and tax preparers who send people
// to Credalti. Administrators and sales see the list; only an administrator
// approves an application, suspends a partner, sets the commission terms and
// records commission owed or paid (by hand: the app pays nobody). The data
// layer (partners/data.ts) and the route (/api/staff/partners) check the role
// again. The rules partners accept are at the bottom, as they read them.
//
// Also here (migration 0023): the program-wide "Comisiones a socios" switch
// (off until an administrator records the attorney's approval: while off no
// commission terms or amounts exist), which clients share their progress with
// which partner and at what level, the log of partner views of client pages
// (administrators), and partners' logos waiting for review. Suspending a
// partner cuts all their access at once, sharing included.

const STATUS_TONE: Record<PartnerStatus, string> = {
  pending: "bg-amber-100 text-blue-900",
  approved: "bg-green-50 text-green-700",
  declined: "bg-slate-100 text-slate-600",
  suspended: "bg-slate-100 text-slate-600",
};

const control =
  "h-10 w-full min-w-0 rounded-xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300";

function ProgramCard({ program, manage, onChange }: { program: PartnerProgram; manage: boolean; onChange: (input: { enabled: boolean; attorneyName?: string; attorneyApprovedOn?: string; confirmed?: boolean }) => Promise<void> }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  const [opening, setOpening] = useState(false);
  const [form, setForm] = useState({ attorneyName: "", attorneyApprovedOn: "", confirmed: false });
  const on = program.commissionsEnabled;
  return (
    <section className="card mt-6 p-5" aria-labelledby="comisiones-programa" data-testid="partner-program">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="comisiones-programa" className="text-[17px] font-semibold text-slate-900">
            {t("Comisiones a socios", "Partner commissions")}{" "}
            <Chip tone={on ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>{on ? t("Encendidas", "On") : t("Apagadas", "Off")}</Chip>
          </h2>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-snug text-slate-600">
            {on
              ? t(
                  `Encendidas por ${program.changedBy ?? "administración"} el ${program.changedAt ? shortDay(program.changedAt, locale) : "—"}, con la aprobación de ${program.attorneyName ?? "—"} del ${program.attorneyApprovedOn ?? "—"}. Solo por cliente que firma o cliente activo; nunca por resultados.`,
                  `Turned on by ${program.changedBy ?? "an administrator"} on ${program.changedAt ? shortDay(program.changedAt, locale) : "—"}, with approval from ${program.attorneyName ?? "—"} dated ${program.attorneyApprovedOn ?? "—"}. Only per client who signs or per active client; never for results.`,
                )
              : t(
                  "Apagadas hasta que el abogado apruebe pagar comisiones (RESPA sección 8 para agentes y oficiales de préstamos, y las reglas de Texas). Mientras estén apagadas no se fijan ni se registran comisiones, los socios no ven cifras y sus términos dicen que el programa no paga comisiones.",
                  "Off until the attorney approves paying commissions (RESPA Section 8 for agents and loan officers, and the Texas rules). While they're off, no commissions are set or recorded, partners see no amounts, and their terms say the program pays no commissions.",
                )}
            {!on && program.changedAt
              ? t(
                  ` Apagadas por ${program.changedBy ?? "administración"} el ${shortDay(program.changedAt, locale)}.`,
                  ` Turned off by ${program.changedBy ?? "an administrator"} on ${shortDay(program.changedAt, locale)}.`,
                )
              : ""}
          </p>
        </div>
        {manage && (on ? (
          <button type="button" className={QUIET_BUTTON} onClick={() => onChange({ enabled: false })}>{t("Apagar", "Turn off")}</button>
        ) : (
          !opening && <button type="button" className={ROW_BUTTON} onClick={() => setOpening(true)}>{t("Encender…", "Turn on…")}</button>
        ))}
      </div>
      {manage && !on && opening && (
        <div className="mt-4 grid gap-3 border-t hairline pt-4 sm:grid-cols-2">
          <input aria-label={t("Abogado que lo aprobó", "Attorney who approved it")} className={control} placeholder={t("Abogado que lo aprobó", "Attorney who approved it")} value={form.attorneyName} onChange={(e) => setForm({ ...form, attorneyName: e.target.value })} />
          <input aria-label={t("Fecha de la aprobación", "Date of approval")} type="date" className={control} value={form.attorneyApprovedOn} onChange={(e) => setForm({ ...form, attorneyApprovedOn: e.target.value })} />
          <label className="flex items-start gap-2.5 text-[14px] leading-snug text-slate-700 sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-700" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} />
            {t(
              "Confirmo que el abogado aprobó, por escrito, pagar comisiones a socios (RESPA sección 8 y Código de Finanzas de Texas, cap. 393). Queda registrado con mi nombre y la fecha.",
              "I confirm the attorney approved, in writing, paying commissions to partners (RESPA Section 8 and Texas Finance Code, ch. 393). It's recorded with my name and the date.",
            )}
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={ROW_BUTTON} disabled={!form.confirmed} onClick={async () => { await onChange({ enabled: true, ...form }); setOpening(false); }}>{t("Encender comisiones", "Turn on commissions")}</button>
            <button type="button" className={QUIET_BUTTON} onClick={() => setOpening(false)}>{t("Cancelar", "Cancel")}</button>
          </div>
        </div>
      )}
      {!manage && <p className="mt-2"><DeniedNote>{t("Solo una persona administradora enciende o apaga las comisiones.", "Only an administrator turns commissions on or off.")}</DeniedNote></p>}
    </section>
  );
}

function terms(p: Partner, fees: boolean, t: Tx, locale: StaffLocale): string {
  if (!fees) return t("Sin comisión (programa apagado)", "No commission (program off)");
  const basis = (locale === "es" ? COMMISSION_BASIS_LABEL : COMMISSION_BASIS_LABEL_EN)[p.commissionBasis];
  return p.commissionBasis === "none" ? t("Sin comisión", "No commission") : `${formatCents(p.commissionCents)} · ${basis.toLowerCase()}`;
}

export default function SociosStaff() {
  const { ready, clients, members, can, viewer } = useStaff();
  const t = useTx();
  const { locale } = useStaffLocale();
  const allowed = can("partners.view");
  const manage = can("partners.manage");
  const { data, book, ready: booksReady, reload } = usePartners(ready && allowed);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState({ basis: "none", amount: "", note: "", recKind: "owed" as "owed" | "paid", recAmount: "", recNote: "" });
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  // "#socio-<id>" (from the console's search): once the list is drawn, go to that partner.
  useEffect(() => {
    if (!booksReady || !window.location.hash.startsWith("#socio-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [booksReady]);

  const counts = useMemo(() => {
    const by = new Map<string, { referrals: number; signed: number; active: number }>();
    for (const client of clients) {
      const id = client.leadSource?.partnerId;
      if (!id) continue;
      const row = by.get(id) ?? { referrals: 0, signed: 0, active: 0 };
      row.referrals += 1;
      if (client.agreementSignedAt) row.signed += 1;
      if (referralStatus(client) === "active") row.active += 1;
      by.set(id, row);
    }
    return by;
  }, [clients]);

  if (!ready) return null;
  if (!allowed) return <NoAccess title={t("Socios", "Partners")} reason={deniedReason("partners.view", locale)} />;
  if (!booksReady || !book) return null;

  const pending = book.partners.filter((p) => p.status === "pending");
  const others = book.partners.filter((p) => p.status !== "pending").sort((a, b) => (a.status === "approved" ? 0 : 1) - (b.status === "approved" ? 0 : 1) || a.name.localeCompare(b.name, "es"));
  const statusLabel = locale === "es" ? PARTNER_STATUS_LABEL : PARTNER_STATUS_LABEL_EN;
  const basisLabel = locale === "es" ? COMMISSION_BASIS_LABEL : COMMISSION_BASIS_LABEL_EN;
  const sellers = members.filter((m) => m.active && m.role !== "specialist");
  const fees = book.program.commissionsEnabled;
  const partnerName = (id: string) => book.partners.find((p) => p.id === id)?.name ?? "—";
  const logos = book.partners.filter((p) => p.logoStatus === "pending" && p.logo);

  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => {
    const result = await run();
    setNotice(result.ok ? { ok: true, text: done } : { ok: false, text: staffMessage(result.message, locale) });
    await reload();
  };

  const openEditor = (p: Partner) => {
    setOpen(open === p.id ? null : p.id);
    setEdit({ basis: p.commissionBasis, amount: p.commissionCents ? (p.commissionCents / 100).toFixed(2) : "", note: p.commissionNote ?? "", recKind: "owed", recAmount: "", recNote: "" });
  };

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{t("Socios", "Partners")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            {t(
              "Agentes de bienes raíces, oficiales de préstamos y preparadores de impuestos que nos refieren personas. Ven solo el paso en que va cada referido, nunca su crédito.",
              "Real estate agents, loan officers and tax preparers who refer people to us. They see only the step each referral is on, never their credit.",
            )}
          </p>
        </div>
        <a href="/socios" target="_blank" rel="noopener noreferrer" className={QUIET_BUTTON}>
          <Icon name="link" size={16} />
          {t("Página de solicitud", "Application page")}
        </a>
      </div>

      {notice && (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug ${notice.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`} role="status">
          {notice.text}
        </p>
      )}

      <ProgramCard program={book.program} manage={manage} onChange={(input) => act(() => data.setProgram(input, staffAuthor()), input.enabled ? t("Comisiones encendidas. Quedó registrado quién y cuándo.", "Commissions turned on. Who and when is on record.") : t("Comisiones apagadas.", "Commissions turned off."))} />

      <section className="mt-6" aria-labelledby="por-revisar">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{pending.length}</span>}>
          <span id="por-revisar">{t("Solicitudes por revisar", "Applications to review")}</span>
        </SectionTitle>
        {pending.length === 0 ? (
          <div className="card">
            <EmptyState pose="thumbsUp" title={t("No hay solicitudes nuevas.", "No new applications.")} />
          </div>
        ) : (
          <ul className="card overflow-hidden">
            {pending.map((p, i) => (
              <li key={p.id} id={`socio-${p.id}`} className={`flex scroll-mt-28 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center ${i > 0 ? "border-t hairline" : ""}`} data-testid="partner-pending">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-slate-900">
                    {p.name}
                    {p.company && <span className="font-normal text-slate-500"> · {p.company}</span>}
                  </p>
                  <p className="text-[13.5px] text-slate-600">
                    {PARTNER_KIND_LABEL[locale][p.kind]} · {formatPhone(p.phone)}
                    {p.email ? ` · ${p.email}` : ""} · {t("solicitó el", "applied")} {shortDay(p.appliedAt, locale)}
                  </p>
                </div>
                {manage ? (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setStatus(p.id, "approved"), t(`${p.name} quedó aprobado. Ya tiene su enlace.`, `${p.name} is approved. Their link is ready.`))}>
                      {t("Aprobar", "Approve")}
                    </button>
                    <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setStatus(p.id, "declined"), t(`La solicitud de ${p.name} quedó como no aprobada.`, `${p.name}'s application is marked as not approved.`))}>
                      {t("No aprobar", "Don't approve")}
                    </button>
                  </div>
                ) : (
                  <DeniedNote>{deniedReason("partners.manage", locale)}</DeniedNote>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          {t(
            "Antes de aprobar: confirma quién es y a qué se dedica, y que entiende las reglas de abajo. Si es agente o trabaja en hipotecas, revisa con el abogado cómo se le puede pagar (ver docs/PARTNERS.md).",
            "Before approving: confirm who they are and what they do, and that they understand the rules below. If they're an agent or work in mortgages, check with the attorney how they can be paid (see docs/PARTNERS.md).",
          )}
        </p>
      </section>

      <section className="mt-8" aria-labelledby="lista">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{others.length}</span>}>
          <span id="lista">{t("Socios", "Partners")}</span>
        </SectionTitle>
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_8rem_11rem_minmax(0,1.1fr)_6rem] gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>{t("Socio", "Partner")}</span>
            <span>{t("Estado", "Status")}</span>
            <span>{t("Enlace", "Link")}</span>
            <span>{t("Ventas", "Sales")}</span>
            <span>{t("Referidos · firmaron · activos", "Referred · signed · active")}</span>
            <span>{t("Comisión", "Commission")}</span>
            <span />
          </div>
          <ul>
            {others.map((p, i) => {
              const n = counts.get(p.id) ?? { referrals: 0, signed: 0, active: 0 };
              const money = commissionTotals(book.commissions, p.id);
              const records = book.commissions.filter((r) => r.partnerId === p.id).reverse();
              return (
                <li key={p.id} id={`socio-${p.id}`} className={`scroll-mt-28 ${i > 0 ? "border-t hairline" : ""}`} data-testid="partner-row">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 lg:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_8rem_11rem_minmax(0,1.1fr)_6rem]">
                    <div className="min-w-0">
                      <p className="truncate text-[15.5px] font-semibold text-slate-900">{p.name}</p>
                      <p className="truncate text-[13px] text-slate-500">{[p.company, PARTNER_KIND_LABEL[locale][p.kind]].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="justify-self-end lg:justify-self-start">
                      <Chip tone={STATUS_TONE[p.status]}>{statusLabel[p.status]}</Chip>
                    </span>
                    <span className="col-span-2 min-w-0 truncate text-[13px] text-slate-600 lg:col-span-1" title={p.referralCode ? `${origin}/r/${p.referralCode}` : undefined}>
                      {p.referralCode ? (p.status === "approved" ? `/r/${p.referralCode}` : t(`/r/${p.referralCode} (sin efecto)`, `/r/${p.referralCode} (inactive)`)) : "—"}
                    </span>
                    <span className="col-span-2 text-[13px] text-slate-600 lg:col-span-1">
                      <span className="lg:hidden">{t("Ventas", "Sales")}: </span>
                      {p.salesperson ? memberName(members, p.salesperson, locale) : <span className="text-slate-400">{t("Por turno", "Rotation")}</span>}
                    </span>
                    <span className="col-span-2 text-[13px] tabular-nums text-slate-700 lg:col-span-1">
                      <span className="lg:hidden">{t("Referidos · firmaron · activos", "Referred · signed · active")}: </span>
                      {n.referrals} · {n.signed} · {n.active}
                    </span>
                    <span className="col-span-2 min-w-0 text-[13px] leading-snug text-slate-600 lg:col-span-1">
                      {terms(p, fees, t, locale)}
                      {manage && fees && (money.owedCents > 0 || money.paidCents > 0) && (
                        <span className="block text-slate-500">
                          {t(
                            `Registrado ${formatCents(money.owedCents)} · pagado ${formatCents(money.paidCents)}`,
                            `Recorded ${formatCents(money.owedCents)} · paid ${formatCents(money.paidCents)}`,
                          )}
                        </span>
                      )}
                    </span>
                    <span className="col-span-2 lg:col-span-1 lg:justify-self-end">
                      {manage && (
                        <button type="button" className={QUIET_BUTTON} onClick={() => openEditor(p)} aria-expanded={open === p.id}>
                          {open === p.id ? t("Cerrar", "Close") : t("Editar", "Edit")}
                        </button>
                      )}
                    </span>
                  </div>

                  {manage && open === p.id && (
                    <div className="grid gap-5 border-t hairline bg-slate-50/70 px-5 py-4 lg:grid-cols-3">
                      {!fees && (
                        <div className="lg:col-span-2">
                          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Comisión", "Commission")}</p>
                          <p className="mt-1.5 text-[13.5px] leading-snug text-slate-600">
                            {t(
                              "Comisiones a socios está apagado: no se fijan ni se registran comisiones hasta que el abogado lo apruebe.",
                              "Partner commissions are off: no commissions are set or recorded until the attorney approves.",
                            )}
                          </p>
                        </div>
                      )}
                      {fees && (<>
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Comisión acordada", "Agreed commission")}</p>
                        <select aria-label={t("Cómo se gana", "How it's earned")} className={`${control} mt-1.5`} value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value })}>
                          {COMMISSION_BASES.map((b) => (
                            <option key={b} value={b}>{basisLabel[b]}</option>
                          ))}
                        </select>
                        {edit.basis !== "none" && (
                          <input aria-label={t("Monto en dólares", "Amount in dollars")} className={`${control} mt-2`} placeholder={t("Monto, por ejemplo 100", "Amount, for example 100")} value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} inputMode="decimal" />
                        )}
                        <input aria-label={t("Nota", "Note")} className={`${control} mt-2`} placeholder={t("Nota (opcional)", "Note (optional)")} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                        <button type="button" className={`${ROW_BUTTON} mt-2`} onClick={() => act(() => data.setCommission(p.id, edit.basis, edit.amount, edit.note), t("Comisión guardada.", "Commission saved."))}>
                          {t("Guardar comisión", "Save commission")}
                        </button>
                        <p className="mt-1.5 text-[12px] leading-snug text-slate-500">
                          {t("Nunca por resultados en un reporte: solo por cliente que firma o cliente activo.", "Never for results on a report: only per client who signs or per active client.")}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Registrar a mano", "Record by hand")}</p>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <select aria-label={t("Tipo", "Type")} className={control} value={edit.recKind} onChange={(e) => setEdit({ ...edit, recKind: e.target.value as "owed" | "paid" })}>
                            <option value="owed">{t("Se le debe", "Owed to them")}</option>
                            <option value="paid">{t("Se le pagó", "Paid to them")}</option>
                          </select>
                          <input aria-label={t("Monto del registro", "Amount of the record")} className={control} placeholder={t("Monto", "Amount")} value={edit.recAmount} onChange={(e) => setEdit({ ...edit, recAmount: e.target.value })} inputMode="decimal" />
                        </div>
                        <input aria-label={t("Nota del registro", "Note for the record")} className={`${control} mt-2`} placeholder={t("Para qué (sin datos de crédito)", "What it's for (no credit details)")} value={edit.recNote} onChange={(e) => setEdit({ ...edit, recNote: e.target.value })} />
                        <button
                          type="button"
                          className={`${ROW_BUTTON} mt-2`}
                          onClick={() => act(() => data.recordCommission(p.id, edit.recKind, edit.recAmount, edit.recNote, staffAuthor()), t("Registro guardado. No se puede editar ni borrar.", "Record saved. It can't be edited or deleted."))}
                        >
                          {t("Registrar", "Record")}
                        </button>
                        {records.length > 0 && (
                          <ul className="mt-3 space-y-1 text-[12.5px] text-slate-600">
                            {records.slice(0, 4).map((r) => (
                              <li key={r.id}>
                                {shortDay(r.recordedAt, locale)} · {r.kind === "owed" ? t("se le debe", "owed") : t("se le pagó", "paid")} {formatCents(r.amountCents)}
                                {r.note ? ` · ${r.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      </>)}
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Quién lo atiende", "Who works with them")}</p>
                        <select
                          aria-label={t("Ventas", "Sales")}
                          className={`${control} mt-1.5`}
                          value={p.salesperson ?? ""}
                          onChange={(e) => act(() => data.setSalesperson(p.id, e.target.value || null), t("Listo.", "Done."))}
                        >
                          <option value="">{t("Por turno", "Rotation")}</option>
                          {sellers.map((m) => (
                            <option key={m.handle} value={m.handle}>{m.name}</option>
                          ))}
                        </select>
                        <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Estado", "Status")}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.status === "approved" && (
                            <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setStatus(p.id, "suspended"), t(`${p.name} quedó suspendido: su enlace ya no registra referidos, su portal se cierra y deja de ver a los clientes que comparten con él, desde ya.`, `${p.name} is suspended: starting now, their link no longer records referrals, their portal closes and they stop seeing the clients who share with them.`))}>
                              {t("Suspender", "Suspend")}
                            </button>
                          )}
                          {(p.status === "suspended" || p.status === "declined") && (
                            <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setStatus(p.id, "approved"), t(`${p.name} quedó aprobado.`, `${p.name} is approved.`))}>
                              {t("Aprobar", "Approve")}
                            </button>
                          )}
                        </div>
                        {p.commissionNote && <p className="mt-3 text-[12.5px] leading-snug text-slate-500">{t("Nota", "Note")}: {p.commissionNote}</p>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {!manage && <p className="px-1 pt-2"><DeniedNote>{deniedReason("partners.manage", locale)}</DeniedNote></p>}
      </section>

      {logos.length > 0 && (
        <section className="mt-8" aria-labelledby="logos" data-testid="partner-logos">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{logos.length}</span>}>
            <span id="logos">{t("Logos por revisar", "Logos to review")}</span>
          </SectionTitle>
          <ul className="card overflow-hidden">
            {logos.map((p, i) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-4 px-5 py-3.5 ${i > 0 ? "border-t hairline" : ""}`}>
                {/* A data URL the partner uploaded, checked by its bytes (partners/logo.ts). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.logo!} alt={t(`Logo de ${p.name}`, `${p.name}'s logo`)} className="h-12 w-12 rounded-xl border hairline bg-white object-contain" />
                <p className="min-w-0 flex-1 text-[15px] text-slate-900">
                  {p.name}
                  {p.company && <span className="text-slate-500"> · {p.company}</span>}
                  <span className="block text-[12.5px] text-slate-500">{t("Aparece en la bienvenida de sus referidos solo si lo apruebas.", "It shows on their referrals' welcome only if you approve it.")}</span>
                </p>
                {manage ? (
                  <span className="flex gap-1">
                    <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setLogo(p.id, "approved"), t(`Logo de ${p.name} aprobado.`, `${p.name}'s logo approved.`))}>{t("Aprobar", "Approve")}</button>
                    <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setLogo(p.id, "rejected"), t(`Logo de ${p.name} no aprobado.`, `${p.name}'s logo not approved.`))}>{t("No aprobar", "Don't approve")}</button>
                  </span>
                ) : (
                  <DeniedNote>{deniedReason("partners.manage", locale)}</DeniedNote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="comparten" data-testid="partner-shares">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{book.shares.length}</span>}>
          <span id="comparten">{t("Clientes que comparten su avance", "Clients who share their progress")}</span>
        </SectionTitle>
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_10rem_8rem_minmax(0,1fr)] gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>{t("Cliente", "Client")}</span>
            <span>{t("Socio", "Partner")}</span>
            <span>{t("Nivel", "Level")}</span>
            <span>{t("Desde", "Since")}</span>
            <span>{t("Cómo", "How")}</span>
          </div>
          {book.shares.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-slate-500">{t("Ningún cliente comparte su avance con un socio.", "No client shares their progress with a partner.")}</p>
          ) : (
            <ul>
              {book.shares.map((row, i) => (
                <li key={`${row.partnerId}-${row.clientId}`} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[14px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_10rem_8rem_minmax(0,1fr)] ${i > 0 ? "border-t hairline" : ""}`}>
                  <span className="truncate font-medium text-slate-900">{row.clientName}</span>
                  <span className="truncate text-slate-700">{partnerName(row.partnerId)}</span>
                  <span><Chip tone={row.level === "summary" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"}>{SHARE_LEVEL_LABEL[locale][row.level]}</Chip></span>
                  <span className="text-slate-600">{shortDay(row.since, locale)}</span>
                  <span className="col-span-2 text-[13px] text-slate-500 lg:col-span-1">
                    {row.how === "referred" ? t("Lo refirió", "Referred them") : t("El cliente lo agregó con su código", "The client added them with their code")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          {t(
            "Es decisión de cada cliente, con su consentimiento registrado (versión y huella del texto). Solo el cliente lo cambia o lo quita, desde su app, y vale de inmediato. Un socio nunca ve puntajes, reportes, cuentas, cartas, documentos, pagos ni conversaciones.",
            "It's each client's decision, with their consent on record (the text's version and fingerprint). Only the client changes or removes it, from their app, and it takes effect right away. A partner never sees scores, reports, accounts, letters, documents, payments or conversations.",
          )}
        </p>
      </section>

      {manage && (
        <section className="mt-8" aria-labelledby="visitas" data-testid="partner-views">
          <SectionTitle>
            <span id="visitas">{t("Visitas de socios a la página de un cliente", "Partner visits to a client's page")}</span>
          </SectionTitle>
          <div className="card overflow-hidden">
            {book.views.length === 0 ? (
              <p className="px-5 py-5 text-[14px] text-slate-500">{t("Todavía no hay visitas.", "No visits yet.")}</p>
            ) : (
              <ul>
                {book.views.slice(0, 20).map((v, i) => (
                  <li key={`${v.partnerId}-${v.clientId}-${v.at}`} className={`flex flex-wrap justify-between gap-2 px-5 py-2.5 text-[14px] ${i > 0 ? "border-t hairline" : ""}`}>
                    <span className="text-slate-900">
                      {t(`${partnerName(v.partnerId)} vio el avance de ${v.clientName}`, `${partnerName(v.partnerId)} viewed ${v.clientName}'s progress`)}
                    </span>
                    <span className="text-slate-500">{new Date(v.at).toLocaleString(dateLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
            {t("Cada visita la registra la base de datos al mostrar la página. El cliente también la ve, en su app.", "The database records each visit when it shows the page. The client sees it too, in their app.")}
          </p>
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2" aria-label={t("Reglas", "Rules")}>
        <div>
          <SectionTitle>{t("Lo que aceptan los socios", "What partners agree to")}</SectionTitle>
          <ul className="card space-y-2 px-5 py-4 text-[14px] leading-snug text-slate-700">
            {partnerRules(locale, fees).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div>
          <SectionTitle>{t("Para el abogado", "For the attorney")}</SectionTitle>
          <ul className="card space-y-2 px-5 py-4 text-[14px] leading-snug text-slate-700">
            <li>
              {t(
                "RESPA sección 8: si pagar a un agente o a un oficial de préstamos por referir está permitido cuando hay una hipoteca de por medio.",
                "RESPA Section 8: whether paying an agent or a loan officer for referrals is allowed when a mortgage is involved.",
              )}
            </li>
            <li>{t("Texas (organizaciones de servicios de crédito): qué reglas aplican a pagar por referidos.", "Texas (credit services organizations): which rules apply to paying for referrals.")}</li>
            <li>{t("FTC (guías de recomendaciones): cómo debe decir cada socio que recibe una comisión.", "FTC (Endorsement Guides): how each partner must disclose that they receive a commission.")}</li>
            <li>
              {t(
                "Compartir el avance con un socio: el texto del consentimiento (GLBA y leyes de privacidad), y que los conteos no conviertan esto en un reporte de consumidor (FCRA). Ver docs/PARTNERS.md.",
                "Sharing progress with a partner: the consent text (GLBA and privacy laws), and that the counts don't turn this into a consumer report (FCRA). See docs/PARTNERS.md.",
              )}
            </li>
          </ul>
        </div>
      </section>
      {data.demo && viewer && <p className="mt-6 text-xs text-slate-500">{t("Demo: los socios son inventados. Los cambios se guardan solo en este navegador.", "Demo: the partners are made up. Changes are saved only in this browser.")}</p>}
    </main>
  );
}
