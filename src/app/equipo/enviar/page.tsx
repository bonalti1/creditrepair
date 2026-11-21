"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getLetterMeta } from "@/lib/letters/library";
import { MAIL_CLASS_LABEL } from "@/lib/mail/classes";
import { MAIL_CLASSES, type MailClass } from "@/lib/mail/types";
import { LOB_PRICES, formatMills } from "@/lib/mail/pricing";
import { buildSendBatch } from "@/lib/mail/sendBatch";
import { addressBookHref, type LetterMailPlan, type RoundMailPlan } from "@/lib/mail/sendPlan";
import { useMail } from "@/lib/mail/useMail";
import { count, longDay } from "@/lib/staff/format";
import { parseRoundRefs, roundRefsHref, ROUND_REFS_PARAM } from "@/lib/staff/printBatch";
import { RESPONSE_WINDOW_DAYS } from "@/lib/staff/stage";
import { fullName } from "@/lib/staff/types";
import { useStaff } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { MailModeNote, SimulatedPill } from "@/components/staff/MailBits";
import { PRIMARY_BUTTON, ROW_BUTTON, SECONDARY_BUTTON, SectionTitle } from "@/components/staff/ui";

// Sending rounds by mail. Before anything goes out the team sees, letter by
// letter: who it goes to and the exact address (from the bureau registry or
// the furnisher address book, never from a credit report), the mail class
// (the default for that kind of letter, which can be changed here), the pages
// and the estimated cost; and, for the whole batch, the total. A letter with
// no address to go to holds its round, with the button that fixes it.
//
// Without a Lob key (and always in the demo) the send is simulated: the round
// is recorded as sent and nothing reaches a post office. The screen says so.

function letterTitle(templateKey: string): string {
  return getLetterMeta(templateKey)?.title.es ?? templateKey;
}

