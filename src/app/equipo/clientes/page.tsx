"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BILLING_STATE_LABEL, BILLING_STATES, clientRows, clientsCsv, filterRows } from "@/lib/staff/clientList";
import { count, formatPhone, relativeDay, stateName } from "@/lib/staff/format";
import { defaultsToMine, deniedReason, scopeOf } from "@/lib/staff/permissions";
import { EXCEPTION_KINDS, EXCEPTION_LABEL, RESPONSE_WINDOW_DAYS, sendableRound, STAGE_ORDER, STAGES, type Stage } from "@/lib/staff/stage";
import { assignableMembers, memberName } from "@/lib/staff/team";
import { fullName } from "@/lib/staff/types";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import AddClient from "@/components/staff/AddClient";
import { ActorTag, DeniedNote, SeverityDot, StageChip } from "@/components/staff/ui";

// Every client this member may see, findable in a few keystrokes. Filters live
// in the address, so a stage on the home screen links straight to its clients
// and a filtered list can be bookmarked. A specialist sees the clients assigned
// to them and a salesperson the ones they brought in ("Mis clientes"); an
// administrator sees everyone and can narrow to their own.
//
// Rows can be selected for what the role allows: assign them, send the rounds
// that are ready (the same send the home screen uses), or take a CSV of what
// the list shows, without anything sensitive in it.

const control =
  "h-11 w-full min-w-0 rounded-2xl bg-white px-3.5 text-[15px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300";
const SMALL = "pressable inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold";

