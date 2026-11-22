"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { count, shortDay } from "@/lib/staff/format";
import { followupsInProgress, sentBetween, workQueue, workSummary, type QueueItem } from "@/lib/autopilot/queue";
import { autoSendState } from "@/lib/autopilot/sending";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import type { AutopilotSettings } from "@/lib/autopilot/types";
import { nextStepFor } from "@/lib/staff/clientList";
import { roundRefsHref, sendRefsHref } from "@/lib/staff/printBatch";
import { useMail } from "@/lib/mail/useMail";
import {
  ACTOR_LABEL,
  clientStage,
  formatDay,
  HANDLED_QUIET_DAYS,
  RESPONSE_WINDOW_DAYS,
  roundItemCount,
  sendableRound,
  PIPELINE_STAGES,
  STAGE_ORDER,
  STAGES,
  type Stage,
} from "@/lib/staff/stage";
import { fullName, type StaffClient, type StaffRound } from "@/lib/staff/types";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { FOLLOWUP_SCHEDULES } from "@/lib/autopilot/followups";
import { FocusMode, QueueList } from "@/components/staff/WorkQueue";
import Icon from "@/components/Icon";
import NewLeadsCard from "@/components/staff/NewLeadsCard";
import {
  PRIMARY_BUTTON,
  PRIMARY_BUTTON_COMPACT,
  QUIET_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  SectionTitle,
} from "@/components/staff/ui";