function LetterRow({ plan, onClass }: { plan: LetterMailPlan; onClass: (value: MailClass) => void }) {
  const { letter } = plan;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t hairline px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_14rem_5.5rem]" data-testid="send-letter">
      <div className="min-w-0">
        <p className="text-[15px] font-medium leading-snug text-slate-900">{plan.to?.name ?? letter.recipient.name}</p>
        <p className="text-[13px] leading-snug text-slate-500">{letterTitle(letter.templateKey)}</p>
        {plan.to ? (
          <p className="mt-1 text-[13px] leading-snug text-slate-700" data-testid="send-address">
            {plan.to.addressLines.join(" · ")}
            <span className="text-slate-400"> · {plan.addressFrom === "registry" ? "registro de burós" : "libreta de acreedores"}</span>
          </p>
        ) : (
          <div className="mt-1.5 flex flex-col items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5" data-testid="send-blocker">
            <p className="text-[13px] leading-snug text-red-700">{plan.blocker}</p>
            {plan.missingCompany && (
              <Link href={addressBookHref(plan.missingCompany, plan.furnisherEntryId)} className={`${ROW_BUTTON} h-9`}>
                Agregar la dirección
              </Link>
            )}
          </div>
        )}
      </div>
      <label className="block min-w-0">
        <span className="sr-only">Clase de correo para {letter.recipient.name}</span>
        <select
          value={plan.mailClass}
          onChange={(e) => onClass(e.target.value as MailClass)}
          className="h-10 w-full rounded-xl border border-slate-300 bg-white px-2.5 text-[14px] text-slate-900"
          data-testid="mail-class"
        >
          {MAIL_CLASSES.map((cls) => (
            <option key={cls} value={cls}>
              {MAIL_CLASS_LABEL[cls].short.es}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs leading-snug text-slate-500">
          {plan.mailClass === plan.defaultClass
            ? "La de siempre para esta carta"
            : `Cambiada; la de siempre es ${MAIL_CLASS_LABEL[plan.defaultClass].short.es.toLowerCase()}`}
        </span>
      </label>
      <div className="text-left md:text-right">
        <p className="text-[15px] font-semibold tabular-nums text-slate-900">{formatMills(plan.cost.mills)}</p>
        <p className="text-xs text-slate-500">{count(plan.pages, "página", "páginas")}</p>
      </div>
    </li>
  );
}

function RoundCard({ plan, onClass, held }: { plan: RoundMailPlan; onClass: (letterId: string, value: MailClass) => void; held?: string }) {
  return (
    <section className="card overflow-hidden" aria-label={`${fullName(plan.client)}, ronda ${plan.round.number}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <Link href={`/equipo/clientes/${plan.client.id}#cartas`} className="text-[17px] font-semibold text-slate-900 underline-offset-2 hover:underline">
            {fullName(plan.client)}
          </Link>
          <p className="text-[13px] leading-snug text-slate-500">
            Ronda {plan.round.number} · {count(plan.letters.length, "carta", "cartas")} · remitente:{" "}
            {plan.from ? plan.from.addressLines.join(", ") : "sin dirección legible"}
          </p>
        </div>
        <p className="text-[15px] font-semibold tabular-nums text-slate-900">{formatMills(plan.totalMills)}</p>
      </div>
      {held && (
        <p className="mx-5 mb-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-[14px] leading-snug text-blue-900" data-testid="round-held">
          No sale en este envío. {held}
        </p>
      )}
      <ul>
        {plan.letters.map((letter) => (
          <LetterRow key={letter.letter.id} plan={letter} onClass={(value) => onClass(letter.letter.id, value)} />
        ))}
      </ul>
    </section>
  );
}

function SendView() {
  const params = useSearchParams();
  const { data, ready: clientsReady, clients, now, reload } = useStaff();
  const { mode, furnishers, ready: bookReady } = useMail();
  const refs = useMemo(() => parseRoundRefs(params.get(ROUND_REFS_PARAM)), [params]);
  const [choices, setChoices] = useState<Record<string, MailClass>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ rounds: number; letters: number; total: string } | null>(null);
  // With the database, a round can still be refused by the server's own checks, or the mail service can fail.
  const [failure, setFailure] = useState<string | null>(null);
  const batch = useMemo(() => buildSendBatch(clients, refs, now, furnishers, choices), [clients, refs, now, furnishers, choices]);

  if (!clientsReady || !bookReady) return null;

  const setClass = (letterId: string, value: MailClass) => setChoices((current) => ({ ...current, [letterId]: value }));
  const send = async () => {
    if (batch.ready.length === 0 || sending) return;
    setSending(true);
    const rounds = batch.ready.map((p) => ({ clientId: p.client.id, roundNumber: p.round.number }));
    const mailClasses = Object.fromEntries(batch.ready.flatMap((p) => p.letters.map((l) => [l.letter.id, l.mailClass])));
    setFailure(null);
    try {
      await data.markRoundsSent(rounds, { mailClasses, via: "mail" });
      setSent({ rounds: rounds.length, letters: batch.letters, total: formatMills(batch.totalMills) });
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : "No se pudo enviar. Intenta de nuevo.");
    }
    await reload();
    setSending(false);
  };

  const heldWithPlan = batch.held.filter((h) => h.plan);
  // Right after a send, the rounds that just went out are not "held": they are the ones the note above counts.
  const heldWithout = batch.held.filter((h) => !h.plan && !(sent && h.alreadySent));

  return (
    <main className="animate-rise">
      <Link href="/equipo" className="inline-flex items-center gap-1 text-[14px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        Inicio
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">Enviar por correo</h1>
        {mode === "simulated" && <SimulatedPill />}
      </div>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-500">
        Revisa a dónde va cada carta, cómo va y cuánto cuesta. Cada carta lleva solo lo que el cliente confirmó como inexacto.
      </p>

      {sent && (
        <p className="mt-5 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status" data-testid="sent-note">
          <Icon name="check" size={18} className="mt-px shrink-0" />
          <span>
            {count(sent.rounds, "ronda enviada", "rondas enviadas")} ({count(sent.letters, "carta", "cartas")}, unos {sent.total}).
            {mode === "simulated" ? " Simulado: no salió nada por correo." : ""} El sistema vuelve a importar cada reporte en{" "}
            {RESPONSE_WINDOW_DAYS} días.{" "}
            <Link href="/equipo" className="font-semibold underline underline-offset-2">
              Volver al inicio
            </Link>
          </span>
        </p>
      )}

      {failure && (
        <p className="mt-5 flex items-start gap-2.5 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700" role="alert" data-testid="send-failure">
          <Icon name="clock" size={18} className="mt-px shrink-0" />
          <span>{failure}</span>
        </p>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {batch.ready.length === 0 && heldWithPlan.length === 0 && (
            <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
              {sent ? "Todo lo que se eligió ya salió." : "No hay rondas para enviar en este enlace."}
            </div>
          )}
          {batch.ready.map((plan) => (
            <RoundCard key={`${plan.client.id}:${plan.round.number}`} plan={plan} onClass={setClass} />
          ))}
          {heldWithPlan.length > 0 && (
            <>
              <SectionTitle>Detenidas</SectionTitle>
              {heldWithPlan.map((h) => (
                <RoundCard key={`${h.ref.clientId}:${h.ref.roundNumber}`} plan={h.plan!} onClass={setClass} held={h.reason} />
              ))}
            </>
          )}
          {heldWithout.length > 0 && (
            <div className="card px-5 py-4 text-[14px] leading-snug text-slate-600">
              <p className="font-semibold text-slate-900">No se envían</p>
              <ul className="mt-1 space-y-0.5">
                {heldWithout.map((h) => (
                  <li key={`${h.ref.clientId}:${h.ref.roundNumber}`}>
                    {h.clientName ?? h.ref.clientId}, ronda {h.ref.roundNumber}. {h.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20">
          <section className="card px-5 py-5" aria-label="Resumen del envío">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Este envío</p>
            <p className="mt-1 text-[32px] font-semibold leading-none tabular-nums text-slate-900" data-testid="batch-total">
              {formatMills(batch.totalMills)}
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              estimado · {count(batch.ready.length, "ronda", "rondas")} · {count(batch.letters, "carta", "cartas")}
            </p>
            <ul className="mt-4 space-y-1.5 border-t hairline pt-3 text-[14px]">
              {MAIL_CLASSES.map((cls) => (
                <li key={cls} className="flex justify-between gap-3">
                  <span className="text-slate-600">{MAIL_CLASS_LABEL[cls].short.es}</span>
                  <span className="font-medium tabular-nums text-slate-900">{batch.byClass[cls]}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <MailModeNote mode={mode} />
            </div>
            <button type="button" onClick={send} disabled={batch.ready.length === 0 || sending} className={`${PRIMARY_BUTTON} mt-4 w-full`} data-testid="send-batch">
              {batch.ready.length === 0
                ? "Nada listo para enviar"
                : `Enviar ${count(batch.ready.length, "ronda", "rondas")}${mode === "simulated" ? " (simulado)" : ""}`}
            </button>
            {batch.ready.length > 0 && (
              <Link
                href={roundRefsHref(batch.ready.map((p) => ({ clientId: p.client.id, roundNumber: p.round.number })))}
                className={`${SECONDARY_BUTTON} mt-2 w-full`}
              >
                Mejor imprimirlas aquí
              </Link>
            )}
          </section>
          <p className="px-1 text-xs leading-relaxed text-slate-500">
            Precios de Lob leídos el {longDay(`${LOB_PRICES.readOn}T12:00:00Z`)} (edición Developer), sin verificar: la
            factura de Lob es la que vale. Cada carta lleva una hoja en blanco al frente para la dirección, que se cobra
            como página. Primera clase: Lob calcula la entrega; certificada: el correo la registra y da un número de rastreo.
          </p>
        </aside>
      </div>
    </main>
  );
}

export default function EnviarPage() {
  return (
    <Suspense fallback={null}>
      <SendView />
    </Suspense>
  );
}
