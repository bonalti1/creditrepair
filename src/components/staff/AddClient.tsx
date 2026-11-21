"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ALL_STATES, stateStatus } from "@/lib/compliance/states";
import { buildInvitePath, GOALS, inviteMessageEs, type GoalKey } from "@/lib/sales/invite";
import { whatsappHref } from "@/lib/staff/messages";
import type { Viewer } from "@/lib/staff/permissions";
import type { NewClientField, TeamMember } from "@/lib/staff/team";
import type { TeamData } from "@/lib/staff/teamData";
import { fullName, type StaffClient } from "@/lib/staff/types";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/staff/ui";

// "Agregar cliente": someone sales talked to, added by hand, as a prospect.
// Then the same invitation the invite page makes (sales/invite.ts: the same
// link and the same message, not a copy of it), ready to send by WhatsApp.
//
// Only what sales needs to start: name, phone, an optional email, state and
// goal. There is no field for a Social Security number or a date of birth, and
// there must never be one: the client gives their identity data themselves,
// in their own app.

const field =
  "h-11 w-full rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const labelClass = "block pb-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500";
const STATES = ["TX", ...ALL_STATES.filter((s) => s !== "TX")];

export default function AddClient({
  viewer,
  members,
  team,
  onClose,
  onAdded,
}: {
  viewer: Viewer;
  members: TeamMember[];
  team: TeamData;
  onClose: () => void;
  onAdded: (client: StaffClient) => Promise<void> | void;
}) {
  const sellers = members.filter((m) => m.active && (m.role === "sales" || m.role === "admin"));
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState("TX");
  const [goal, setGoal] = useState<GoalKey>("general");
  const [seller, setSeller] = useState(viewer.handle);
  const [problems, setProblems] = useState<Partial<Record<NewClientField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<StaffClient | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await team.addClient({ firstName, lastName, phone, email, state, goal, salesperson: seller }, viewer);
    setBusy(false);
    if (!result.ok) {
      setProblems(result.problems ?? {});
      setError(result.message);
      return;
    }
    setProblems({});
    setAdded(result.client);
    await onAdded(result.client);
  };

  if (added) {
    const credited = members.find((m) => m.handle === added.salesperson);
    const url = origin + buildInvitePath({ name: added.firstName, goal: added.goal as GoalKey, state: added.state, ref: added.salesperson, refName: credited?.name.split(" ")[0] ?? null });
    const message = inviteMessageEs({ name: added.firstName }, url);
    const assigned = added.assignedTo ? members.find((m) => m.handle === added.assignedTo)?.name : null;
    return (
      <section className="card p-5 sm:p-6" data-testid="add-client-done" aria-live="polite">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-green-700">
          <Icon name="check" size={18} />
          {fullName(added)} quedó como prospecto
        </p>
        <p className="mt-1 text-[14px] leading-snug text-slate-500">
          Ventas: {credited?.name ?? added.salesperson}.{" "}
          {assigned ? `Lo trabajará ${assigned} (asignación por turno).` : "Todavía nadie del equipo lo tiene asignado."}
        </p>
        <p className={`${labelClass} mt-4`}>Mensaje listo para enviar</p>
        <p className="whitespace-pre-line break-words rounded-2xl bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-900">
          {message.split(url).flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="break-all">{url}</span>, part]))}
        </p>
        {stateStatus(added.state) !== "open" && (
          <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
            Todavía no abrimos en {added.state}. El enlace lo llevará a la lista de espera, no a la app.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={whatsappHref(added.phone, message)} target="_blank" rel="noopener noreferrer" className={PRIMARY_BUTTON}>
            Enviar por WhatsApp
          </a>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message);
                setCopied(true);
              } catch {
                // Clipboard blocked: the text is on screen to select by hand.
              }
            }}
          >
            {copied ? "Mensaje copiado" : "Copiar mensaje"}
          </button>
          <Link href={`/equipo/clientes/${added.id}`} className={SECONDARY_BUTTON}>
            Ver su ficha
          </Link>
        </div>
        <button type="button" onClick={onClose} className="mt-3 text-[14px] font-medium text-blue-700 underline-offset-2 hover:underline">
          Cerrar
        </button>
      </section>
    );
  }

  const err = (name: NewClientField) =>
    problems[name] ? (
      <p className="mt-1 text-[13px] leading-snug text-red-700" role="alert">
        {problems[name]}
      </p>
    ) : null;

  return (
    <section className="card p-5 sm:p-6" data-testid="add-client" aria-labelledby="agregar-titulo">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="agregar-titulo" className="text-[18px] font-semibold text-slate-900">
            Agregar cliente
          </h2>
          <p className="mt-0.5 text-[14px] leading-snug text-slate-500">
            Queda como prospecto y te damos su invitación lista para enviar.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-[14px] font-medium text-slate-500 hover:text-slate-900">
          Cancelar
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="nc-first">Nombre</label>
          <input id="nc-first" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
          {err("firstName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-last">Apellido</label>
          <input id="nc-last" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
          {err("lastName")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-phone">WhatsApp</label>
          <input id="nc-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(713) 555-1234" />
          {err("phone")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-email">Correo (opcional)</label>
          <input id="nc-email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="off" />
          {err("email")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-state">Estado donde vive</label>
          <select id="nc-state" className={field} value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>{s === "TX" ? "Texas (TX)" : s}</option>
            ))}
          </select>
          {err("state")}
        </div>
        <div>
          <label className={labelClass} htmlFor="nc-goal">Su meta</label>
          <select id="nc-goal" className={field} value={goal} onChange={(e) => setGoal(e.target.value as GoalKey)}>
            {GOALS.map((g) => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
          {err("goal")}
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="nc-seller">Quién de ventas lo trae</label>
          {viewer.role === "sales" ? (
            <p className="flex h-11 items-center rounded-2xl bg-slate-50 px-3.5 text-[15px] text-slate-700">{viewer.name} (tú)</p>
          ) : (
            <select id="nc-seller" className={field} value={seller} onChange={(e) => setSeller(e.target.value)}>
              {sellers.map((m) => (
                <option key={m.handle} value={m.handle}>{m.name}</option>
              ))}
            </select>
          )}
          {err("salesperson")}
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-snug text-slate-500">
        No pedimos su número de Seguro Social ni su fecha de nacimiento: el cliente los da él mismo en su app.
      </p>
      {error && Object.keys(problems).length === 0 && (
        <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4">
        <button type="button" onClick={save} disabled={busy} className={PRIMARY_BUTTON}>
          Agregar y preparar invitación
        </button>
      </div>
    </section>
  );
}