// The team's home. One queue of what truly needs a person, in the order to
// do it, each with why, what the system already tried, roughly how long it
// takes, how long it has waited and when it is due, and the one button that
// fixes it; "Siguiente" walks it one item at a time. The routine follow-up
// and, when the owner turns it on, the sending run by themselves
// (src/lib/autopilot): the right column shows what the system is doing.
//
// Billing is in the last group. The system charges each round after it is
// mailed and retries a declined payment by itself; nothing on this page asks
// anyone to charge a client. Money reaches the first list only when it needs
// a person: the retries are used up, or a charge is due and there is no
// payment method on file.

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function EquipoHome() {
  const { data, ready: clientsReady, clients, now, reload, viewer, can } = useStaff();
  // What this member's role takes care of: sales follows people until the work starts; only some roles send.
  const sends = can("rounds.send");
  // The furnisher address book: a round with a letter to a company that has no checked address is held.
  const { furnishers, ready: bookReady } = useMail();
  const ready = clientsReady && bookReady;
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // The autopilot's switches and channels (src/lib/autopilot).
  const { autopilot, env, ready: autopilotReady, reload: reloadAutopilot } = useAutopilot();
  const [focus, setFocus] = useState<number | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdError, setHoldError] = useState<string | null>(null);

  const view = useMemo(() => {
    const queue: QueueItem[] = workQueue(clients, now, { furnishers, autopilot: env }, viewer?.role ?? null);
    const sendable: Array<{ client: StaffClient; round: StaffRound }> = [];
    const quiet: StaffClient[] = [];
    const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<Stage, number>;
    const withItems = new Set(queue.map((item) => item.client.id));

    for (const client of clients) {
      const stage = clientStage(client, now);
      byStage[stage] += 1;
      const round = sends ? sendableRound(client, now, { furnishers }) : null;
      if (round) sendable.push({ client, round });
      // A client who cancelled is not moving along on their own: they are out.
      if (!withItems.has(client.id) && !round && stage !== "cancelled") quiet.push(client);
    }
    // What the system does soonest comes first (a charge tomorrow, a retry), then whoever a person is waited on.
    const when = (client: StaffClient) => nextStepFor(client, now, viewer).at ?? "9999";
    quiet.sort((a, b) => when(a).localeCompare(when(b)));
    // What the system is doing: reminders in progress, and what it sent in the last day.
    const working = clients.flatMap((client) => followupsInProgress(client, now, env).map((state) => ({ client, state })));
    working.sort((a, b) => (a.state.next?.dueAt ?? "").localeCompare(b.state.next?.dueAt ?? ""));
    const sentToday = sentBetween(clients, new Date(now.getTime() - 24 * 60 * 60 * 1000), now);
    return { queue, sendable, quiet, byStage, working, sentToday };
  }, [clients, now, viewer, sends, furnishers, env]);

  // Every prepared round starts selected: sending them all is the routine.
  useEffect(() => {
    if (ready && selected === null) setSelected(new Set(view.sendable.map((s) => s.client.id)));
  }, [ready, selected, view.sendable]);

  if (!ready || !autopilotReady) return null;

  const chosen = view.sendable.filter((s) => selected?.has(s.client.id));
  const allChosen = view.sendable.length > 0 && chosen.length === view.sendable.length;

  const toggle = (clientId: string) => {
    const next = new Set(selected);
    if (next.has(clientId)) next.delete(clientId);
    else next.add(clientId);
    setSelected(next);
  };

  const markHandled = async (item: QueueItem) => {
    await data.resolveException(item.client.id, item.exception.key);
    await reload();
  };

  const hold = async (clientId: string) => {
    const result = await autopilot.hold(clientId, holdReason, staffAuthor());
    if (!result.ok) {
      setHoldError(result.message);
      return;
    }
    setHolding(null);
    setHoldReason("");
    setHoldError(null);
    await Promise.all([reload(), reloadAutopilot()]);
  };
  const release = async (clientId: string) => {
    await autopilot.release(clientId, staffAuthor());
    await Promise.all([reload(), reloadAutopilot()]);
  };

  const work = workSummary(view.queue);

  const weekday = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const today = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const summary = [
    ...(sends
      ? [
          view.sendable.length === 0
            ? "ninguna ronda por enviar"
            : `${count(view.sendable.length, "ronda lista", "rondas listas")} para enviar`,
        ]
      : []),
    `${count(view.quiet.length, "cliente avanza solo", "clientes avanzan solos")}`,
  ];
  const leads = clients.filter((c) => clientStage(c, now) === "lead");

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
        {greeting(now)}
        {viewer ? `, ${viewer.name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        {today}. {summary.join(" · ")}.
      </p>

      <section className="card mt-5 flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="hoy" data-testid="today-work">
        <div className="min-w-0">
          <h2 id="hoy" className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900 tabular-nums">
            Trabajo de hoy: {count(work.count, "cosa", "cosas")} · ~{work.minutes} minutos
          </h2>
          <p className="mt-1 text-[14px] leading-snug text-slate-600">
            {work.count === 0
              ? "Nada necesita una persona ahora."
              : work.overdue > 0
                ? `${count(work.overdue, "ya pasó su plazo", "ya pasaron su plazo")}. Empieza por arriba.`
                : "Todo dentro de su plazo."}{" "}
            {env.settings.followupsEnabled
              ? `El sistema sigue ${count(view.working.length, "recordatorio", "recordatorios")} por su cuenta y envió ${count(view.sentToday.length, "mensaje", "mensajes")} en las últimas 24 horas.`
              : "Los recordatorios automáticos están apagados: los avisos llegan aquí como antes."}
          </p>
        </div>
        {work.count > 0 && (
          <button type="button" onClick={() => setFocus(0)} className={`${PRIMARY_BUTTON} shrink-0 gap-2`} data-testid="focus-start">
            Siguiente
            <Icon name="chevron" size={18} />
          </button>
        )}
      </section>

      {focus !== null && (
        <FocusMode
          items={view.queue}
          index={focus}
          now={now}
          onIndex={setFocus}
          onHandled={async (item) => {
            await markHandled(item);
          }}
          onClose={() => setFocus(null)}
        />
      )}

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="necesita">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{view.queue.length}</span>}>
            <span id="necesita">Necesita una persona</span>
          </SectionTitle>

          {view.queue.length === 0 ? (
            <div className="card flex items-center gap-3 px-5 py-6 text-[15px] text-slate-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-700">
                <Icon name="check" size={18} />
              </span>
              Nada necesita una persona ahora.
            </div>
          ) : (
            <QueueList items={view.queue} now={now} onHandled={markHandled} />
          )}
          {view.queue.length > 0 && (
            <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
              En orden: lo vencido primero, luego por plazo. Los minutos son estimados. «Atendido» quita el aviso de la lista; si en{" "}
              {HANDLED_QUIET_DAYS} días la situación sigue igual, vuelve a aparecer.
            </p>
          )}
        </section>

        <div className="space-y-6">
          <NewLeadsCard clients={clients} now={now} canInvite={can("clients.invite")} />
          {!sends && (
            <section aria-labelledby="prospectos">
              <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{leads.length}</span>}>
                <span id="prospectos">Tus prospectos</span>
              </SectionTitle>
              <div className="card px-5 py-4">
                {leads.length === 0 ? (
                  <p className="text-[14px] leading-snug text-slate-500">No tienes prospectos sin cuenta.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {leads.slice(0, 6).map((client) => (
                      <li key={client.id} className="text-[13px] leading-snug">
                        <Link href={`/equipo/clientes/${client.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                          {fullName(client)}
                        </Link>
                        <span className="block text-slate-500">Sin cuenta todavía · primer contacto el {shortDay(client.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {can("clients.add") && (
                  <Link href="/equipo/clientes" className="mt-3 block text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                    Agregar un cliente
                  </Link>
                )}
              </div>
            </section>
          )}
          {sends && (
          <section aria-labelledby="listas">
            <SectionTitle
              aside={
                view.sendable.length > 1 ? (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-700"
                      checked={allChosen}
                      onChange={() => setSelected(allChosen ? new Set() : new Set(view.sendable.map((s) => s.client.id)))}
                    />
                    Todas
                  </label>
                ) : undefined
              }
            >
              <span id="listas">Listas para enviar</span>
            </SectionTitle>

            <div className="card overflow-hidden">
              <p className="border-b hairline px-5 py-2.5 text-[13px] leading-snug text-slate-600" data-testid="autosend-line">
                {env.settings.roundsEnabled ? (
                  <>
                    <span className="font-semibold text-green-700">Envío automático encendido.</span> Cada ronda espera{" "}
                    {env.settings.reviewWindowHours} h aquí y sale sola si nadie la detiene.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-slate-700">Envío automático apagado.</span> Las envía una persona.
                  </>
                )}
              </p>

              {view.sendable.length === 0 ? (
                <p className="px-5 py-5 text-[14px] leading-snug text-slate-500">
                  No hay rondas esperando envío. Aparecen aquí en cuanto el sistema prepara las cartas.
                </p>
              ) : (
                <>
                  <ul>
                    {view.sendable.map(({ client, round }, index) => (
                      <Fragment key={client.id}>
                      <li className={`flex items-center gap-3 px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`}>
                        <input
                          id={`send-${client.id}`}
                          type="checkbox"
                          className="h-[18px] w-[18px] shrink-0 accent-blue-700"
                          checked={selected?.has(client.id) ?? false}
                          onChange={() => toggle(client.id)}
                        />
                        <label htmlFor={`send-${client.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-[15px] font-medium text-slate-900">{fullName(client)}</span>
                          <span className="block text-[13px] text-slate-500">
                            Ronda {round.number} · {count(round.letters.length, "carta", "cartas")} ·{" "}
                            {count(roundItemCount(round), "punto", "puntos")}
                          </span>
                          {/* Not a reason to hold the letters: the charge comes after, and the client is asked then. */}
                          {!client.billing.paymentMethod && (
                            <span className="block text-[13px] text-slate-500" data-testid="no-method-note">
                              Todavía sin método de pago
                            </span>
                          )}
                          <AutoSendLine client={client} round={round} now={now} settings={env.settings} />
                        </label>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Link
                            href={`/equipo/clientes/${client.id}#cartas`}
                            className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
                          >
                            Ver cartas
                          </Link>
                          {env.settings.roundsEnabled &&
                            (client.holds ?? []).some((h) => !h.releasedAt) ? (
                              <button type="button" onClick={() => release(client.id)} className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                                Soltar
                              </button>
                            ) : env.settings.roundsEnabled ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setHolding(holding === client.id ? null : client.id);
                                  setHoldError(null);
                                }}
                                className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
                                data-testid="hold-button"
                              >
                                Detener
                              </button>
                            ) : null}
                        </span>
                      </li>
                      {holding === client.id && (
                        <li className="border-t hairline bg-slate-50 px-5 py-3">
                          <label htmlFor={`hold-${client.id}`} className="block text-[13px] font-medium text-slate-700">
                            ¿Por qué se detiene? Queda en el registro.
                          </label>
                          <textarea
                            id={`hold-${client.id}`}
                            value={holdReason}
                            onChange={(e) => setHoldReason(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px]"
                            placeholder="Por ejemplo: quiere revisar una carta antes de que salga"
                          />
                          {holdError && <p className="mt-1 text-[13px] text-red-700">{holdError}</p>}
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => hold(client.id)} className={SECONDARY_BUTTON_COMPACT}>
                              Detener el piloto automático
                            </button>
                            <button type="button" onClick={() => setHolding(null)} className={QUIET_BUTTON}>
                              Cancelar
                            </button>
                          </div>
                        </li>
                      )}
                      </Fragment>
                    ))}
                  </ul>
                  <div className="border-t hairline px-5 py-4">
                    <div className="grid grid-cols-2 gap-2">
                      {/* Sending opens the send screen: addresses, mail class per letter and cost, then confirm. */}
                      {chosen.length === 0 ? (
                        <button type="button" disabled className={`${PRIMARY_BUTTON_COMPACT} col-span-2`}>
                          Elige qué enviar
                        </button>
                      ) : (
                        <Link
                          href={sendRefsHref(chosen.map((s) => ({ clientId: s.client.id, roundNumber: s.round.number })))}
                          className={PRIMARY_BUTTON_COMPACT}
                          data-testid="send-batch-link"
                        >
                          Enviar {count(chosen.length, "ronda", "rondas")}
                        </Link>
                      )}
                      {/* The other way to get them out: print here, mail by hand. */}
                      {chosen.length > 0 && (
                        <Link
                          href={roundRefsHref(chosen.map((s) => ({ clientId: s.client.id, roundNumber: s.round.number })))}
                          className={SECONDARY_BUTTON_COMPACT}
                          data-testid="print-batch"
                        >
                          Imprimir {count(chosen.length, "ronda", "rondas")}
                        </Link>
                      )}
                    </div>
                    <p className="pt-2.5 text-xs leading-relaxed text-slate-500">
                      Cada carta lleva solo lo que el cliente confirmó como inexacto. «Enviar» muestra a dónde va cada
                      carta, cómo va y cuánto cuesta antes de confirmar. «Imprimir» abre las cartas para imprimirlas
                      aquí y enviarlas a mano.
                      {data.demo && " En la demo no se envía nada: solo quedan marcadas como enviadas."}
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
          )}

          <section aria-labelledby="sistema">
            <SectionTitle
              aside={
                <Link href="/equipo/piloto" className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                  Piloto automático
                </Link>
              }
            >
              <span id="sistema">El sistema está trabajando</span>
            </SectionTitle>
            <div className="card px-5 py-4" data-testid="system-work">
              {!env.settings.followupsEnabled && view.sentToday.length === 0 ? (
                <p className="text-[14px] leading-snug text-slate-600">Los recordatorios automáticos están apagados. Se encienden en Piloto automático.</p>
              ) : (
                <>
                  <p className="text-[14px] leading-snug text-slate-600">
                    {count(view.working.length, "recordatorio en curso", "recordatorios en curso")} ·{" "}
                    {count(view.sentToday.length, "mensaje enviado", "mensajes enviados")} en 24 h
                    {autopilot.demo ? " (simulados en la demo)" : ""}.
                  </p>
                  {view.working.length > 0 && (
                    <ul className="mt-3 space-y-2.5">
                      {view.working.slice(0, 5).map(({ client, state }) => (
                        <li key={`${client.id}:${state.situation.key}`} className="text-[13px] leading-snug">
                          <Link href={`/equipo/clientes/${client.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                            {fullName(client)}
                          </Link>
                          <span className="block text-slate-500">
                            {FOLLOWUP_SCHEDULES[state.situation.kind].label} ·{" "}
                            {state.sent.length === 0
                              ? `el primer recordatorio sale el ${formatDay(new Date(state.next!.dueAt))}`
                              : `${state.sent.length} de 3 enviados${state.next ? `; el siguiente, el ${formatDay(new Date(state.next.dueAt))}` : ""}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="solo">
            <SectionTitle>
              <span id="solo">Todo lo demás avanza solo</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <p className="text-[14px] leading-snug text-slate-600">
                {view.quiet.length === 0
                  ? "Hoy todos los clientes tienen algo pendiente arriba."
                  : `${count(view.quiet.length, "cliente no necesita", "clientes no necesitan")} nada hoy. Esto es lo que sigue y quién lo hace:`}
              </p>
              {view.quiet.length > 0 && (
                <ul className="mt-3 space-y-2.5">
                  {view.quiet.slice(0, 6).map((client) => {
                    const step = nextStepFor(client, now, viewer);
                    return (
                      <li key={client.id} className="text-[13px] leading-snug">
                        <Link
                          href={`/equipo/clientes/${client.id}`}
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {fullName(client)}
                        </Link>
                        <span className="block text-slate-500">
                          {ACTOR_LABEL[step.actor]}: {step.text.charAt(0).toLowerCase() + step.text.slice(1)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {view.quiet.length > 6 && (
                <Link href="/equipo/clientes" className="mt-3 block text-[13px] font-medium text-blue-700">
                  Ver los {view.quiet.length}
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="mt-8" aria-labelledby="etapas">
        <SectionTitle
          aside={
            <Link href="/equipo/clientes" className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
              Ver los {clients.length} clientes
            </Link>
          }
        >
          <span id="etapas">Clientes por etapa</span>
        </SectionTitle>
        <div className="card grid grid-cols-2 overflow-hidden sm:grid-cols-4 lg:grid-cols-11">
          {PIPELINE_STAGES.map((stage) => {
            const n = view.byStage[stage];
            return (
              <Link
                key={stage}
                href={`/equipo/clientes?etapa=${stage}`}
                title={STAGES[stage].description}
                className="pressable -mb-px -mr-px border-b border-r hairline px-3 py-3.5 hover:bg-slate-50"
              >
                <span className={`block text-[22px] font-semibold leading-none tabular-nums ${n > 0 ? "text-slate-900" : "text-slate-400"}`}>
                  {n}
                </span>
                <span className={`mt-1.5 block text-xs leading-tight ${n > 0 ? "text-slate-600" : "text-slate-400"}`}>
                  {STAGES[stage].short}
                </span>
              </Link>
            );
          })}
        </div>
        {/* Clients who cancelled their agreement are out of the pipeline; they stay on record. */}
        {view.byStage.cancelled > 0 && (
          <p className="px-1 pt-2 text-[13px] text-slate-500">
            Fuera de las etapas:{" "}
            <Link href="/equipo/clientes?etapa=cancelled" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              {count(view.byStage.cancelled, "cliente canceló su acuerdo", "clientes cancelaron su acuerdo")}
            </Link>
            . No se les envía ni se les cobra nada.
          </p>
        )}
      </section>
    </main>
  );
}

/** Where a prepared round stands with the autopilot: off, held, or when it goes by itself. */
function AutoSendLine({ client, round, now, settings }: { client: StaffClient; round: StaffRound; now: Date; settings: AutopilotSettings }) {
  const state = autoSendState(client, round, now, settings);
  if (state.status === "off") return null;
  return (
    <span className={`block text-[13px] ${state.status === "held" ? "text-amber-700" : "text-green-700"}`} data-testid="autosend-state">
      {state.text}
    </span>
  );
}
