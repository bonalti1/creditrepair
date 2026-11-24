"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { count, shortDay } from "@/lib/staff/format";
import { followupsInProgress, sentBetween, workQueue, workSummary, type QueueItem } from "@/lib/autopilot/queue";
import { RESOLUTION_LABEL, RESOLUTION_LABEL_EN, resolvedBetween } from "@/lib/autopilot/resolutions";
import { autoSendState } from "@/lib/autopilot/sending";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import type { AutopilotSettings } from "@/lib/autopilot/types";
import { nextStepFor } from "@/lib/staff/clientList";
import { roundRefsHref, sendRefsHref } from "@/lib/staff/printBatch";
import { useMail } from "@/lib/mail/useMail";
import {
  ACTOR_LABELS,
  clientStage,
  formatDay,
  HANDLED_QUIET_DAYS,
  RESPONSE_WINDOW_DAYS,
  roundItemCount,
  sendableRound,
  PIPELINE_STAGES,
  STAGE_ORDER,
  STAGE_TEXT,
  type Stage,
} from "@/lib/staff/stage";
import { fullName, type StaffClient, type StaffRound } from "@/lib/staff/types";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { followupText } from "@/lib/autopilot/followups";
import { useTx } from "@/lib/staff/i18n/StaffLocale";
import { dateLocale, type StaffLocale } from "@/lib/staff/i18n/locale";
import { FocusMode, QueueList, type AnswerFor } from "@/components/staff/WorkQueue";
import NewHireChecklist from "@/components/staff/NewHireChecklist";
import { bestMatch } from "@/lib/staff/answers";
import { openQuestions } from "@/lib/staff/conversation";
import { clientLanguage } from "@/lib/staff/i18n/locale";
import { useSavedAnswers } from "@/lib/staff/useSavedAnswers";
import Icon from "@/components/Icon";
import NewLeadsCard from "@/components/staff/NewLeadsCard";
import { HomeCalls } from "@/components/staff/CallsQueue";
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
//
// Every word is in the member's language (src/lib/staff/i18n).