function ClientList() {
  const { data, team, ready, clients, now, reload, viewer, members, can } = useStaff();
  // The automatic follow-ups: a notice they are still working on is not listed as a person's.
  const { env } = useAutopilot();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Typed text is kept here as well as in the address, so typing never waits on navigation.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scope = scopeOf(viewer?.role);
  const seesAll = scope === "all";
  const mine = !seesAll || params.get("vista") === "mios";
  const stageParam = params.get("etapa") ?? "";
  const stage = (STAGE_ORDER as readonly string[]).includes(stageParam) ? (stageParam as Stage) : "";
  const noticeParam = params.get("aviso") ?? "";
  const noticeFilter = noticeParam === "alguno" ? "any" : (EXCEPTION_KINDS as readonly string[]).includes(noticeParam) ? noticeParam : "";
  const filters = {
    mine: seesAll && mine,
    query,
    stage,
    notice: noticeFilter,
    assigned: params.get("asignado") ?? "",
    seller: params.get("vendedor") ?? "",
    billing: can("billing.view") ? (params.get("cobros") ?? "") : "",
    state: params.get("estado") ?? "",
  };
  const filtered = Boolean(query || stage || noticeFilter || filters.assigned || filters.seller || filters.billing || filters.state);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const rows = useMemo(
    () =>
      clientRows(clients, viewer, now, env).sort(
        (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || fullName(a.client).localeCompare(fullName(b.client), "es"),
      ),
    [clients, viewer, now, env],
  );
  const sellers = useMemo(() => [...new Set(clients.map((c) => c.salesperson))].sort(), [clients]);
  const states = useMemo(() => [...new Set(clients.map((c) => c.state))].sort(), [clients]);

  if (!ready || !viewer) return null;

  const shown = filterRows(rows, filters, viewer);
  const base = filterRows(rows, { mine: filters.mine }, viewer);
  const chosen = shown.filter((r) => selected.has(r.client.id));
  const canAssign = can("clients.assign");
  const canSend = can("rounds.send");
  const canExport = can("clients.export");
  const selectable = canAssign || canSend || canExport;
  const allChosen = shown.length > 0 && chosen.length === shown.length;
  const readyToSend = chosen.flatMap((r) => {
    const round = sendableRound(r.client, now);
    return round ? [{ clientId: r.client.id, roundNumber: round.number }] : [];
  });
  const assignable = assignableMembers(members);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const assign = async () => {
    if (!assignTo || chosen.length === 0 || busy) return;
    setBusy(true);
    const to = assignTo === "none" ? null : assignTo;
    const result = await team.assignClients(chosen.map((r) => r.client.id), to, viewer);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setNotice(
      result.count === 0
        ? "Nada cambió: ya estaban así."
        : `${count(result.count ?? 0, "cliente", "clientes")} ${to ? `con ${memberName(members, to)}` : "sin asignar"}.`,
    );
    setSelected(new Set());
    await reload();
  };

  const send = async () => {
    if (readyToSend.length === 0 || busy) return;
    setBusy(true);
    // The same send the home screen uses: the data layer checks again that each round may go out now.
    await data.markRoundsSent(readyToSend);
    setBusy(false);
    setNotice(`${count(readyToSend.length, "ronda enviada", "rondas enviadas")}. El sistema vuelve a importar cada reporte en ${RESPONSE_WINDOW_DAYS} días.`);
    setSelected(new Set());
    await reload();
  };

  const exportCsv = () => {
    const rowsOut = chosen.length > 0 ? chosen : shown;
    const blob = new Blob([clientsCsv(rowsOut, members)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes-${now.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const title = mine ? "Mis clientes" : "Clientes";
  const scopeLine =
    scope === "assigned"
      ? "Los clientes que el equipo te asignó."
      : scope === "brought"
        ? "Las personas que tú trajiste."
        : mine
          ? "Los que tienes asignados o que tú trajiste."
          : null;

  return (
    <main className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-0.5 text-[14px] tabular-nums text-slate-500" role="status">
            {scopeLine ? `${scopeLine} ` : ""}
            {filtered ? `${shown.length} de ${base.length}` : `${base.length} en total`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <button type="button" onClick={exportCsv} className={`${SMALL} bg-slate-100 text-slate-900 hover:bg-slate-200`} data-testid="export-csv">
              <Icon name="download" size={16} />
              {chosen.length > 0 ? `Exportar ${chosen.length}` : "Exportar CSV"}
            </button>
          )}
          {can("clients.add") && !adding && (
            <button type="button" onClick={() => setAdding(true)} className={`${SMALL} bg-amber-400 text-blue-900 hover:bg-amber-500`} data-testid="add-client-open">
              <Icon name="plus" size={16} strokeWidth={2.25} />
              Agregar cliente
            </button>
          )}
        </div>
      </div>

      {seesAll && (
        <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1" role="group" aria-label="Qué clientes ver">
          {[
            ["", "Todos"],
            ["mios", "Mis clientes"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(params.get("vista") ?? "") === value}
              onClick={() => setParam("vista", value)}
              className={`pressable h-8 rounded-full px-3.5 text-[13px] font-semibold ${
                (params.get("vista") ?? "") === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-5">
          <AddClient viewer={viewer} members={members} team={team} onClose={() => setAdding(false)} onAdded={reload} />
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setParam("q", e.target.value);
            }}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar por nombre o teléfono"
            className={`${control} pl-10 placeholder:text-slate-400`}
          />
        </div>
        <select aria-label="Etapa" className={control} value={stage} onChange={(e) => setParam("etapa", e.target.value)}>
          <option value="">Todas las etapas</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGES[s].label}</option>
          ))}
        </select>
        <select aria-label="Avisos" className={control} value={noticeParam} onChange={(e) => setParam("aviso", e.target.value)}>
          <option value="">Con o sin avisos</option>
          <option value="alguno">Necesita una persona</option>
          {EXCEPTION_KINDS.map((k) => (
            <option key={k} value={k}>{EXCEPTION_LABEL[k]}</option>
          ))}
        </select>
        {seesAll && (
          <select aria-label="Quién lo trabaja" className={control} value={filters.assigned} onChange={(e) => setParam("asignado", e.target.value)}>
            <option value="">Lo trabaje quien sea</option>
            <option value="none">Sin asignar</option>
            {members
              .filter((m) => m.role !== "sales")
              .map((m) => (
                <option key={m.handle} value={m.handle}>
                  {m.name}
                  {m.active ? "" : " (desactivada)"}
                </option>
              ))}
          </select>
        )}
        {scope !== "brought" && (
          <select aria-label="Ventas" className={control} value={filters.seller} onChange={(e) => setParam("vendedor", e.target.value)}>
            <option value="">Lo trajo quien sea</option>
            {sellers.map((s) => (
              <option key={s} value={s}>{memberName(members, s)}</option>
            ))}
          </select>
        )}
        {can("billing.view") && (
          <select aria-label="Cobros" className={control} value={filters.billing} onChange={(e) => setParam("cobros", e.target.value)}>
            <option value="">Cualquier estado de cobro</option>
            {BILLING_STATES.map((b) => (
              <option key={b} value={b}>{BILLING_STATE_LABEL[b]}</option>
            ))}
          </select>
        )}
        {states.length > 1 && (
          <select aria-label="Estado" className={control} value={filters.state} onChange={(e) => setParam("estado", e.target.value)}>
            <option value="">Todos los estados</option>
            {states.map((s) => (
              <option key={s} value={s}>{stateName(s)}</option>
            ))}
          </select>
        )}
      </div>

      {filtered && (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            const keep = params.get("vista");
            router.replace(keep ? `${pathname}?vista=${keep}` : pathname, { scroll: false });
          }}
          className="mt-3 px-1 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
        >
          Quitar filtros
        </button>
      )}

      {notice && (
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
          <Icon name="check" size={18} className="mt-px shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      {selectable && chosen.length > 0 && (
        <div className="card sticky top-[7.5rem] z-10 mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 lg:top-[6.5rem]" data-testid="bulk-bar">
          <p className="text-[14px] font-semibold text-slate-900">{count(chosen.length, "seleccionado", "seleccionados")}</p>
          {canAssign ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <select
                aria-label="Asignar a"
                className="h-10 w-48 min-w-0 rounded-2xl bg-white px-3 text-[14px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none focus:ring-2 focus:ring-blue-300"
                value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Asignar a…</option>
                {assignable.map((m) => (
                  <option key={m.handle} value={m.handle}>{m.name}</option>
                ))}
                <option value="none">Nadie (sin asignar)</option>
              </select>
              <button type="button" onClick={assign} disabled={!assignTo || busy} className={`${SMALL} bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:text-slate-400`}>
                Asignar
              </button>
            </div>
          ) : null}
          {canSend && (
            <button
              type="button"
              onClick={send}
              disabled={readyToSend.length === 0 || busy}
              className={`${SMALL} bg-amber-400 text-blue-900 hover:bg-amber-500 disabled:bg-slate-100 disabled:text-slate-500`}
              title={readyToSend.length === 0 ? "Ninguno de los seleccionados tiene una ronda lista para enviar." : undefined}
            >
              {readyToSend.length === 0 ? "Sin rondas listas" : `Enviar ${count(readyToSend.length, "ronda lista", "rondas listas")}`}
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
            Quitar selección
          </button>
          {!canAssign && <DeniedNote>{deniedReason("clients.assign")}</DeniedNote>}
        </div>
      )}

      <div className="card mt-4 overflow-hidden">
        <div
          className={`hidden gap-4 border-b hairline px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid ${
            selectable ? "grid-cols-[1.25rem_minmax(0,1.3fr)_12rem_minmax(0,1.5fr)_8rem_6.5rem]" : "grid-cols-[minmax(0,1.3fr)_12rem_minmax(0,1.5fr)_8rem_6.5rem]"
          }`}
        >
          {selectable && (
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-700"
              aria-label="Seleccionar todos los que se ven"
              checked={allChosen}
              onChange={() => setSelected(allChosen ? new Set() : new Set(shown.map((r) => r.client.id)))}
            />
          )}
          <span>Cliente</span>
          <span>Etapa</span>
          <span>Qué sigue</span>
          <span>Trabaja el caso</span>
          <span>Actividad</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-5 py-8 text-center text-[15px] text-slate-500">
            {base.length === 0
              ? scope === "assigned"
                ? "Todavía no tienes clientes asignados."
                : "Todavía no hay clientes aquí."
              : "Ningún cliente coincide con estos filtros."}
          </p>
        ) : (
          <ul>
            {shown.map(({ client, stage: s, exceptions, step }, index) => (
              <li key={client.id} className={`flex items-stretch ${index > 0 ? "border-t hairline" : ""}`}>
                {selectable && (
                  <label className="flex w-11 shrink-0 cursor-pointer items-start justify-end pl-3 pt-[18px] lg:w-[2.6rem] lg:items-center lg:justify-start lg:pl-5 lg:pt-0">
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] accent-blue-700 lg:h-4 lg:w-4"
                      checked={selected.has(client.id)}
                      onChange={() => toggle(client.id)}
                      aria-label={`Seleccionar a ${fullName(client)}`}
                    />
                  </label>
                )}
                <Link
                  href={`/equipo/clientes/${client.id}`}
                  className={`pressable grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3.5 pr-5 hover:bg-slate-50 ${
                    selectable ? "pl-3 lg:pl-3.5 lg:grid-cols-[minmax(0,1.3fr)_12rem_minmax(0,1.5fr)_8rem_6.5rem]" : "pl-5 lg:grid-cols-[minmax(0,1.3fr)_12rem_minmax(0,1.5fr)_8rem_6.5rem]"
                  }`}
                >
                  <span className="flex min-w-0 gap-2.5">
                    {exceptions[0] ? <SeverityDot severity={exceptions[0].severity} /> : <span className="mt-[7px] h-2.5 w-2.5 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block break-words text-[16px] font-medium leading-snug text-slate-900">{fullName(client)}</span>
                      <span className="block text-[13px] text-slate-500 lg:truncate">
                        {formatPhone(client.phone)} · ventas: {memberName(members, client.salesperson).split(" ")[0]}
                      </span>
                    </span>
                  </span>
                  <span className="justify-self-end lg:justify-self-start">
                    <StageChip stage={s} />
                  </span>
                  <span className="col-span-2 min-w-0 pl-5 lg:col-span-1 lg:pl-0">
                    <ActorTag actor={step.actor} />
                    <span className="block text-[14px] leading-snug text-slate-700">{step.text}</span>
                    {exceptions.length > 0 && (
                      <span className="block text-[13px] leading-snug text-slate-500">
                        Aviso: {exceptions.map((e) => EXCEPTION_LABEL[e.kind].toLowerCase()).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="col-span-2 pl-5 text-[13px] text-slate-600 lg:col-span-1 lg:pl-0">
                    <span className="lg:hidden">Trabaja el caso: </span>
                    {client.assignedTo ? (
                      memberName(members, client.assignedTo)
                    ) : (
                      <span className="text-slate-400">Sin asignar</span>
                    )}
                  </span>
                  <span className="col-span-2 pl-5 text-[13px] text-slate-500 lg:col-span-1 lg:pl-0">
                    <span className="lg:hidden">Última actividad: </span>
                    {relativeDay(client.lastActivityAt, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canExport && (
        <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
          El CSV lleva lo que ves en la lista, sin teléfono, correo, dirección, reporte ni cobros.
        </p>
      )}
    </main>
  );
}

export default function Clientes() {
  return (
    <Suspense fallback={null}>
      <ClientList />
    </Suspense>
  );
}
