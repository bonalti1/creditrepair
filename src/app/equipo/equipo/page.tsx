"use client";

import { useState } from "react";
import { teamActivity } from "@/lib/staff/activity";
import { formatPhone, shortDay } from "@/lib/staff/format";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  deniedReason,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SUMMARIES,
  SCOPE_LABELS,
  STAFF_ROLES,
} from "@/lib/staff/permissions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import { memberName, roundRobinNext, type TeamMember } from "@/lib/staff/team";
import type { StaffRole } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import ActivityList from "@/components/staff/ActivityList";
import { Chip, NoAccess, PRIMARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// The team: who is on it, with which role, and whether they can sign in.
// Administrators only. A person is added with their email or phone (they sign
// in with it), given a role, moved to another role, or deactivated: never
// deleted, so their name stays on everything they did. The team always keeps
// one active administrator, and nobody deactivates themselves.
//
// The round-robin switch is here too: with it on, each new client goes to the
// next active specialist in turn.

const field =
  "h-11 w-full min-w-0 rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const labelClass = "block pb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500";

function MemberRow({
  member,
  isMe,
  assigned,
  onRole,
  onActive,
  busy,
}: {
  member: TeamMember;
  isMe: boolean;
  assigned: number;
  onRole: (role: StaffRole) => void;
  onActive: (active: boolean) => void;
  busy: boolean;
}) {
  const { locale } = useStaffLocale();
  const t = useTx();
  return (
    <li className="flex flex-col gap-3 border-t hairline px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:gap-5" data-testid="member">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] font-semibold text-slate-900">
          <span className={member.active ? "" : "text-slate-500"}>{member.name}</span>
          {isMe && <Chip tone="bg-slate-100 text-slate-600">{t("Tú", "You")}</Chip>}
          {!member.active ? (
            <Chip tone="bg-slate-100 text-slate-600">
              {t(
                `Desactivada desde el ${shortDay(member.deactivatedAt ?? member.invitedAt, "es")}`,
                `Deactivated since ${shortDay(member.deactivatedAt ?? member.invitedAt, "en")}`,
              )}
            </Chip>
          ) : member.pending ? (
            <Chip tone="bg-amber-100 text-blue-900">{t("Todavía no entra", "Hasn't signed in yet")}</Chip>
          ) : null}
        </p>
        <p className="mt-0.5 break-words text-[13px] leading-snug text-slate-500">
          {[member.email, member.phone ? formatPhone(member.phone) : null].filter(Boolean).join(" · ")}
          {t(` · en el equipo desde el ${shortDay(member.invitedAt, "es")}`, ` · on the team since ${shortDay(member.invitedAt, "en")}`)}
          {member.role !== "sales" && member.active ? ` · ${assigned === 1 ? t("1 cliente", "1 client") : t(`${assigned} clientes`, `${assigned} clients`)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`rol-${member.handle}`}>
          {t(`Rol de ${member.name}`, `${member.name}'s role`)}
        </label>
        <select
          id={`rol-${member.handle}`}
          value={member.role}
          disabled={busy}
          onChange={(e) => onRole(e.target.value as StaffRole)}
          className="h-10 rounded-2xl bg-white px-3 text-[14px] font-medium text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300"
        >
          {STAFF_ROLES.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[locale][role]}</option>
          ))}
        </select>
        {member.active ? (
          <button
            type="button"
            onClick={() => onActive(false)}
            disabled={busy || isMe}
            title={isMe ? t("No puedes desactivar tu propia cuenta.", "You can't deactivate your own account.") : undefined}
            className="pressable h-10 rounded-full px-3.5 text-[14px] font-medium text-slate-600 hover:bg-slate-100 disabled:text-slate-300"
          >
            {t("Desactivar", "Deactivate")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onActive(true)}
            disabled={busy}
            className="pressable h-10 rounded-full bg-blue-50 px-3.5 text-[14px] font-semibold text-blue-700 hover:bg-blue-100"
          >
            {t("Reactivar", "Reactivate")}
          </button>
        )}
      </div>
    </li>
  );
}

