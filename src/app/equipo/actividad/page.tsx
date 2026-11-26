"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, activityFeed, CLIENT_ACTOR, filterActivity, SYSTEM_ACTOR_KEY, type ActivityType } from "@/lib/staff/activity";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
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
  const { ready, clients, now, members, teamEvents, can, locale } = useStaff();
  const t = useTx();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useState(PAGE);

  const teamChanges = can("team.manage");
  const feed = useMemo(() => activityFeed(clients, members, teamChanges ? teamEvents : [], locale), [clients, members, teamEvents, teamChanges, locale]);

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
  const types = ACTIVITY_TYPES.filter((type) => type !== "team" || teamChanges);

  return (
    <main className="animate-rise">
      <h1 className="page-title">{t("Actividad", "Activity")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        {teamChanges
          ? t("Quién hizo qué y cuándo, en todos los clientes y en el equipo.", "Who did what and when, across every client and the team.")
          : t("Quién hizo qué y cuándo, en tus clientes.", "Who did what and when, across your clients.")}{" "}
        {t("Sale del registro: no se escribe ni se borra a mano.", "It comes from the record: nothing is typed in or deleted by hand.")}
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select aria-label={t("Quién", "Who")} className={control} value={filter.actor ?? ""} onChange={(e) => setParam("quien", e.target.value)}>
          <option value="">{t("Cualquier persona", "Anyone")}</option>
          {members.map((m) => (
            <option key={m.handle} value={m.handle}>
              {m.name}
              {m.active ? "" : t(" (desactivada)", " (deactivated)")}
            </option>
          ))}
          <option value={CLIENT_ACTOR}>{t("El cliente", "The client")}</option>
          <option value={SYSTEM_ACTOR_KEY}>{t("El sistema", "The system")}</option>
        </select>
        <select aria-label={t("Cliente", "Client")} className={control} value={filter.clientId ?? ""} onChange={(e) => setParam("cliente", e.target.value)}>
          <option value="">{t("Todos los clientes", "All clients")}</option>
          {sortedClients.map((c) => (
            <option key={c.id} value={c.id}>{fullName(c)}</option>
          ))}
        </select>
        <select aria-label={t("Tipo", "Type")} className={control} value={filter.type ?? ""} onChange={(e) => setParam("tipo", e.target.value)}>
          <option value="">{t("Todo tipo de actividad", "Any kind of activity")}</option>
          {types.map((type) => (
            <option key={type} value={type}>{ACTIVITY_LABELS[locale][type]}</option>
          ))}
        </select>
      </div>

      <p className="mt-4 px-1 text-[13px] tabular-nums text-slate-500" role="status">
        {entries.length === 1 ? t("1 registro", "1 entry") : t(`${entries.length} registros`, `${entries.length} entries`)}
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
          {t(`Ver ${Math.min(PAGE, entries.length - shown)} más`, `See ${Math.min(PAGE, entries.length - shown)} more`)}
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
