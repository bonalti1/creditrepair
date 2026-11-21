"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Bureau } from "@/lib/domain/types";
import { readerLabel } from "@/lib/reports/readers";
import { demoClientUploads } from "@/lib/staff/data";
import { count, formatBytes, formatPhone, longDay, relativeDay, shortDateTime, shortDay } from "@/lib/staff/format";
import { staffLetterText } from "@/lib/staff/letters";
import { exceptionMessage, STAFF_MESSAGE_RULES, whatsappHref } from "@/lib/staff/messages";
import { roundRefsHref } from "@/lib/staff/printBatch";
import {
  agreementLine,
  clientAgreement,
  clientExceptions,
  clientStage,
  formatDay,
  handledExceptions,
  identityTheftItemsWithoutReport,
  missingDocuments,
  nextStep,
  RESPONSE_WINDOW_DAYS,
  reviewProgress,
  sendableRound,
  sendBlockReason,
  STAGES,
} from "@/lib/staff/stage";
import { clientTimeline } from "@/lib/staff/timeline";
import { deadlineOf } from "@/lib/agreement/gate";
import {
  fullName,
  REQUIRED_DOCUMENTS,
  type DocumentKind,
  type ItemAnswer,
  type MailStatus,
  type RoundStatus,
  type StaffClient,
  type StaffLetter,
  type StaffRound,
} from "@/lib/staff/types";
import { staffAuthor, useStaff } from "@/lib/staff/useStaff";
import { reasonLabel } from "@/lib/ux/disputeReason";
import { itemFacts, itemTitle } from "@/lib/ux/itemDisplay";
import Icon from "@/components/Icon";
import ItemFacts from "@/components/ItemFacts";
import BillingCard from "@/components/staff/BillingCard";
import Conversation from "@/components/staff/Conversation";
import ReportImport from "@/components/staff/ReportImport";
import {
  ActorTag,
  Chip,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW_BUTTON,
  SectionTitle,
  SeverityDot,
  StageChip,
  WAITING_TONE,
} from "@/components/staff/ui";

// One client. The top card answers "where is this person and why" at a glance:
// the stage, what happens next and who does it. Below it, everything on file:
// what needs a person, the client's conversation (with a box to answer in
// it), the report with the client's own answers (and the way to bring a new
// report in), the letters of each round, the agreement, billing (what was
// charged and for which round, and what the system charges next), documents,
// history and notes.
//
// The client's answers are shown, never edited: staff cannot mark an item as
// inaccurate here or anywhere else in the console.

const BUREAU: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

const DOCUMENT: Record<DocumentKind, string> = {
  government_id: "Identificación con foto",
  proof_of_address: "Comprobante de domicilio",
  ssn_card: "Tarjeta de Seguro Social",
  identity_theft_report: "Reporte de robo de identidad",
};

const ROUND_STATUS: Record<RoundStatus, { label: string; tone: string }> = {
  draft: { label: "En preparación", tone: "bg-slate-100 text-slate-600" },
  ready: { label: "Lista para enviar", tone: "bg-blue-50 text-blue-700" },
  mailed: { label: "Enviada", tone: "bg-green-50 text-green-700" },
  responded: { label: "Con respuesta", tone: "bg-green-50 text-green-700" },
};

const MAIL_STATUS: Record<MailStatus, { label: string; tone: string }> = {
  not_sent: { label: "Sin enviar", tone: "bg-slate-100 text-slate-600" },
  in_transit: { label: "En camino", tone: "bg-blue-50 text-blue-700" },
  delivered: { label: "Entregada", tone: "bg-green-50 text-green-700" },
  returned: { label: "Devuelta", tone: "bg-red-50 text-red-700" },
  undeliverable: { label: "No se pudo entregar", tone: "bg-red-50 text-red-700" },
};

function AnswerChip({ answer }: { answer: ItemAnswer | undefined }) {
  if (answer?.status === "inaccurate") return <Chip tone="bg-blue-50 text-blue-700">Inexacto</Chip>;
  if (answer?.status === "correct") return <Chip tone="bg-slate-100 text-slate-600">Correcto</Chip>;
  return <Chip tone={WAITING_TONE}>Sin responder</Chip>;
}

/**
 * The reason the client picked, beside their "Inexacto" answer. An item
 * confirmed before reasons existed has none: it still counts, its letter line
 * carries no reason, and it is marked quietly so the team knows why.
 */