function greeting(now: Date, locale: StaffLocale): string {
  const hour = now.getHours();
  if (locale === "en") return hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export default function EquipoHome() {
  const { data, ready: clientsReady, clients, now, reload, viewer, can, locale } = useStaff();
  const t = useTx();
  // What this member's role takes care of: sales follows people until the work starts; only some roles send.
  const sends = can("rounds.send");
  // The furnisher address book: a round with a letter to a company that has no checked address is held.
  const { furnishers, gaps, ready: bookReady } = useMail();
  const ready = clientsReady && bookReady;
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // The autopilot's switches and channels (src/lib/autopilot).
  const { autopilot, env, ready: autopilotReady, reload: reloadAutopilot } = useAutopilot();
  const [focus, setFocus] = useState<number | null>(null);
  const [holding, setHolding] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdError, setHoldError] = useState<string | null>(null);
  // The saved answers: a waiting question shows the one that matches it.
  const { answers } = useSavedAnswers(viewer, locale);
  // Only an answer in the client's language: it goes to the client.
  const answerFor: AnswerFor = (item) => {
    const question = openQuestions(item.client).find((q) => `question:${q.id}` === item.exception.key);
    return question ? bestMatch(question.text, answers, undefined, clientLanguage(item.client)) : null;
  };

  // The morning summary's link (/equipo?siguiente=1) opens "Siguiente" at once.
  const [openFocus, setOpenFocus] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("siguiente") === "1") setOpenFocus(true);
  }, []);

  const view = useMemo(() => {
    const queue: QueueItem[] = workQueue(clients, now, { furnishers, furnisherGaps: gaps, autopilot: env, locale }, viewer?.role ?? null);
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
    const when = (client: StaffClient) => nextStepFor(client, now, viewer, locale).at ?? "9999";
    quiet.sort((a, b) => when(a).localeCompare(when(b)));
    // What the system is doing: reminders in progress, and what it sent in the last day.
    const working = clients.flatMap((client) => followupsInProgress(client, now, env).map((state) => ({ client, state })));
    working.sort((a, b) => (a.state.next?.dueAt ?? "").localeCompare(b.state.next?.dueAt ?? ""));
    const sentToday = sentBetween(clients, new Date(now.getTime() - 24 * 60 * 60 * 1000), now);
    // "Resuelto solo": what the system settled by itself in the last 7 days (autopilot/resolutions.ts).
    const resolved = resolvedBetween(clients, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now);
    return { queue, sendable, quiet, byStage, working, sentToday, resolved };
  }, [clients, now, viewer, sends, furnishers, gaps, env, locale]);

  useEffect(() => {
    if (openFocus && ready && autopilotReady) {
      setFocus(0);
      setOpenFocus(false);
    }
  }, [openFocus, ready, autopilotReady]);

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
    // One item for a company many clients wait on: handled for each of them.
    const who = item.group ? item.group.waiting.map((w) => w.client.id) : [item.client.id];
    for (const clientId of who) await data.resolveException(clientId, item.exception.key);
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

  const weekday = now.toLocaleDateString(dateLocale(locale), { weekday: "long", day: "numeric", month: "long" });
  const today = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const summary = [
    ...(sends
      ? [
          view.sendable.length === 0
            ? t("ninguna ronda por enviar", "no rounds to send")
            : t(`${count(view.sendable.length, "ronda lista", "rondas listas")} para enviar`, `${count(view.sendable.length, "round", "rounds")} ready to send`),
        ]
      : []),
    t(count(view.quiet.length, "cliente avanza solo", "clientes avanzan solos"), count(view.quiet.length, "client moving on their own", "clients moving on their own")),
  ];
  const leads = clients.filter((c) => clientStage(c, now) === "lead");

  return (
    <main className="animate-rise">
      <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
        {greeting(now, locale)}
        {viewer ? `, ${viewer.name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        {today}. {summary.join(" · ")}.
      </p>

      <section className="card mt-5 flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="hoy" data-testid="today-work">
        <div className="min-w-0">
          <h2 id="hoy" className="text-[22px] font-semibold leading-tight tracking-tight text-slate-900 tabular-nums">
            {t(`Trabajo de hoy: ${count(work.count, "cosa", "cosas")} · ~${work.minutes} minutos`, `Today's work: ${count(work.count, "thing", "things")} · ~${work.minutes} minutes`)}
          </h2>
          <p className="mt-1 text-[14px] leading-snug text-slate-600">
            {work.count === 0
              ? t("Nada necesita una persona ahora.", "Nothing needs a person right now.")
              : work.overdue > 0
                ? t(`${count(work.overdue, "ya pasó su plazo", "ya pasaron su plazo")}. Empieza por arriba.`, `${count(work.overdue, "is past due", "are past due")}. Start at the top.`)
                : t("Todo dentro de su plazo.", "Everything is on time.")}{" "}
            {env.settings.followupsEnabled
              ? t(
                  `El sistema sigue ${count(view.working.length, "recordatorio", "recordatorios")} por su cuenta y envió ${count(view.sentToday.length, "mensaje", "mensajes")} en las últimas 24 horas.`,
                  `The system is running ${count(view.working.length, "reminder", "reminders")} on its own and sent ${count(view.sentToday.length, "message", "messages")} in the last 24 hours.`,
                )
              : t("Los recordatorios automáticos están apagados: los avisos llegan aquí como antes.", "Automatic reminders are off: notices come here as before.")}
          </p>
          {view.resolved.total > 0 && (
            <p className="mt-1 text-[14px] font-medium leading-snug text-green-700" data-testid="resolved-line">
              {t(`Esta semana el sistema resolvió ${count(view.resolved.total, "cosa", "cosas")} por su cuenta.`, `This week the system settled ${count(view.resolved.total, "thing", "things")} on its own.`)}
            </p>
          )}
        </div>
        {work.count > 0 && (
          <button type="button" onClick={() => setFocus(0)} className={`${PRIMARY_BUTTON} shrink-0 gap-2`} data-testid="focus-start">
            {t("Siguiente", "Next")}
            <Icon name="chevron" size={18} />
          </button>
        )}
      </section>

      {/* A new teammate's first-day list, under the day's work so the work stays the first thing on a phone. */}
      <NewHireChecklist viewer={viewer} />

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
          answerFor={answerFor}
        />
      )}

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section aria-labelledby="necesita">
          <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{view.queue.length}</span>}>
            <span id="necesita" className="scroll-mt-28">{t("Necesita una persona", "Needs a person")}</span>
          </SectionTitle>

          {view.queue.length === 0 ? (
            <div className="card flex items-center gap-3 px-5 py-6 text-[15px] text-slate-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-700">
                <Icon name="check" size={18} />
              </span>
              {t("Nada necesita una persona ahora.", "Nothing needs a person right now.")}
            </div>
          ) : (
            <QueueList items={view.queue} now={now} onHandled={markHandled} answerFor={answerFor} />
          )}
          {view.queue.length > 0 && (
            <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
              {t(
                `En orden: lo vencido primero, luego por plazo. Los minutos son estimados. «Atendido» quita el aviso de la lista; si en ${HANDLED_QUIET_DAYS} días la situación sigue igual, vuelve a aparecer.`,
                `In order: overdue first, then by due time. Minutes are estimates. “Handled” takes the notice off the list; if the situation is the same in ${HANDLED_QUIET_DAYS} days, it comes back.`,
              )}
            </p>
          )}
          {/* Booked calls with a person (src/lib/calls), with their case reference. Off by default: renders nothing. */}
          <HomeCalls allowed={can("calls.manage")} now={now} />
        </section>

        <div className="space-y-6">
          <NewLeadsCard clients={clients} now={now} canInvite={can("clients.invite")} />
          {!sends && (
            <section aria-labelledby="prospectos">
              <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{leads.length}</span>}>
                <span id="prospectos">{t("Tus prospectos", "Your leads")}</span>
              </SectionTitle>
              <div className="card px-5 py-4">
                {leads.length === 0 ? (
                  <p className="text-[14px] leading-snug text-slate-500">{t("No tienes prospectos sin cuenta.", "You have no leads without an account.")}</p>
                ) : (
                  <ul className="space-y-2.5">
                    {leads.slice(0, 6).map((client) => (
                      <li key={client.id} className="text-[13px] leading-snug">
                        <Link href={`/equipo/clientes/${client.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                          {fullName(client)}
                        </Link>
                        <span className="block text-slate-500">
                          {t(`Sin cuenta todavía · primer contacto el ${shortDay(client.createdAt, "es")}`, `No account yet · first contact ${shortDay(client.createdAt, "en")}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {can("clients.add") && (
                  <Link href="/equipo/clientes" className="mt-3 block text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                    {t("Agregar un cliente", "Add a client")}
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
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-700"
                      checked={allChosen}
                      onChange={() => setSelected(allChosen ? new Set() : new Set(view.sendable.map((s) => s.client.id)))}
                    />
                    {t("Todas", "All")}
                  </label>
                ) : undefined
              }
            >
              <span id="listas">{t("Listas para enviar", "Ready to send")}</span>
            </SectionTitle>

            <div className="card overflow-hidden">
              <p className="border-b hairline px-5 py-2.5 text-[13px] leading-snug text-slate-600" data-testid="autosend-line">
                {env.settings.roundsEnabled ? (
                  <>
                    <span className="font-semibold text-green-700">{t("Envío automático encendido.", "Automatic sending on.")}</span>{" "}
                    {t(
                      `Cada ronda espera ${env.settings.reviewWindowHours} h aquí y sale sola si nadie la detiene.`,
                      `Each round waits here ${env.settings.reviewWindowHours} h and goes out on its own unless someone holds it.`,
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-slate-700">{t("Envío automático apagado.", "Automatic sending off.")}</span> {t("Las envía una persona.", "A person sends them.")}
                  </>
                )}
              </p>

              {view.sendable.length === 0 ? (
                <p className="px-5 py-5 text-[14px] leading-snug text-slate-500">
                  {t("No hay rondas esperando envío. Aparecen aquí en cuanto el sistema prepara las cartas.", "No rounds waiting to go out. They show up here as soon as the system prepares the letters.")}
                </p>
              ) : (
                <>
                  <ul>
                    {view.sendable.map(({ client, round }, index) => (
                      <Fragment key={client.id}>
                      <li className={`flex items-center gap-3 px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`}>
                        {/* A 44-pixel box around the checkbox, for a finger. */}
                        <label className="-m-3 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                          <input
                            id={`send-${client.id}`}
                            type="checkbox"
                            className="h-5 w-5 accent-blue-700"
                            checked={selected?.has(client.id) ?? false}
                            onChange={() => toggle(client.id)}
                          />
                        </label>
                        <label htmlFor={`send-${client.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block truncate text-[15px] font-medium text-slate-900">{fullName(client)}</span>
                          <span className="block text-[13px] text-slate-500">
                            {t(
                              `Ronda ${round.number} · ${count(round.letters.length, "carta", "cartas")} · ${count(roundItemCount(round), "punto", "puntos")}`,
                              `Round ${round.number} · ${count(round.letters.length, "letter", "letters")} · ${count(roundItemCount(round), "item", "items")}`,
                            )}
                          </span>
                          {/* Not a reason to hold the letters: the charge comes after, and the client is asked then. */}
                          {!client.billing.paymentMethod && (
                            <span className="block text-[13px] text-slate-500" data-testid="no-method-note">
                              {t("Todavía sin método de pago", "No payment method yet")}
                            </span>
                          )}
                          <AutoSendLine client={client} round={round} now={now} settings={env.settings} locale={locale} />
                        </label>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Link
                            href={`/equipo/clientes/${client.id}#cartas`}
                            className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0"
                          >
                            {t("Ver cartas", "See letters")}
                          </Link>
                          {env.settings.roundsEnabled &&
                            (client.holds ?? []).some((h) => !h.releasedAt) ? (
                              <button type="button" onClick={() => release(client.id)} className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0">
                                {t("Soltar", "Release")}
                              </button>
                            ) : env.settings.roundsEnabled ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setHolding(holding === client.id ? null : client.id);
                                  setHoldError(null);
                                }}
                                className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0"
                                data-testid="hold-button"
                              >
                                {t("Detener", "Hold")}
                              </button>
                            ) : null}
                        </span>
                      </li>
                      {holding === client.id && (
                        <li className="border-t hairline bg-slate-50 px-5 py-3">
                          <label htmlFor={`hold-${client.id}`} className="block text-[13px] font-medium text-slate-700">
                            {t("¿Por qué se detiene? Queda en el registro.", "Why is it on hold? This goes on the record.")}
                          </label>
                          <textarea
                            id={`hold-${client.id}`}
                            value={holdReason}
                            onChange={(e) => setHoldReason(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px]"
                            placeholder={t("Por ejemplo: quiere revisar una carta antes de que salga", "For example: they want to review a letter before it goes out")}
                          />
                          {holdError && <p className="mt-1 text-[13px] text-red-700">{holdError}</p>}
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => hold(client.id)} className={SECONDARY_BUTTON_COMPACT}>
                              {t("Detener el piloto automático", "Put the autopilot on hold")}
                            </button>
                            <button type="button" onClick={() => setHolding(null)} className={QUIET_BUTTON}>
                              {t("Cancelar", "Cancel")}
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
                          {t("Elige qué enviar", "Pick what to send")}
                        </button>
                      ) : (
                        <Link
                          href={sendRefsHref(chosen.map((s) => ({ clientId: s.client.id, roundNumber: s.round.number })))}
                          className={PRIMARY_BUTTON_COMPACT}
                          data-testid="send-batch-link"
                        >
                          {t(`Enviar ${count(chosen.length, "ronda", "rondas")}`, `Send ${count(chosen.length, "round", "rounds")}`)}
                        </Link>
                      )}
                      {/* The other way to get them out: print here, mail by hand. */}
                      {chosen.length > 0 && (
                        <Link
                          href={roundRefsHref(chosen.map((s) => ({ clientId: s.client.id, roundNumber: s.round.number })))}
                          className={SECONDARY_BUTTON_COMPACT}
                          data-testid="print-batch"
                        >
                          {t(`Imprimir ${count(chosen.length, "ronda", "rondas")}`, `Print ${count(chosen.length, "round", "rounds")}`)}
                        </Link>
                      )}
                    </div>
                    <p className="pt-2.5 text-xs leading-relaxed text-slate-500">
                      {t(
                        "Cada carta lleva solo lo que el cliente confirmó como inexacto. «Enviar» muestra a dónde va cada carta, cómo va y cuánto cuesta antes de confirmar. «Imprimir» abre las cartas para imprimirlas aquí y enviarlas a mano.",
                        "Each letter carries only what the client confirmed as inaccurate. “Send” shows where each letter goes, how and what it costs before you confirm. “Print” opens the letters to print here and mail by hand.",
                      )}
                      {data.demo && t(" En la demo no se envía nada: solo quedan marcadas como enviadas.", " Nothing is mailed in the demo: they're only marked as sent.")}
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
          )}

          <section aria-labelledby="resuelto">
            <SectionTitle aside={<span className="text-[13px] tabular-nums text-slate-500">{t("7 días", "7 days")}</span>}>
              <span id="resuelto">{t("Resuelto solo", "Settled on its own")}</span>
            </SectionTitle>
            <div className="card px-5 py-4" data-testid="resolved-solo">
              {view.resolved.total === 0 ? (
                <p className="text-[14px] leading-snug text-slate-600">
                  {t(
                    "Esta semana el sistema todavía no resolvió nada por su cuenta. Aquí aparecen las direcciones corregidas, las cartas devueltas que salieron de nuevo, los pagos y documentos que el cliente arregló con un enlace.",
                    "The system hasn't settled anything on its own this week yet. Corrected addresses, returned letters mailed again, and payments and documents the client fixed from a link show up here.",
                  )}
                </p>
              ) : (
                <>
                  <p className="text-[15px] font-semibold leading-snug text-slate-900">
                    {t(`Esta semana el sistema resolvió ${count(view.resolved.total, "cosa", "cosas")} por su cuenta`, `This week the system settled ${count(view.resolved.total, "thing", "things")} on its own`)}
                  </p>
                  <ul className="mt-2.5 space-y-1.5">
                    {view.resolved.byKind.map(({ kind, count: n }) => (
                      <li key={kind} className="flex items-baseline justify-between gap-3 text-[13px] leading-snug">
                        <span className="text-slate-600">{t(RESOLUTION_LABEL[kind], RESOLUTION_LABEL_EN[kind])}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-green-700">{n}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-[12px] leading-relaxed text-slate-500">
                    {t("Antes, cada una de estas llegaba a «Necesita una persona».", "Before, each of these landed in “Needs a person”.")}
                  </p>
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="sistema">
            <SectionTitle
              aside={
                <Link href="/equipo/piloto" className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0">
                  {t("Piloto automático", "Autopilot")}
                </Link>
              }
            >
              <span id="sistema">{t("El sistema está trabajando", "The system is working")}</span>
            </SectionTitle>
            <div className="card px-5 py-4" data-testid="system-work">
              {!env.settings.followupsEnabled && view.sentToday.length === 0 ? (
                <p className="text-[14px] leading-snug text-slate-600">
                  {t("Los recordatorios automáticos están apagados. Se encienden en Piloto automático.", "Automatic reminders are off. Turn them on in Autopilot.")}
                </p>
              ) : (
                <>
                  <p className="text-[14px] leading-snug text-slate-600">
                    {t(
                      `${count(view.working.length, "recordatorio en curso", "recordatorios en curso")} · ${count(view.sentToday.length, "mensaje enviado", "mensajes enviados")} en 24 h`,
                      `${count(view.working.length, "reminder in progress", "reminders in progress")} · ${count(view.sentToday.length, "message sent", "messages sent")} in 24 h`,
                    )}
                    {autopilot.demo ? t(" (simulados en la demo)", " (simulated in the demo)") : ""}.
                  </p>
                  {view.working.length > 0 && (
                    <ul className="mt-3 space-y-2.5">
                      {view.working.slice(0, 5).map(({ client, state }) => (
                        <li key={`${client.id}:${state.situation.key}`} className="text-[13px] leading-snug">
                          <Link href={`/equipo/clientes/${client.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                            {fullName(client)}
                          </Link>
                          <span className="block text-slate-500">
                            {followupText(state.situation.kind, locale).label} ·{" "}
                            {state.sent.length === 0
                              ? t(`el primer recordatorio sale el ${formatDay(new Date(state.next!.dueAt), "es")}`, `the first reminder goes out ${formatDay(new Date(state.next!.dueAt), "en")}`)
                              : t(
                                  `${state.sent.length} de 3 enviados${state.next ? `; el siguiente, el ${formatDay(new Date(state.next.dueAt), "es")}` : ""}`,
                                  `${state.sent.length} of 3 sent${state.next ? `; the next one ${formatDay(new Date(state.next.dueAt), "en")}` : ""}`,
                                )}
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
              <span id="solo">{t("Todo lo demás avanza solo", "Everything else moves on its own")}</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <p className="text-[14px] leading-snug text-slate-600">
                {view.quiet.length === 0
                  ? t("Hoy todos los clientes tienen algo pendiente arriba.", "Today every client has something waiting above.")
                  : t(
                      `${count(view.quiet.length, "cliente no necesita", "clientes no necesitan")} nada hoy. Esto es lo que sigue y quién lo hace:`,
                      `${count(view.quiet.length, "client needs", "clients need")} nothing today. Here's what's next and who does it:`,
                    )}
              </p>
              {view.quiet.length > 0 && (
                <ul className="mt-3 space-y-2.5">
                  {view.quiet.slice(0, 6).map((client) => {
                    const step = nextStepFor(client, now, viewer, locale);
                    return (
                      <li key={client.id} className="text-[13px] leading-snug">
                        <Link
                          href={`/equipo/clientes/${client.id}`}
                          className="font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          {fullName(client)}
                        </Link>
                        <span className="block text-slate-500">
                          {ACTOR_LABELS[locale][step.actor]}: {step.text.charAt(0).toLowerCase() + step.text.slice(1)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {view.quiet.length > 6 && (
                <Link href="/equipo/clientes" className="mt-1 flex min-h-11 items-center text-[13px] font-medium text-blue-700 md:mt-3 md:min-h-0">
                  {t(`Ver los ${view.quiet.length}`, `See all ${view.quiet.length}`)}
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="mt-8" aria-labelledby="etapas">
        <SectionTitle
          aside={
            <Link href="/equipo/clientes" className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0">
              {t(`Ver los ${clients.length} clientes`, `See all ${clients.length} clients`)}
            </Link>
          }
        >
          <span id="etapas">{t("Clientes por etapa", "Clients by stage")}</span>
        </SectionTitle>
        <div className="card grid grid-cols-2 overflow-hidden sm:grid-cols-4 lg:grid-cols-11">
          {PIPELINE_STAGES.map((stage) => {
            const n = view.byStage[stage];
            return (
              <Link
                key={stage}
                href={`/equipo/clientes?etapa=${stage}`}
                title={STAGE_TEXT[locale][stage].description}
                className="pressable -mb-px -mr-px border-b border-r hairline px-3 py-3.5 hover:bg-slate-50"
              >
                <span className={`block text-[22px] font-semibold leading-none tabular-nums ${n > 0 ? "text-slate-900" : "text-slate-400"}`}>
                  {n}
                </span>
                <span className={`mt-1.5 block text-xs leading-tight ${n > 0 ? "text-slate-600" : "text-slate-400"}`}>
                  {STAGE_TEXT[locale][stage].short}
                </span>
              </Link>
            );
          })}
        </div>
        {/* Clients who cancelled their agreement are out of the pipeline; they stay on record. */}
        {view.byStage.cancelled > 0 && (
          <p className="px-1 pt-2 text-[13px] text-slate-500">
            {t("Fuera de las etapas:", "Outside the stages:")}{" "}
            <Link href="/equipo/clientes?etapa=cancelled" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              {t(
                count(view.byStage.cancelled, "cliente canceló su acuerdo", "clientes cancelaron su acuerdo"),
                count(view.byStage.cancelled, "client cancelled their agreement", "clients cancelled their agreement"),
              )}
            </Link>
            {t(". No se les envía ni se les cobra nada.", ". Nothing is sent to them and they aren't charged.")}
          </p>
        )}
      </section>
    </main>
  );
}

/** Where a prepared round stands with the autopilot: off, held, or when it goes by itself. */
function AutoSendLine({ client, round, now, settings, locale }: { client: StaffClient; round: StaffRound; now: Date; settings: AutopilotSettings; locale: StaffLocale }) {
  const state = autoSendState(client, round, now, settings, locale);
  if (state.status === "off") return null;
  return (
    <span className={`block text-[13px] ${state.status === "held" ? "text-amber-700" : "text-green-700"}`} data-testid="autosend-state">
      {state.text}
    </span>
  );
}
