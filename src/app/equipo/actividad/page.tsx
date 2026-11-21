"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ACTIVITY_LABEL, ACTIVITY_TYPES, activityFeed, CLIENT_ACTOR, filterActivity, SYSTEM_ACTOR_KEY, type ActivityType } from "@/lib/staff/activity";
import { fullName } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import ActivityList from "@/components/staff/ActivityList";

// Who did what, when, across every client this member may see: invitations,
// signatures, reports brought in, rounds sent, replies, refunds, pauses,
// assignments, notes. An administrator also sees the team's own changes
// (roles, people added or deactivated, the round-robin). Read-only: built from
// the records, nothing is typed into it and nothing can be removed.

const PAGE = 60;
const control =
  "h-11 w-full min-w-0 rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300";

function Activity() {
  const { ready, clients, now, members, teamEvents, can } = useStaff();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useState(PAGE);

  const teamChanges = can("team.manage");
  const feed = useMemo(() => activityFeed(clients, members, teamChanges ? teamEvents : []), [clients, members, teamEvents, teamChanges]);

  if (!ready) return null;

  const typeParam = params.get("tipo") ?? "";
  const filter = {
    actor: params.get("quien") ?? undefined,
    clientId: params.get("cliente") ?? undefined,
    type: (ACTIVITY_TYPES as readonly string[]).includes(typeParam) ? (typeParam as ActivityType) : undefined,
  };
  const entries = filterActivity(feed, filter);
  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    setShown(PAGE);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const sortedClients = [...clients].sort((a, b) => fullName(a).localeCompare(fullName(b), "es"));
  const types = ACTIVITY_TYPES.filter((t) => t !== "team" || teamChanges);

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">Actividad</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        Quién hizo qué y cuándo{teamChanges ? ", en todos los clientes y en el equipo" : ", en tus clientes"}. Sale del registro: no se
        escribe ni se borra a mano.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select aria-label="Quién" className={control} value={filter.actor ?? ""} onChange={(e) => setParam("quien", e.target.value)}>
          <option value="">Cualquier persona</option>
          {members.map((m) => (
            <option key={m.handle} value={m.handle}>
              {m.name}
              {m.active ? "" : " (desactivada)"}
            </option>
          ))}
          <option value={CLIENT_ACTOR}>El cliente</option>
          <option value={SYSTEM_ACTOR_KEY}>El sistema</option>
        </select>
        <select aria-label="Cliente" className={control} value={filter.clientId ?? ""} onChange={(e) => setParam("cliente", e.target.value)}>
          <option value="">Todos los clientes</option>
          {sortedClients.map((c) => (
            <option key={c.id} value={c.id}>{fullName(c)}</option>
          ))}
        </select>
        <select aria-label="Tipo" className={control} value={filter.type ?? ""} onChange={(e) => setParam("tipo", e.target.value)}>
          <option value="">Todo tipo de actividad</option>
          {types.map((t) => (
            <option key={t} value={t}>{ACTIVITY_LABEL[t]}</option>
          ))}
        </select>
      </div>

      <p className="mt-4 px-1 text-[13px] tabular-nums text-slate-500" role="status">
        {entries.length === 1 ? "1 registro" : `${entries.length} registros`}
      </p>
      <div className="card mt-2 overflow-hidden">
        <ActivityList entries={entries.slice(0, shown)} now={now} />
      </div>
      {entries.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="pressable mt-3 flex h-11 w-full items-center justify-center rounded-full bg-slate-100 text-[14px] font-medium text-slate-900 hover:bg-slate-200"
        >
          Ver {Math.min(PAGE, entries.length - shown)} más
        </button>
      )}
    </main>
  );
}

export default function Actividad() {
  return (
    <Suspense fallback={null}>
      <Activity />
    </Suspense>
  );
}
