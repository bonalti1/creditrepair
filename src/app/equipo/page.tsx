"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { count, shortDay } from "@/lib/staff/format";
import { exceptionMessage, whatsappHref } from "@/lib/staff/messages";
import { exceptionVisibleTo } from "@/lib/staff/permissions";
import { nextStepFor } from "@/lib/staff/clientList";
import { roundRefsHref, sendRefsHref } from "@/lib/staff/printBatch";
import { useMail } from "@/lib/mail/useMail";
import {
  ACTOR_LABEL,
  clientExceptions,
  clientStage,
  HANDLED_QUIET_DAYS,
  RESPONSE_WINDOW_DAYS,
  roundItemCount,
  sendableRound,
  PIPELINE_STAGES,
  STAGE_ORDER,
  STAGES,
  type Stage,
  type StaffException,
} from "@/lib/staff/stage";
import { fullName, type StaffClient, type StaffRound } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import NewLeadsCard from "@/components/staff/NewLeadsCard";
import {
  PRIMARY_BUTTON_COMPACT,
  QUIET_BUTTON,
  ROW_BUTTON,
  SECONDARY_BUTTON_COMPACT,
  SectionTitle,
  SeverityDot,
} from "@/components/staff/ui";

// The team's home. One list of what needs a person, each with the one button
// that fixes it. One block to mail every prepared round at once. Everything
// else is shown as status, because it moves on its own.
//
// Billing is in the last group. The system charges each round after it is
// mailed and retries a declined payment by itself; nothing on this page asks
// anyone to charge a client. Money reaches the first list only when it needs
// a person: the retries are used up, or a charge is due and there is no
// payment method on file.

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

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

  const view = useMemo(() => {
    const exceptions: Array<{ client: StaffClient; exception: StaffException }> = [];
    const sendable: Array<{ client: StaffClient; round: StaffRound }> = [];
    const quiet: StaffClient[] = [];
    const byStage = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<Stage, number>;

    for (const client of clients) {
      const stage = clientStage(client, now);
      byStage[stage] += 1;
      const own = clientExceptions(client, now, { furnishers }).filter((e) => exceptionVisibleTo(viewer?.role, e.kind));
      own.forEach((exception) => exceptions.push({ client, exception }));
      const round = sends ? sendableRound(client, now, { furnishers }) : null;
      if (round) sendable.push({ client, round });
      // A client who cancelled is not moving along on their own: they are out.
      if (own.length === 0 && !round && stage !== "cancelled") quiet.push(client);
    }
    exceptions.sort(
      (a, b) =>
        SEVERITY_RANK[a.exception.severity] - SEVERITY_RANK[b.exception.severity] ||
        (a.exception.since ?? "").localeCompare(b.exception.since ?? ""),
    );
    // What the system does soonest comes first (a charge tomorrow, a retry), then whoever a person is waited on.
    const when = (client: StaffClient) => nextStepFor(client, now, viewer).at ?? "9999";
    quiet.sort((a, b) => when(a).localeCompare(when(b)));
    return { exceptions, sendable, quiet, byStage };
  }, [clients, now, viewer, sends, furnishers]);

  // Every prepared round starts selected: sending them all is the routine.
  useEffect(() => {
    if (ready && selected === null) setSelected(new Set(view.sendable.map((s) => s.client.id)));
  }, [ready, selected, view.sendable]);

  if (!ready) return null;

  const chosen = view.sendable.filter((s) => selected?.has(s.client.id));
  const allChosen = view.sendable.length > 0 && chosen.length === view.sendable.length;

  const toggle = (clientId: string) => {
    const next = new Set(selected);
    if (next.has(clientId)) next.delete(clientId);
    else next.add(clientId);
    setSelected(next);
  };

  const markHandled = async (clientId: string, key: string) => {
    await data.resolveException(clientId, key);
    await reload();
  };

  const weekday = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  const today = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const summary = [
    view.exceptions.length === 0
      ? "nada necesita una persona"
      : `${count(view.exceptions.length, "cosa necesita", "cosas necesitan")} una persona`,
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
        {today}. Hoy: {summary.join(" · ")}.
      </p>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="necesita">
          <SectionTitle
            aside={<span className="text-[13px] tabular-nums text-slate-500">{view.exceptions.length}</span>}
          >
            <span id="necesita">Necesita una persona</span>
          </SectionTitle>

          {view.exceptions.length === 0 ? (
            <div className="card flex items-center gap-3 px-5 py-6 text-[15px] text-slate-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-700">
                <Icon name="check" size={18} />
              </span>
              Nada necesita una persona ahora.
            </div>
          ) : (
            <ul className="card overflow-hidden">
              {view.exceptions.map(({ client, exception }, index) => (
                <li
                  key={`${client.id}:${exception.key}`}
                  className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5 ${index > 0 ? "border-t hairline" : ""}`}
                >
                  <div className="flex min-w-0 flex-1 gap-3">
                    <SeverityDot severity={exception.severity} />
                    <div className="min-w-0">
                      <Link
                        href={`/equipo/clientes/${client.id}`}
                        className="text-[16px] font-semibold text-slate-900 underline-offset-2 hover:underline"
                      >
                        {fullName(client)}
                      </Link>
                      <p className="mt-0.5 text-[14px] leading-snug text-slate-600">{exception.sentence}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 pl-[22px] sm:shrink-0 sm:flex-nowrap sm:pl-0">
                    {exception.action === "whatsapp" ? (
                      <a
                        href={whatsappHref(client.phone, exceptionMessage(client, exception))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={ROW_BUTTON}
                      >
                        {exception.actionLabel}
                      </a>
                    ) : (
                      <Link href={exception.href ?? `/equipo/clientes/${client.id}#cartas`} className={ROW_BUTTON}>
                        {exception.actionLabel}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => markHandled(client.id, exception.key)}
                      className={QUIET_BUTTON}
                      aria-label={`Marcar como atendido: ${fullName(client)}`}
                    >
                      <Icon name="check" size={16} />
                      Atendido
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {view.exceptions.length > 0 && (
            <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
              «Atendido» quita el aviso de la lista. Si en {HANDLED_QUIET_DAYS} días la situación sigue igual, vuelve a
              aparecer.
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

              {view.sendable.length === 0 ? (
                <p className="px-5 py-5 text-[14px] leading-snug text-slate-500">
                  No hay rondas esperando envío. Aparecen aquí en cuanto el sistema prepara las cartas.
                </p>
              ) : (
                <>
                  <ul>
                    {view.sendable.map(({ client, round }, index) => (
                      <li key={client.id} className={`flex items-center gap-3 px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`}>
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
                        </label>
                        <Link
                          href={`/equipo/clientes/${client.id}#cartas`}
                          className="shrink-0 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
                        >
                          Ver cartas
                        </Link>
                      </li>
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
