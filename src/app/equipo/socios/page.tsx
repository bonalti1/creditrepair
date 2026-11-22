"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/billing/rules";
import { partnerRules } from "@/lib/partners/copy";
import { usePartners } from "@/lib/partners/data";
import {
  COMMISSION_BASES,
  COMMISSION_BASIS_LABEL,
  commissionTotals,
  PARTNER_KIND_LABEL,
  PARTNER_STATUS_LABEL,
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
import Icon from "@/components/Icon";
import { Chip, DeniedNote, NoAccess, QUIET_BUTTON, ROW_BUTTON, SectionTitle } from "@/components/staff/ui";

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
  const [opening, setOpening] = useState(false);
  const [form, setForm] = useState({ attorneyName: "", attorneyApprovedOn: "", confirmed: false });
  const on = program.commissionsEnabled;
  return (
    <section className="card mt-6 p-5" aria-labelledby="comisiones-programa" data-testid="partner-program">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="comisiones-programa" className="text-[17px] font-semibold text-slate-900">
            Comisiones a socios <Chip tone={on ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}>{on ? "Encendidas" : "Apagadas"}</Chip>
          </h2>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-snug text-slate-600">
            {on
              ? `Encendidas por ${program.changedBy ?? "administración"} el ${program.changedAt ? shortDay(program.changedAt) : "—"}, con la aprobación de ${program.attorneyName ?? "—"} del ${program.attorneyApprovedOn ?? "—"}. Solo por cliente que firma o cliente activo; nunca por resultados.`
              : "Apagadas hasta que el abogado apruebe pagar comisiones (RESPA sección 8 para agentes y oficiales de préstamos, y las reglas de Texas). Mientras estén apagadas no se fijan ni se registran comisiones, los socios no ven cifras y sus términos dicen que el programa no paga comisiones."}
            {!on && program.changedAt ? ` Apagadas por ${program.changedBy ?? "administración"} el ${shortDay(program.changedAt)}.` : ""}
          </p>
        </div>
        {manage && (on ? (
          <button type="button" className={QUIET_BUTTON} onClick={() => onChange({ enabled: false })}>Apagar</button>
        ) : (
          !opening && <button type="button" className={ROW_BUTTON} onClick={() => setOpening(true)}>Encender…</button>
        ))}
      </div>
      {manage && !on && opening && (
        <div className="mt-4 grid gap-3 border-t hairline pt-4 sm:grid-cols-2">
          <input aria-label="Abogado que lo aprobó" className={control} placeholder="Abogado que lo aprobó" value={form.attorneyName} onChange={(e) => setForm({ ...form, attorneyName: e.target.value })} />
          <input aria-label="Fecha de la aprobación" type="date" className={control} value={form.attorneyApprovedOn} onChange={(e) => setForm({ ...form, attorneyApprovedOn: e.target.value })} />
          <label className="flex items-start gap-2.5 text-[14px] leading-snug text-slate-700 sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-700" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} />
            Confirmo que el abogado aprobó, por escrito, pagar comisiones a socios (RESPA sección 8 y Código de Finanzas de Texas, cap. 393). Queda registrado con mi nombre y la fecha.
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" className={ROW_BUTTON} disabled={!form.confirmed} onClick={async () => { await onChange({ enabled: true, ...form }); setOpening(false); }}>Encender comisiones</button>
            <button type="button" className={QUIET_BUTTON} onClick={() => setOpening(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {!manage && <p className="mt-2"><DeniedNote>Solo una persona administradora enciende o apaga las comisiones.</DeniedNote></p>}
    </section>
  );
}

function terms(p: Partner, fees: boolean): string {
  if (!fees) return "Sin comisión (programa apagado)";
  return p.commissionBasis === "none" ? "Sin comisión" : `${formatCents(p.commissionCents)} · ${COMMISSION_BASIS_LABEL[p.commissionBasis].toLowerCase()}`;
}

export default function SociosStaff() {
  const { ready, clients, members, can, viewer } = useStaff();
  const allowed = can("partners.view");
  const manage = can("partners.manage");
  const { data, book, ready: booksReady, reload } = usePartners(ready && allowed);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState({ basis: "none", amount: "", note: "", recKind: "owed" as "owed" | "paid", recAmount: "", recNote: "" });
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

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
  if (!allowed) return <NoAccess title="Socios" reason={deniedReason("partners.view")} />;
  if (!booksReady || !book) return null;

  const pending = book.partners.filter((p) => p.status === "pending");
  const others = book.partners.filter((p) => p.status !== "pending").sort((a, b) => (a.status === "approved" ? 0 : 1) - (b.status === "approved" ? 0 : 1) || a.name.localeCompare(b.name, "es"));
  const sellers = members.filter((m) => m.active && m.role !== "specialist");
  const fees = book.program.commissionsEnabled;
  const partnerName = (id: string) => book.partners.find((p) => p.id === id)?.name ?? "—";
  const logos = book.partners.filter((p) => p.logoStatus === "pending" && p.logo);

  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => {
    const result = await run();
    setNotice(result.ok ? { ok: true, text: done } : { ok: false, text: result.message });
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
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Socios</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            Agentes de bienes raíces, oficiales de préstamos y preparadores de impuestos que nos refieren personas. Ven solo el paso en que va cada referido, nunca su crédito.
          </p>
        </div>
        <a href="/socios" target="_blank" rel="noopener noreferrer" className={QUIET_BUTTON}>
          <Icon name="link" size={16} />
          Página de solicitud
        </a>
      </div>

      {notice && (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug ${notice.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`} role="status">
          {notice.text}
        </p>
      )}

      <ProgramCard program={book.program} manage={manage} onChange={(input) => act(() => data.setProgram(input, staffAuthor()), input.enabled ? "Comisiones encendidas. Quedó registrado quién y cuándo." : "Comisiones apagadas.")} />

      <section className="mt-6" aria-labelledby="por-revisar">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{pending.length}</span>}>
          <span id="por-revisar">Solicitudes por revisar</span>
        </SectionTitle>
        {pending.length === 0 ? (
          <div className="card px-5 py-5 text-[14px] text-slate-500">No hay solicitudes nuevas.</div>
        ) : (
          <ul className="card overflow-hidden">
            {pending.map((p, i) => (
              <li key={p.id} className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center ${i > 0 ? "border-t hairline" : ""}`} data-testid="partner-pending">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-slate-900">
                    {p.name}
                    {p.company && <span className="font-normal text-slate-500"> · {p.company}</span>}
                  </p>
                  <p className="text-[13.5px] text-slate-600">
                    {PARTNER_KIND_LABEL.es[p.kind]} · {formatPhone(p.phone)}
                    {p.email ? ` · ${p.email}` : ""} · solicitó el {shortDay(p.appliedAt)}
                  </p>
                </div>
                {manage ? (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setStatus(p.id, "approved"), `${p.name} quedó aprobado. Ya tiene su enlace.`)}>
                      Aprobar
                    </button>
                    <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setStatus(p.id, "declined"), `La solicitud de ${p.name} quedó como no aprobada.`)}>
                      No aprobar
                    </button>
                  </div>
                ) : (
                  <DeniedNote>{deniedReason("partners.manage")}</DeniedNote>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          Antes de aprobar: confirma quién es y a qué se dedica, y que entiende las reglas de abajo. Si es agente o trabaja en hipotecas, revisa con el abogado cómo se le puede pagar (ver docs/PARTNERS.md).
        </p>
      </section>

      <section className="mt-8" aria-labelledby="lista">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{others.length}</span>}>
          <span id="lista">Socios</span>
        </SectionTitle>
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_8rem_11rem_minmax(0,1.1fr)_6rem] gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>Socio</span>
            <span>Estado</span>
            <span>Enlace</span>
            <span>Ventas</span>
            <span>Referidos · firmaron · activos</span>
            <span>Comisión</span>
            <span />
          </div>
          <ul>
            {others.map((p, i) => {
              const n = counts.get(p.id) ?? { referrals: 0, signed: 0, active: 0 };
              const money = commissionTotals(book.commissions, p.id);
              const records = book.commissions.filter((r) => r.partnerId === p.id).reverse();
              return (
                <li key={p.id} className={i > 0 ? "border-t hairline" : ""} data-testid="partner-row">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 lg:grid-cols-[minmax(0,1.4fr)_7rem_minmax(0,1fr)_8rem_11rem_minmax(0,1.1fr)_6rem]">
                    <div className="min-w-0">
                      <p className="truncate text-[15.5px] font-semibold text-slate-900">{p.name}</p>
                      <p className="truncate text-[13px] text-slate-500">{[p.company, PARTNER_KIND_LABEL.es[p.kind]].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className="justify-self-end lg:justify-self-start">
                      <Chip tone={STATUS_TONE[p.status]}>{PARTNER_STATUS_LABEL[p.status]}</Chip>
                    </span>
                    <span className="col-span-2 min-w-0 truncate text-[13px] text-slate-600 lg:col-span-1" title={p.referralCode ? `${origin}/r/${p.referralCode}` : undefined}>
                      {p.referralCode ? (p.status === "approved" ? `/r/${p.referralCode}` : `/r/${p.referralCode} (sin efecto)`) : "—"}
                    </span>
                    <span className="col-span-2 text-[13px] text-slate-600 lg:col-span-1">
                      <span className="lg:hidden">Ventas: </span>
                      {p.salesperson ? memberName(members, p.salesperson) : <span className="text-slate-400">Por turno</span>}
                    </span>
                    <span className="col-span-2 text-[13px] tabular-nums text-slate-700 lg:col-span-1">
                      <span className="lg:hidden">Referidos · firmaron · activos: </span>
                      {n.referrals} · {n.signed} · {n.active}
                    </span>
                    <span className="col-span-2 min-w-0 text-[13px] leading-snug text-slate-600 lg:col-span-1">
                      {terms(p, fees)}
                      {manage && fees && (money.owedCents > 0 || money.paidCents > 0) && (
                        <span className="block text-slate-500">
                          Registrado {formatCents(money.owedCents)} · pagado {formatCents(money.paidCents)}
                        </span>
                      )}
                    </span>
                    <span className="col-span-2 lg:col-span-1 lg:justify-self-end">
                      {manage && (
                        <button type="button" className={QUIET_BUTTON} onClick={() => openEditor(p)} aria-expanded={open === p.id}>
                          {open === p.id ? "Cerrar" : "Editar"}
                        </button>
                      )}
                    </span>
                  </div>

                  {manage && open === p.id && (
                    <div className="grid gap-5 border-t hairline bg-slate-50/70 px-5 py-4 lg:grid-cols-3">
                      {!fees && (
                        <div className="lg:col-span-2">
                          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Comisión</p>
                          <p className="mt-1.5 text-[13.5px] leading-snug text-slate-600">Comisiones a socios está apagado: no se fijan ni se registran comisiones hasta que el abogado lo apruebe.</p>
                        </div>
                      )}
                      {fees && (<>
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Comisión acordada</p>
                        <select aria-label="Cómo se gana" className={`${control} mt-1.5`} value={edit.basis} onChange={(e) => setEdit({ ...edit, basis: e.target.value })}>
                          {COMMISSION_BASES.map((b) => (
                            <option key={b} value={b}>{COMMISSION_BASIS_LABEL[b]}</option>
                          ))}
                        </select>
                        {edit.basis !== "none" && (
                          <input aria-label="Monto en dólares" className={`${control} mt-2`} placeholder="Monto, por ejemplo 100" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} inputMode="decimal" />
                        )}
                        <input aria-label="Nota" className={`${control} mt-2`} placeholder="Nota (opcional)" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                        <button type="button" className={`${ROW_BUTTON} mt-2`} onClick={() => act(() => data.setCommission(p.id, edit.basis, edit.amount, edit.note), "Comisión guardada.")}>
                          Guardar comisión
                        </button>
                        <p className="mt-1.5 text-[12px] leading-snug text-slate-500">Nunca por resultados en un reporte: solo por cliente que firma o cliente activo.</p>
                      </div>
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Registrar a mano</p>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <select aria-label="Tipo" className={control} value={edit.recKind} onChange={(e) => setEdit({ ...edit, recKind: e.target.value as "owed" | "paid" })}>
                            <option value="owed">Se le debe</option>
                            <option value="paid">Se le pagó</option>
                          </select>
                          <input aria-label="Monto del registro" className={control} placeholder="Monto" value={edit.recAmount} onChange={(e) => setEdit({ ...edit, recAmount: e.target.value })} inputMode="decimal" />
                        </div>
                        <input aria-label="Nota del registro" className={`${control} mt-2`} placeholder="Para qué (sin datos de crédito)" value={edit.recNote} onChange={(e) => setEdit({ ...edit, recNote: e.target.value })} />
                        <button
                          type="button"
                          className={`${ROW_BUTTON} mt-2`}
                          onClick={() => act(() => data.recordCommission(p.id, edit.recKind, edit.recAmount, edit.recNote, staffAuthor()), "Registro guardado. No se puede editar ni borrar.")}
                        >
                          Registrar
                        </button>
                        {records.length > 0 && (
                          <ul className="mt-3 space-y-1 text-[12.5px] text-slate-600">
                            {records.slice(0, 4).map((r) => (
                              <li key={r.id}>
                                {shortDay(r.recordedAt)} · {r.kind === "owed" ? "se le debe" : "se le pagó"} {formatCents(r.amountCents)}
                                {r.note ? ` · ${r.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      </>)}
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Quién lo atiende</p>
                        <select
                          aria-label="Ventas"
                          className={`${control} mt-1.5`}
                          value={p.salesperson ?? ""}
                          onChange={(e) => act(() => data.setSalesperson(p.id, e.target.value || null), "Listo.")}
                        >
                          <option value="">Por turno</option>
                          {sellers.map((m) => (
                            <option key={m.handle} value={m.handle}>{m.name}</option>
                          ))}
                        </select>
                        <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Estado</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.status === "approved" && (
                            <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setStatus(p.id, "suspended"), `${p.name} quedó suspendido: su enlace ya no registra referidos, su portal se cierra y deja de ver a los clientes que comparten con él, desde ya.`)}>
                              Suspender
                            </button>
                          )}
                          {(p.status === "suspended" || p.status === "declined") && (
                            <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setStatus(p.id, "approved"), `${p.name} quedó aprobado.`)}>
                              Aprobar
                            </button>
                          )}
                        </div>
                        {p.commissionNote && <p className="mt-3 text-[12.5px] leading-snug text-slate-500">Nota: {p.commissionNote}</p>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {!manage && <p className="px-1 pt-2"><DeniedNote>{deniedReason("partners.manage")}</DeniedNote></p>}
      </section>

      {logos.length > 0 && (
        <section className="mt-8" aria-labelledby="logos" data-testid="partner-logos">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{logos.length}</span>}>
            <span id="logos">Logos por revisar</span>
          </SectionTitle>
          <ul className="card overflow-hidden">
            {logos.map((p, i) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-4 px-5 py-3.5 ${i > 0 ? "border-t hairline" : ""}`}>
                {/* A data URL the partner uploaded, checked by its bytes (partners/logo.ts). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.logo!} alt={`Logo de ${p.name}`} className="h-12 w-12 rounded-xl border hairline bg-white object-contain" />
                <p className="min-w-0 flex-1 text-[15px] text-slate-900">
                  {p.name}
                  {p.company && <span className="text-slate-500"> · {p.company}</span>}
                  <span className="block text-[12.5px] text-slate-500">Aparece en la bienvenida de sus referidos solo si lo apruebas.</span>
                </p>
                {manage ? (
                  <span className="flex gap-1">
                    <button type="button" className={ROW_BUTTON} onClick={() => act(() => data.setLogo(p.id, "approved"), `Logo de ${p.name} aprobado.`)}>Aprobar</button>
                    <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setLogo(p.id, "rejected"), `Logo de ${p.name} no aprobado.`)}>No aprobar</button>
                  </span>
                ) : (
                  <DeniedNote>{deniedReason("partners.manage")}</DeniedNote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="comparten" data-testid="partner-shares">
        <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{book.shares.length}</span>}>
          <span id="comparten">Clientes que comparten su avance</span>
        </SectionTitle>
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_10rem_8rem_minmax(0,1fr)] gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>Cliente</span>
            <span>Socio</span>
            <span>Nivel</span>
            <span>Desde</span>
            <span>Cómo</span>
          </div>
          {book.shares.length === 0 ? (
            <p className="px-5 py-5 text-[14px] text-slate-500">Ningún cliente comparte su avance con un socio.</p>
          ) : (
            <ul>
              {book.shares.map((row, i) => (
                <li key={`${row.partnerId}-${row.clientId}`} className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-[14px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_10rem_8rem_minmax(0,1fr)] ${i > 0 ? "border-t hairline" : ""}`}>
                  <span className="truncate font-medium text-slate-900">{row.clientName}</span>
                  <span className="truncate text-slate-700">{partnerName(row.partnerId)}</span>
                  <span><Chip tone={row.level === "summary" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"}>{SHARE_LEVEL_LABEL.es[row.level]}</Chip></span>
                  <span className="text-slate-600">{shortDay(row.since)}</span>
                  <span className="col-span-2 text-[13px] text-slate-500 lg:col-span-1">{row.how === "referred" ? "Lo refirió" : "El cliente lo agregó con su código"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          Es decisión de cada cliente, con su consentimiento registrado (versión y huella del texto). Solo el cliente lo cambia o lo quita, desde su app, y vale de inmediato. Un socio nunca ve puntajes, reportes, cuentas, cartas, documentos, pagos ni conversaciones.
        </p>
      </section>

      {manage && (
        <section className="mt-8" aria-labelledby="visitas" data-testid="partner-views">
          <SectionTitle>
            <span id="visitas">Visitas de socios a la página de un cliente</span>
          </SectionTitle>
          <div className="card overflow-hidden">
            {book.views.length === 0 ? (
              <p className="px-5 py-5 text-[14px] text-slate-500">Todavía no hay visitas.</p>
            ) : (
              <ul>
                {book.views.slice(0, 20).map((v, i) => (
                  <li key={`${v.partnerId}-${v.clientId}-${v.at}`} className={`flex flex-wrap justify-between gap-2 px-5 py-2.5 text-[14px] ${i > 0 ? "border-t hairline" : ""}`}>
                    <span className="text-slate-900">{partnerName(v.partnerId)} vio el avance de {v.clientName}</span>
                    <span className="text-slate-500">{new Date(v.at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">Cada visita la registra la base de datos al mostrar la página. El cliente también la ve, en su app.</p>
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2" aria-label="Reglas">
        <div>
          <SectionTitle>Lo que aceptan los socios</SectionTitle>
          <ul className="card space-y-2 px-5 py-4 text-[14px] leading-snug text-slate-700">
            {partnerRules("es", fees).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div>
          <SectionTitle>Para el abogado</SectionTitle>
          <ul className="card space-y-2 px-5 py-4 text-[14px] leading-snug text-slate-700">
            <li>RESPA sección 8: si pagar a un agente o a un oficial de préstamos por referir está permitido cuando hay una hipoteca de por medio.</li>
            <li>Texas (organizaciones de servicios de crédito): qué reglas aplican a pagar por referidos.</li>
            <li>FTC (guías de recomendaciones): cómo debe decir cada socio que recibe una comisión.</li>
            <li>Compartir el avance con un socio: el texto del consentimiento (GLBA y leyes de privacidad), y que los conteos no conviertan esto en un reporte de consumidor (FCRA). Ver docs/PARTNERS.md.</li>
          </ul>
        </div>
      </section>
      {data.demo && viewer && <p className="mt-6 text-xs text-slate-500">Demo: los socios son inventados. Los cambios se guardan solo en este navegador.</p>}
    </main>
  );
}