function AnswerReason({ answer }: { answer: ItemAnswer | undefined }) {
  if (answer?.status !== "inaccurate") return null;
  const label = reasonLabel(answer.reasonCode, "es");
  if (!label) {
    return (
      <span
        data-testid="sin-motivo"
        title="Confirmado antes de que se pidiera un motivo. Cuenta igual; su línea en la carta va sin motivo."
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500"
      >
        sin motivo
      </span>
    );
  }
  return (
    <span data-testid="answer-reason" className="min-w-0 break-words text-right text-[13px] leading-snug text-slate-600">
      {label}
    </span>
  );
}

function Letter({ client, round, letter, now }: { client: StaffClient; round: StaffRound; letter: StaffLetter; now: Date }) {
  // The text as it is mailed, with the reason the client gave after each item.
  // Letters are in English: that is the language the bureaus work in.
  const body = useMemo(() => staffLetterText(client, round, letter, now), [client, round, letter, now]);
  const current = new Set(client.report?.items.map((i) => i.fingerprint));
  const answered = round.status === "responded";
  // What an imported report already showed for this round's items, even while the round is still open.
  const removed = new Map((round.results ?? []).map((result) => [result.fingerprint, result]));

  return (
    <li className="border-t hairline px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-snug text-slate-900">{letter.recipient.name}</p>
          <p className="text-[13px] leading-snug text-slate-500">{letter.recipient.addressLines.join(", ")}</p>
        </div>
        <Chip tone={MAIL_STATUS[letter.mailStatus].tone}>{MAIL_STATUS[letter.mailStatus].label}</Chip>
      </div>
      {letter.items.length === 0 ? (
        <p className="mt-1 text-[13px] leading-snug text-slate-500">Pide una copia del expediente del cliente. No disputa ningún punto.</p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {letter.items.map((item) => {
            const { kicker, title } = itemTitle(item, "es");
            return (
              <li key={item.fingerprint} className="break-words text-[13px] leading-snug text-slate-600">
                {kicker ? `${kicker}: ${title}` : title}
                {removed.has(item.fingerprint) ? (
                  <span className="font-medium text-green-700" data-testid="round-result">
                    {" "}
                    · ya no aparece en el reporte del {shortDay(removed.get(item.fingerprint)!.reportDate)}
                  </span>
                ) : (
                  answered && (
                    <span className={current.has(item.fingerprint) ? "text-slate-500" : "font-medium text-green-700"}>
                      {current.has(item.fingerprint) ? " · sigue en el reporte nuevo" : " · ya no aparece en el reporte nuevo"}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
          <Icon name="doc" size={15} />
          <span className="group-open:hidden">Ver la carta</span>
          <span className="hidden group-open:inline">Ocultar la carta</span>
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Va en inglés, el idioma de trabajo de los burós, a nombre del cliente.
        </p>
        <pre className="mt-1.5 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 font-serif text-[14px] leading-relaxed text-slate-800">
          {body}
        </pre>
      </details>
    </li>
  );
}

export default function ClientePage() {
  const { id } = useParams<{ id: string }>();
  const { data, ready, clients, now, reload } = useStaff();
  const [note, setNote] = useState("");
  const [sentRound, setSentRound] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const client = clients.find((c) => c.id === id) ?? null;

  // The page is drawn after the data loads, so a link to "#cartas" is honoured here.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [ready]);

  if (!ready) return null;

  if (!client) {
    return (
      <main className="animate-rise">
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">No encontramos a este cliente</h1>
        <Link href="/equipo/clientes" className="mt-4 inline-block text-[15px] font-medium text-blue-700">
          Volver a clientes
        </Link>
      </main>
    );
  }

  const stage = clientStage(client, now);
  const step = nextStep(client, now);
  const exceptions = clientExceptions(client, now);
  const handled = handledExceptions(client, now);
  const round = sendableRound(client, now);
  const blocked = stage === "ready_to_send" || stage === "next_round_ready" ? sendBlockReason(client, now) : null;
  // The agreement record, as rows: what is on file and when.
  const deadline = client.agreementSignedAt ? deadlineOf(clientAgreement(client)) : null;
  const acknowledgedAt = clientAgreement(client).disclosureAcknowledgedAt;
  const agreementRows: Array<[string, string]> = [
    ["Declaración de derechos", acknowledgedAt ? `Recibida el ${shortDateTime(acknowledgedAt)}` : "Sin recibir"],
    ["Contrato", client.agreementSignedAt ? `Firmado el ${shortDateTime(client.agreementSignedAt)}` : "Sin firmar"],
    ...(client.agreementSignedAt
      ? ([
          ["Versión del texto", client.agreementVersion ?? "Sin registro"],
          [
            "Puede cancelar sin costo",
            deadline
              ? `Hasta el ${shortDateTime(deadline.toISOString())}${deadline.getTime() >= now.getTime() ? "" : " (ya pasó)"}`
              : "Sin fecha",
          ],
        ] as Array<[string, string]>)
      : []),
    ...(client.agreementCancelledAt
      ? ([
          [
            "Cancelación",
            `${shortDateTime(client.agreementCancelledAt)}, ${client.cancelledWithinWindow === false ? "después del plazo" : "dentro del plazo"}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(client.serviceEndRequestedAt
      ? ([["Pidió terminar el servicio", shortDateTime(client.serviceEndRequestedAt)]] as Array<[string, string]>)
      : []),
  ];
  const review = reviewProgress(client);
  const timeline = clientTimeline(client, now);
  const missing = missingDocuments(client);
  const rounds = [...client.rounds].sort((a, b) => b.number - a.number);
  // An identity theft claim needs its own document: it is listed as soon as it is being waited on.
  const theftReportMissing = identityTheftItemsWithoutReport(client).length > 0;
  const documents: DocumentKind[] = [
    ...REQUIRED_DOCUMENTS,
    ...client.documents.filter((d) => !REQUIRED_DOCUMENTS.includes(d)),
    ...(theftReportMissing ? (["identity_theft_report"] as const) : []),
  ];
  const samples = client.reportSamples ?? [];

  const send = async () => {
    if (!round) return;
    await data.markRoundsSent([{ clientId: client.id, roundNumber: round.number }]);
    setSentRound(round.number);
    await reload();
  };
  const markHandled = async (key: string) => {
    await data.resolveException(client.id, key);
    await reload();
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    await data.addNote(client.id, note, staffAuthor());
    setNote("");
    await reload();
  };

  return (
    <main className="animate-rise">
      <Link href="/equipo/clientes" className="inline-flex items-center gap-1 text-[14px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        Clientes
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{fullName(client)}</h1>
        <StageChip stage={stage} />
      </div>
      <p className="mt-1 text-[14px] text-slate-500">
        {client.state === "TX" ? "Texas" : client.state} · con ventas desde el {shortDay(client.createdAt)} · vendedor:{" "}
        {client.salesperson} · última actividad {relativeDay(client.lastActivityAt, now)}
      </p>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="card px-5 py-5 sm:px-6" aria-label="Dónde está y qué sigue">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Dónde está</p>
            <p className="mt-1.5 text-[17px] leading-snug text-slate-900">{STAGES[stage].description}</p>

            <div className="mt-4 flex flex-col gap-4 border-t hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">Qué sigue</p>
                <p className="mt-1">
                  <ActorTag actor={step.actor} />
                </p>
                <p className="text-[17px] font-medium leading-snug text-slate-900">{step.text}</p>
              </div>
              {round && (
                <button type="button" onClick={send} className={`${PRIMARY_BUTTON} shrink-0`}>
                  Enviar ronda {round.number} · {count(round.letters.length, "carta", "cartas")}
                </button>
              )}
              {stage === "lead" && (
                <Link href={`/equipo/invitar?cliente=${client.id}`} className={`${PRIMARY_BUTTON} shrink-0`}>
                  Preparar su invitación
                </Link>
              )}
            </div>

            {blocked && (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
                La ronda está preparada, pero todavía no se puede enviar. {blocked}
              </p>
            )}
            {sentRound !== null && (
              <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>
                  Ronda {sentRound} enviada. El sistema vuelve a importar el reporte en {RESPONSE_WINDOW_DAYS} días.
                  {data.demo && " (En la demo no se envía nada por correo.)"}
                </span>
              </p>
            )}
          </section>

          {(exceptions.length > 0 || handled.length > 0) && (
            <section aria-labelledby="avisos">
              <SectionTitle>
                <span id="avisos">Necesita una persona</span>
              </SectionTitle>
              <ul className="card overflow-hidden">
                {exceptions.map((exception, index) => (
                  <li
                    key={exception.key}
                    className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5 ${index > 0 ? "border-t hairline" : ""}`}
                  >
                    <div className="flex min-w-0 flex-1 gap-3">
                      <SeverityDot severity={exception.severity} />
                      <p className="min-w-0 text-[15px] leading-snug text-slate-800">{exception.sentence}</p>
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
                        <a href="#cartas" className={ROW_BUTTON}>
                          {exception.actionLabel}
                        </a>
                      )}
                      <button type="button" onClick={() => markHandled(exception.key)} className={QUIET_BUTTON}>
                        <Icon name="check" size={16} />
                        Atendido
                      </button>
                    </div>
                  </li>
                ))}
                {handled.map((exception, index) => (
                  <li
                    key={exception.key}
                    className={`flex gap-3 px-5 py-3.5 ${index > 0 || exceptions.length > 0 ? "border-t hairline" : ""}`}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700">
                      <Icon name="check" size={13} strokeWidth={2.25} />
                    </span>
                    <p className="min-w-0 text-[14px] leading-snug text-slate-500">
                      <span className="font-medium text-slate-700">Atendido {relativeDay(exception.handledAt, now)}.</span>{" "}
                      {exception.sentence} Si sigue igual, vuelve a la lista el {formatDay(new Date(exception.returnsAt))}.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Conversation client={client} data={data} now={now} onSent={reload} />

          <section aria-labelledby="reporte">
            <SectionTitle
              aside={
                <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  {client.report && (
                    <span className="text-[13px] text-slate-500">Reporte del {longDay(client.report.pulledAt)}</span>
                  )}
                  {!importing && (
                    <button
                      type="button"
                      onClick={() => {
                        setImporting(true);
                        setImportNote(null);
                      }}
                      className="pressable inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-50 px-3.5 text-[13px] font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <Icon name="arrowUp" size={15} strokeWidth={2.25} />
                      Importar reporte
                    </button>
                  )}
                </span>
              }
            >
              <span id="reporte">Reporte y respuestas del cliente</span>
            </SectionTitle>

            {importing && (
              <div className="mb-4">
                <ReportImport
                  client={client}
                  data={data}
                  onClose={() => setImporting(false)}
                  onSampleSaved={reload}
                  onSaved={async (message) => {
                    setImporting(false);
                    setImportNote(message);
                    await reload();
                  }}
                />
              </div>
            )}
            {importNote && (
              <p className="mb-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status" data-testid="import-saved">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>{importNote}</span>
              </p>
            )}

            {!client.report ? (
              <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
                Todavía no hay reporte. Llega solo cuando el cliente activa su monitoreo de crédito, o lo trae el
                equipo con «Importar reporte».
              </div>
            ) : (
              <div className="card overflow-hidden">
                <p className="px-5 py-3.5 text-[14px] leading-snug text-slate-600">
                  <span className="font-medium text-slate-900">
                    {count(review.total, "punto", "puntos")}: {review.inaccurate} {review.inaccurate === 1 ? "inexacto" : "inexactos"},{" "}
                    {review.correct} {review.correct === 1 ? "correcto" : "correctos"}, {review.pending} sin responder.
                  </span>{" "}
                  Las respuestas son del cliente. Aquí se leen, no se cambian.
                </p>
                <ul>
                  {client.report.items.map((item) => {
                    const { kicker, title } = itemTitle(item, "es");
                    const answer = client.answers[item.fingerprint];
                    const facts = itemFacts(item, "es");
                    return (
                      <li key={item.fingerprint} className="border-t hairline px-5 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {BUREAU[item.bureau]}
                              {kicker ? ` · ${kicker}` : ""}
                            </p>
                            <p className="break-words text-[15px] font-medium leading-snug text-slate-900">{title}</p>
                          </div>
                          <div className="flex max-w-[55%] shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <AnswerReason answer={answer} />
                            <AnswerChip answer={answer} />
                          </div>
                        </div>
                        {answer?.status === "inaccurate" && (
                          <p className="mt-1 text-[14px] leading-snug text-slate-600">
                            {answer.reason ? `«${answer.reason}» ` : ""}
                            <span className="text-slate-500">Confirmado por el cliente el {shortDay(answer.confirmedAt)}.</span>
                          </p>
                        )}
                        {answer?.status === "inaccurate" && answer.reasonCode === "identity_theft" && (
                          <p className="mt-1 text-[13px] leading-snug text-slate-500">
                            Este motivo requiere un reporte de robo de identidad de la FTC.{" "}
                            {client.documents.includes("identity_theft_report") ? "Está en archivo." : "Todavía no está en archivo."}
                          </p>
                        )}
                        {facts.length > 0 && (
                          <details className="group mt-1.5">
                            <summary className="cursor-pointer list-none text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                              <span className="group-open:hidden">Lo que dice el reporte</span>
                              <span className="hidden group-open:inline">Ocultar</span>
                            </summary>
                            <ItemFacts facts={facts} variant="list" className="mt-2 max-w-md" />
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {samples.length > 0 && (
              <div className="card mt-4 overflow-hidden" data-testid="report-samples">
                <p className="px-5 py-3.5 text-[14px] leading-snug text-slate-600">
                  <span className="font-medium text-slate-900">
                    {count(samples.length, "muestra guardada", "muestras guardadas")}.
                  </span>{" "}
                  Son reportes de proveedores que todavía no podemos leer. Se guardan tal como llegaron, para construir
                  el lector con ellos; no cambian la etapa del cliente.
                </p>
                <ul>
                  {samples.map((sample) => (
                    <li key={sample.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t hairline px-5 py-3">
                      <p className="min-w-0 break-words text-[14px] leading-snug text-slate-900">
                        <span className="font-medium">{readerLabel(sample.provider)}</span>
                        <span className="text-slate-500">
                          {" "}
                          · {sample.fileName ?? "texto pegado"} · {formatBytes(new Blob([sample.text]).size)}
                        </span>
                      </p>
                      <p className="shrink-0 text-[13px] text-slate-500">
                        {shortDay(sample.savedAt)} · {sample.savedBy}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="cartas" className="scroll-mt-28">
            <SectionTitle>
              <span id="cartas" className="scroll-mt-28">Rondas y cartas</span>
            </SectionTitle>
            {rounds.length === 0 ? (
              <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
                Todavía no hay cartas. El sistema las prepara cuando el cliente termina su revisión.
              </div>
            ) : (
              <div className="space-y-4">
                {rounds.map((r) => (
                  <div key={r.number} className="card overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold text-slate-900">Ronda {r.number}</p>
                        <p className="text-[13px] leading-snug text-slate-500">
                          {count(r.letters.length, "carta", "cartas")}
                          {r.mailedAt ? ` · enviada el ${shortDay(r.mailedAt)}` : ""}
                          {r.respondedAt ? ` · reporte nuevo el ${shortDay(r.respondedAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {/* Printing is offered for the round that can go out now, and only for it. */}
                        {round && r.number === round.number && (
                          <Link
                            href={roundRefsHref([{ clientId: client.id, roundNumber: r.number }])}
                            className={ROW_BUTTON}
                            data-testid="print-round"
                          >
                            Imprimir esta ronda
                          </Link>
                        )}
                        <Chip tone={ROUND_STATUS[r.status].tone}>{ROUND_STATUS[r.status].label}</Chip>
                      </div>
                    </div>
                    <ul>
                      {r.letters.map((letter) => (
                        <Letter key={letter.id} client={client} round={r} letter={letter} now={now} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <section aria-labelledby="contacto">
            <SectionTitle>
              <span id="contacto">Contacto</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <p className="text-[17px] font-medium tabular-nums text-slate-900">{formatPhone(client.phone)}</p>
              {client.addressLines.length > 0 && (
                <p className="mt-0.5 text-[14px] leading-snug text-slate-500">{client.addressLines.join(", ")}</p>
              )}
              <a
                href={whatsappHref(client.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="pressable mt-3.5 flex h-11 items-center justify-center gap-2 rounded-full bg-slate-100 text-[15px] font-medium text-slate-900 hover:bg-slate-200"
              >
                <Icon name="chat" size={18} />
                Abrir WhatsApp
              </a>
              <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-500">
                {STAFF_MESSAGE_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <dl className="mt-4 space-y-2.5 border-t hairline pt-4 text-[14px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Invitación</dt>
                  <dd>
                    <Link
                      href={`/equipo/invitar?cliente=${client.id}`}
                      className="font-medium text-blue-700 underline-offset-2 hover:underline"
                    >
                      {client.signedUpAt ? "Reenviar enlace" : "Preparar enlace"}
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section aria-labelledby="acuerdo" data-testid="agreement-record">
            <SectionTitle>
              <span id="acuerdo">Acuerdo</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <p className="text-[15px] font-medium leading-snug text-slate-900">{agreementLine(client, now)}</p>
              <dl className="mt-3 space-y-2.5 border-t hairline pt-3 text-[14px]">
                {agreementRows.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              {client.serviceEndReason && (
                <p className="mt-3 rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-700">
                  Lo que escribió: «{client.serviceEndReason}»
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                El acuerdo lo firma y lo cancela el cliente desde su app. El equipo no puede firmarlo ni cambiarlo.
              </p>
            </div>
          </section>

          <BillingCard client={client} data={data} now={now} onChanged={reload} />

          <section aria-labelledby="documentos">
            <SectionTitle>
              <span id="documentos">Documentos</span>
            </SectionTitle>
            <ul className="card overflow-hidden">
              {documents.map((kind, index) => {
                const onFile = client.documents.includes(kind);
                return (
                  <li key={kind} className={`flex items-center justify-between gap-3 px-5 py-3 ${index > 0 ? "border-t hairline" : ""}`}>
                    <span className="text-[14px] text-slate-900">{DOCUMENT[kind]}</span>
                    {onFile ? (
                      <Chip tone="bg-green-50 text-green-700">En archivo</Chip>
                    ) : (
                      // Gold once the client has signed and the document is actually being waited on.
                      <Chip
                        tone={
                          (client.agreementSignedAt && missing.includes(kind)) || kind === "identity_theft_report"
                            ? WAITING_TONE
                            : "bg-slate-100 text-slate-600"
                        }
                      >
                        Falta
                      </Chip>
                    )}
                  </li>
                );
              })}
            </ul>
            {data.demo && theftReportMissing && (
              <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
                Los documentos los sube el cliente. Demo:{" "}
                <button
                  type="button"
                  data-testid="demo-upload-theft-report"
                  onClick={async () => {
                    demoClientUploads(client.id, "identity_theft_report");
                    await reload();
                  }}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  simular que el cliente subió su reporte de robo de identidad
                </button>
                .
              </p>
            )}
          </section>

          <section aria-labelledby="historia">
            <SectionTitle>
              <span id="historia">Historia</span>
            </SectionTitle>
            <ol className="card px-5 py-4">
              {timeline.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="relative flex gap-3 pb-3.5 last:pb-0">
                  {index < timeline.length - 1 && (
                    <span className="absolute left-[4.5px] top-4 h-full w-px bg-slate-200" aria-hidden="true" />
                  )}
                  <span
                    className={`relative mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${
                      entry.kind === "upcoming" ? "bg-white ring-2 ring-green-600" : entry.kind === "client" ? "bg-amber-500" : "bg-slate-400"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className={`break-words text-[14px] leading-snug ${entry.kind === "upcoming" ? "font-medium text-green-700" : "text-slate-800"}`}>
                      {entry.kind === "upcoming" ? `Sigue: ${entry.text.charAt(0).toLowerCase() + entry.text.slice(1)}` : entry.text}
                    </p>
                    {entry.kind !== "upcoming" && (
                      <p className="text-xs text-slate-500">
                        {shortDay(entry.at)} · {relativeDay(entry.at, now)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="notas">
            <SectionTitle>
              <span id="notas">Notas del equipo</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              {client.notes.length === 0 ? (
                <p className="text-[14px] text-slate-500">Sin notas.</p>
              ) : (
                <ul className="space-y-3">
                  {[...client.notes].reverse().map((n) => (
                    <li key={n.id}>
                      <p className="break-words text-[14px] leading-snug text-slate-800">{n.text}</p>
                      <p className="text-xs text-slate-500">
                        {n.author} · {shortDay(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <label htmlFor="nota" className="sr-only">
                Nota nueva
              </label>
              <textarea
                id="nota"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Escribe una nota para el equipo"
                className="mt-3.5 w-full resize-y rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300"
              />
              <button
                type="button"
                onClick={saveNote}
                disabled={!note.trim()}
                className="pressable mt-2 flex h-10 w-full items-center justify-center rounded-full bg-slate-100 text-[14px] font-medium text-slate-900 hover:bg-slate-200 disabled:text-slate-400"
              >
                Guardar nota
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