export default function EquipoPage() {
  const { ready, team, viewer, members, settings, teamEvents, clients, now, reload, can, locale } = useStaff();
  const t = useTx();
  const ROLE_LABEL = ROLE_LABELS[locale];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("specialist");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!ready) return null;
  if (!can("team.manage")) return <NoAccess title={t("Equipo", "Team")} reason={deniedReason("team.manage", locale)} />;

  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) => {
    if (busy) return;
    setBusy(true);
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: done } : { ok: false, text: staffMessage(result.message, locale) });
    if (result.ok) await reload();
    return result.ok;
  };

  const add = async () => {
    const ok = await run(
      () => team.addMember({ name, email, phone, role }, viewer),
      t(`${name.trim()} quedó en el equipo como ${ROLE_LABEL[role].toLowerCase()}.`, `${name.trim()} is on the team as ${ROLE_LABEL[role].toLowerCase()}.`),
    );
    if (ok) {
      setAdding(false);
      setName("");
      setEmail("");
      setPhone("");
    }
  };

  const assignedTo = (handle: string) => clients.filter((c) => c.assignedTo === handle && !c.agreementCancelledAt).length;
  const ordered = [...members].sort((a, b) => Number(b.active) - Number(a.active) || STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role) || a.name.localeCompare(b.name, "es"));
  const next = roundRobinNext(members, settings.lastAutoAssigned);
  const history = teamActivity(teamEvents, members, locale);

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{t("Equipo", "Team")}</h1>
          <p className="mt-0.5 text-[14px] text-slate-500">
            {t(
              `${members.filter((m) => m.active).length} activos · nadie se borra: quien se va se desactiva y su nombre queda en su trabajo.`,
              `${members.filter((m) => m.active).length} active · nobody gets deleted: whoever leaves is deactivated and their name stays on their work.`,
            )}
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-amber-400 px-4 text-[14px] font-semibold text-blue-900 hover:bg-amber-500" data-testid="add-member-open">
            <Icon name="plus" size={16} strokeWidth={2.25} />
            {t("Agregar persona", "Add person")}
          </button>
        )}
      </div>

      {message && (
        <p
          className={`mt-4 rounded-2xl px-4 py-3 text-[14px] leading-snug ${message.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {adding && (
            <section className="card p-5 sm:p-6" data-testid="add-member" aria-labelledby="nuevo">
              <h2 id="nuevo" className="text-[18px] font-semibold text-slate-900">
                {t("Agregar a alguien al equipo", "Add someone to the team")}
              </h2>
              <p className="mt-0.5 text-[14px] leading-snug text-slate-500">
                {t("Entra a la consola con el correo o el teléfono que pongas aquí.", "They sign in to the console with the email or phone you enter here.")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="m-name">{t("Nombre y apellido", "Full name")}</label>
                  <input id="m-name" className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="m-email">{t("Correo", "Email")}</label>
                  <input id="m-email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="m-phone">{t("Teléfono", "Phone")}</label>
                  <input id="m-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(713) 555-1234" />
                </div>
                <div className="sm:col-span-2">
                  <span className={labelClass}>{t("Rol", "Role")}</span>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("Rol", "Role")}>
                    {STAFF_ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={role === r}
                        onClick={() => setRole(r)}
                        className={`rounded-2xl px-3.5 py-3 text-left ${role === r ? "bg-blue-50 ring-2 ring-blue-700" : "bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.08)] hover:bg-slate-50"}`}
                      >
                        <span className="block text-[15px] font-semibold text-slate-900">{ROLE_LABEL[r]}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{ROLE_SUMMARIES[locale][r]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={add} disabled={busy} className={PRIMARY_BUTTON}>
                  {t("Agregar al equipo", "Add to the team")}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="pressable h-12 rounded-full px-5 text-[15px] font-medium text-slate-600 hover:bg-slate-100">
                  {t("Cancelar", "Cancel")}
                </button>
              </div>
            </section>
          )}

          <section aria-labelledby="miembros">
            <SectionTitle>
              <span id="miembros">{t("Personas", "People")}</span>
            </SectionTitle>
            <ul className="card overflow-hidden">
              {ordered.map((member) => (
                <MemberRow
                  key={member.handle}
                  member={member}
                  isMe={member.handle === viewer?.handle}
                  assigned={assignedTo(member.handle)}
                  busy={busy}
                  onRole={(r) =>
                    void run(
                      () => team.changeRole(member.handle, r, viewer),
                      t(`${member.name} ahora es ${ROLE_LABEL[r].toLowerCase()}.`, `${member.name} is now ${ROLE_LABEL[r].toLowerCase()}.`),
                    )
                  }
                  onActive={(active) =>
                    void run(
                      () => team.setActive(member.handle, active, viewer),
                      active
                        ? t(`${member.name} puede volver a entrar.`, `${member.name} can sign in again.`)
                        : t(`${member.name} ya no puede entrar. Su nombre queda en su trabajo.`, `${member.name} can no longer sign in. Their name stays on their work.`),
                    )
                  }
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="permisos">
            <SectionTitle>
              <span id="permisos">{t("Qué puede hacer cada rol", "What each role can do")}</span>
            </SectionTitle>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[14px]">
                <thead>
                  <tr className="border-b hairline text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2.5 font-semibold">{t("Permiso", "Permission")}</th>
                    {STAFF_ROLES.map((r) => (
                      <th key={r} className="px-3 py-2.5 text-center font-semibold">{ROLE_LABEL[r]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b hairline">
                    <td className="px-5 py-2.5 text-slate-700">{t("Qué clientes ve", "Which clients they see")}</td>
                    {STAFF_ROLES.map((r) => (
                      <td key={r} className="px-3 py-2.5 text-center text-[13px] text-slate-600">{SCOPE_LABELS[locale][ROLE_PERMISSIONS[r].scope]}</td>
                    ))}
                  </tr>
                  {CAPABILITIES.map((capability) => (
                    <tr key={capability} className="border-b hairline last:border-b-0">
                      <td className="px-5 py-2.5 text-slate-700">{CAPABILITY_LABELS[locale][capability]}</td>
                      {STAFF_ROLES.map((r) => (
                        <td key={r} className="px-3 py-2.5 text-center">
                          {ROLE_PERMISSIONS[r].can[capability] ? (
                            <span className="inline-flex text-green-700" aria-label={t("Sí", "Yes")}>
                              <Icon name="check" size={18} strokeWidth={2.25} />
                            </span>
                          ) : (
                            <span className="text-slate-300" aria-label="No">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
              {t(
                "Nadie del equipo puede marcar un punto como inexacto: eso lo responde solo el cliente. La base de datos aplica estos mismos límites.",
                "Nobody on the team can mark an item as inaccurate: only the client answers that. The database applies these same limits.",
              )}
            </p>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section aria-labelledby="turnos">
            <SectionTitle>
              <span id="turnos">{t("Asignación por turno", "Assignment by rotation")}</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-[18px] w-[18px] shrink-0 accent-blue-700"
                  checked={settings.autoAssign}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () => team.setAutoAssign(e.target.checked, viewer),
                      e.target.checked
                        ? t("Los clientes nuevos se asignan por turno.", "New clients are assigned by rotation.")
                        : t("Los clientes nuevos quedan sin asignar hasta que alguien los asigne.", "New clients stay unassigned until someone assigns them."),
                    )
                  }
                  data-testid="auto-assign"
                />
                <span>
                  <span className="block text-[15px] font-medium text-slate-900">{t("Asignar clientes nuevos por turno", "Assign new clients by rotation")}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">
                    {t("Cada cliente nuevo va al siguiente especialista activo.", "Each new client goes to the next active specialist.")}{" "}
                    {settings.autoAssign
                      ? next
                        ? t(`El siguiente es ${memberName(members, next, "es")}.`, `Next up is ${memberName(members, next, "en")}.`)
                        : t("Ahora no hay especialistas activos: quedan sin asignar.", "There are no active specialists right now: they stay unassigned.")
                      : t("Apagado: quedan sin asignar.", "Off: they stay unassigned.")}
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section aria-labelledby="cambios">
            <SectionTitle>
              <span id="cambios">{t("Cambios en el equipo", "Team changes")}</span>
            </SectionTitle>
            <div className="card overflow-hidden">
              <ActivityList entries={history.slice(0, 8)} now={now} showClient={false} />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
