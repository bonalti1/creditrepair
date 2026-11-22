"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/billing/rules";
import { PARTNER_COPY } from "@/lib/partners/copy";
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

const STATUS_TONE: Record<PartnerStatus, string> = {
  pending: "bg-amber-100 text-blue-900",
  approved: "bg-green-50 text-green-700",
  declined: "bg-slate-100 text-slate-600",
  suspended: "bg-slate-100 text-slate-600",
};

const control =
  "h-10 w-full min-w-0 rounded-xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300";

function terms(p: Partner): string {
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
                      {terms(p)}
                      {manage && (money.owedCents > 0 || money.paidCents > 0) && (
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
                            <button type="button" className={QUIET_BUTTON} onClick={() => act(() => data.setStatus(p.id, "suspended"), `${p.name} quedó suspendido: su enlace ya no registra referidos y su portal se cierra.`)}>
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

      <section className="mt-8 grid gap-6 lg:grid-cols-2" aria-label="Reglas">
        <div>
          <SectionTitle>Lo que aceptan los socios</SectionTitle>
          <ul className="card space-y-2 px-5 py-4 text-[14px] leading-snug text-slate-700">
            {PARTNER_COPY.es.rules.map((rule) => (
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
          </ul>
        </div>
      </section>
      {data.demo && viewer && <p className="mt-6 text-xs text-slate-500">Demo: los socios son inventados. Los cambios se guardan solo en este navegador.</p>}
    </main>
  );
}
