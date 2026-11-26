"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Bureau } from "@/lib/domain/types";
import { readerLabel } from "@/lib/reports/readers";
import { demoClientUploads } from "@/lib/staff/data";
import { count, formatBytes, formatPhone, longDay, relativeDay, shortDateTime, shortDay } from "@/lib/staff/format";
import { staffLetterText } from "@/lib/staff/letters";
import type { LetterVersion } from "@/lib/letters/versions/versions";
import { useLetterVersions } from "@/lib/letters/versions/useLetterVersions";
import { exceptionMessage, STAFF_MESSAGE_RULE_TEXT, whatsappHref } from "@/lib/staff/messages";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { roundRefsHref, sendRefsHref } from "@/lib/staff/printBatch";
import type { FurnisherEntry } from "@/lib/mail/furnishers";
import { addressBookHref, chosenMailClass, letterAsItWillGo, letterDestination } from "@/lib/mail/sendPlan";
import { returnReason } from "@/lib/mail/tracking";
import { useMail } from "@/lib/mail/useMail";
import { personExceptions } from "@/lib/autopilot/queue";
import { useAutopilot } from "@/lib/autopilot/useAutopilot";
import AutopilotCard from "@/components/staff/AutopilotCard";
import { MailClassChip, MailTimeline, SimulatedPill, TrackingLink } from "@/components/staff/MailBits";
import {
  agreementLine,
  clientAgreement,
  clientStage,
  formatDay,
  handledExceptions,
  identityTheftItemsWithoutReport,
  missingDocuments,
  RESPONSE_WINDOW_DAYS,
  reviewProgress,
  sendableRound,
  sendBlockReason,
  STAGE_TEXT,
} from "@/lib/staff/stage";
import { clientTimeline } from "@/lib/staff/timeline";
import { clientActivity } from "@/lib/staff/activity";
import { historyFor, nextStepFor } from "@/lib/staff/clientList";
import { deniedReason, exceptionVisibleTo } from "@/lib/staff/permissions";
import { memberName } from "@/lib/staff/team";
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
import DataChecks from "@/components/DataChecks";
import { checksForItem, dataChecks } from "@/lib/domain/checks";
import ActivityList from "@/components/staff/ActivityList";
import AssignmentCard from "@/components/staff/AssignmentCard";
import LeadSourceCard from "@/components/staff/LeadSourceCard";
import BillingCard from "@/components/staff/BillingCard";
import OptionBadge from "@/components/staff/OptionBadge";
import { clientOption, isDiy, openMailRequest } from "@/lib/staff/stage";
import { OPTION_NAME } from "@/lib/service/options";
import Conversation from "@/components/staff/Conversation";
import { ClientPulse } from "@/components/staff/PulseCards";
import ReportImport from "@/components/staff/ReportImport";
import ReportsTab from "@/components/staff/ReportsTab";
import HouseholdMemberCard from "@/components/staff/HouseholdMember";
import AftercareCard, { ItinBadge } from "@/components/staff/AftercareCard";
import PartnerThreadCard from "@/components/staff/PartnerThreadCard";
import { RELATIONSHIP_LABEL } from "@/lib/household/household";
import { reportHistoryOf } from "@/lib/reports/history";
import { reappearedItems } from "@/lib/reports/reimport";
import IntakeChecks from "@/components/staff/IntakeChecks";
import DocumentsCard from "@/components/staff/fulfillment/DocumentsCard";
import JourneyStrip from "@/components/staff/fulfillment/JourneyStrip";
import MessagesCard from "@/components/staff/fulfillment/MessagesCard";
import MonitoringCard from "@/components/staff/fulfillment/MonitoringCard";
import { DOCUMENT_KIND_LABEL } from "@/lib/fulfillment/documents";
import { ActorTag, Chip, ClientLanguageTag, DeniedNote, pillTab, PRIMARY_BUTTON, QUIET_BUTTON, ROW_BUTTON, SectionTitle, SeverityDot, StageChip, WAITING_TONE, BACK_LINK } from "@/components/staff/ui";

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
//
// In the member's language; what goes to the client (the WhatsApp drafts, a
// reply) is in the client's, and says so (ClientLanguageTag).

const BUREAU: Record<Bureau, string> = { equifax: "Equifax", experian: "Experian", transunion: "TransUnion" };

const ROUND_STATUS: Record<RoundStatus, { label: { es: string; en: string }; tone: string }> = {
  draft: { label: { es: "En preparación", en: "Being prepared" }, tone: "bg-slate-100 text-slate-600" },
  ready: { label: { es: "Lista para enviar", en: "Ready to send" }, tone: "bg-blue-50 text-blue-700" },
  mailed: { label: { es: "Enviada", en: "Mailed" }, tone: "bg-green-50 text-green-700" },
  responded: { label: { es: "Con respuesta", en: "Answered" }, tone: "bg-green-50 text-green-700" },
};

const MAIL_STATUS: Record<MailStatus, { label: { es: string; en: string }; tone: string }> = {
  not_sent: { label: { es: "Sin enviar", en: "Not sent" }, tone: "bg-slate-100 text-slate-600" },
  in_transit: { label: { es: "En camino", en: "In transit" }, tone: "bg-blue-50 text-blue-700" },
  delivered: { label: { es: "Entregada", en: "Delivered" }, tone: "bg-green-50 text-green-700" },
  returned: { label: { es: "Devuelta", en: "Returned" }, tone: "bg-red-50 text-red-700" },
  undeliverable: { label: { es: "No se pudo entregar", en: "Undeliverable" }, tone: "bg-red-50 text-red-700" },
};

function AnswerChip({ answer }: { answer: ItemAnswer | undefined }) {
  const t = useTx();
  if (answer?.status === "inaccurate") return <Chip tone="bg-blue-50 text-blue-700">{t("Inexacto", "Inaccurate")}</Chip>;
  if (answer?.status === "correct") return <Chip tone="bg-slate-100 text-slate-600">{t("Correcto", "Correct")}</Chip>;
  return <Chip tone={WAITING_TONE}>{t("Sin responder", "Not answered")}</Chip>;
}

/**
 * The reason the client picked, beside their "Inexacto" answer. An item
 * confirmed before reasons existed has none: it still counts, its letter line
 * carries no reason, and it is marked quietly so the team knows why.
 */
function AnswerReason({ answer }: { answer: ItemAnswer | undefined }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  if (answer?.status !== "inaccurate") return null;
  const label = reasonLabel(answer.reasonCode, locale);
  if (!label) {
    return (
      <span
        data-testid="sin-motivo"
        title={t(
          "Confirmado antes de que se pidiera un motivo. Cuenta igual; su línea en la carta va sin motivo.",
          "Confirmed before a reason was asked for. It still counts; its line in the letter goes without a reason.",
        )}
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500"
      >
        {t("sin motivo", "no reason")}
      </span>
    );
  }
  return (
    <span data-testid="answer-reason" className="min-w-0 break-words text-right text-[13px] leading-snug text-slate-600">
      {label}
    </span>
  );
}

/**
 * How the letter travels: its class, the address it goes (or went) to, the
 * USPS tracking number with its link, and what the post office reported.
 * A prepared letter to a creditor or collector shows the address book's
 * address, or that it has none yet.
 */
function LetterMailInfo({ round, letter, furnishers }: { round: StaffRound; letter: StaffLetter; furnishers: readonly FurnisherEntry[] }) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const mail = letter.mail;
  if (!mail) {
    if (round.status !== "ready" && round.status !== "draft") return null;
    const destination = letterDestination(letter, furnishers);
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] leading-snug" data-testid="letter-mail">
        <MailClassChip mailClass={chosenMailClass(letter)} />
        {destination.to ? (
          letter.recipient.type === "furnisher" && <span className="text-slate-500">{t("Dirección de la libreta de acreedores", "Address from the creditor address book")}</span>
        ) : (
          <span className="text-red-700">
            {destination.blocker}{" "}
            {destination.missingCompany && (
              <Link href={addressBookHref(destination.missingCompany, destination.entryId)} className="font-semibold underline underline-offset-2">
                {t("Agregar la dirección", "Add the address")}
              </Link>
            )}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2" data-testid="letter-mail">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug text-slate-600">
        <MailClassChip mailClass={mail.mailClass} />
        {mail.provider === "simulated" && <SimulatedPill title={t("Registro de demostración o sin clave de Lob: no salió por correo.", "A demo record, or no Lob key: it didn't go out by mail.")} />}
        {mail.provider === "print" && <span className="text-slate-500">{t("Impresa en la oficina", "Printed in the office")}</span>}
        {mail.mailedAt && <span>{t(`Enviada el ${shortDay(mail.mailedAt, "es")}`, `Mailed ${shortDay(mail.mailedAt, "en")}`)}</span>}
        {/* First class: the mail service's estimate, not a USPS scan (mail/tracking.ts). */}
        {mail.deliveredAt && (
          <span className="font-medium text-green-700">
            {t(`· entregada el ${shortDay(mail.deliveredAt, "es")}`, `· delivered ${shortDay(mail.deliveredAt, "en")}`)}
            {mail.mailClass === "first_class" ? t(" (estimado del correo)", " (mail service's estimate)") : ""}
          </span>
        )}
        {mail.returnedAt && (
          <span className="font-medium text-red-700">
            {t(`· devuelta el ${shortDay(mail.returnedAt, "es")}`, `· returned ${shortDay(mail.returnedAt, "en")}`)}
            {mail.returnReason ? ` (${returnReason(mail.returnReason, locale)})` : ""}
          </span>
        )}
      </div>
      {mail.trackingNumber && (
        <p className="mt-1 text-[13px] leading-snug text-slate-600">
          {t("Rastreo USPS:", "USPS tracking:")} <TrackingLink trackingNumber={mail.trackingNumber} />
        </p>
      )}
      <MailTimeline mail={mail} />
    </div>
  );
}

function Letter({
  client,
  round,
  letter: recorded,
  now,
  furnishers,
  letterVersions,
}: {
  client: StaffClient;
  round: StaffRound;
  letter: StaffLetter;
  now: Date;
  furnishers: readonly FurnisherEntry[];
  letterVersions: readonly LetterVersion[];
}) {
  // A creditor's or collector's letter shows the address it will go to (the address book's), never the report's.
  const letter = useMemo(() => letterAsItWillGo(recorded, round, furnishers), [recorded, round, furnishers]);
  const { locale } = useStaffLocale();
  const t = useTx();
  // The text as it is mailed, with the reason the client gave after each item.
  // Letters are in English: that is the language the bureaus work in.
  // With the attorney-approved text of the letter (letters/versions), the one the server mails.
  const body = useMemo(() => staffLetterText(client, round, letter, now, letterVersions), [client, round, letter, now, letterVersions]);
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
        <Chip tone={MAIL_STATUS[letter.mailStatus].tone}>{MAIL_STATUS[letter.mailStatus].label[locale]}</Chip>
      </div>
      <LetterMailInfo round={round} letter={letter} furnishers={furnishers} />
      {letter.items.length === 0 ? (
        <p className="mt-1 text-[13px] leading-snug text-slate-500">
          {t("Pide una copia del expediente del cliente. No disputa ningún punto.", "Asks for a copy of the client's file. It doesn't dispute any item.")}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {letter.items.map((item) => {
            const { kicker, title } = itemTitle(item, locale);
            return (
              <li key={item.fingerprint} className="break-words text-[13px] leading-snug text-slate-600">
                {kicker ? `${kicker}: ${title}` : title}
                {removed.has(item.fingerprint) ? (
                  <span className="font-medium text-green-700" data-testid="round-result">
                    {" "}
                    {t(
                      `· ya no aparece en el reporte del ${shortDay(removed.get(item.fingerprint)!.reportDate, "es")}`,
                      `· no longer on the ${shortDay(removed.get(item.fingerprint)!.reportDate, "en")} report`,
                    )}
                  </span>
                ) : (
                  answered && (
                    <span className={current.has(item.fingerprint) ? "text-slate-500" : "font-medium text-green-700"}>
                      {current.has(item.fingerprint)
                        ? t(" · sigue en el reporte nuevo", " · still on the new report")
                        : t(" · ya no aparece en el reporte nuevo", " · no longer on the new report")}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details className="group mt-2">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline md:min-h-0 [&::-webkit-details-marker]:hidden">
          <Icon name="doc" size={15} />
          <span className="group-open:hidden">{t("Ver la carta", "See the letter")}</span>
          <span className="hidden group-open:inline">{t("Ocultar la carta", "Hide the letter")}</span>
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          {t("Va en inglés, el idioma de trabajo de los burós, a nombre del cliente.", "It's in English, the language the bureaus work in, in the client's name.")}
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
  const { data, team, ready: clientsReady, clients, now, reload, viewer, members, can, locale } = useStaff();
  const t = useTx();
  // The furnisher address book: letters to creditors and collectors go only to a checked address in it.
  const { furnishers, ready: bookReady } = useMail();
  // The approved letter texts: the letters below read as they are mailed.
  const { versions: letterVersions } = useLetterVersions({ approvedOnly: true });
  // The autopilot: a notice its follow-ups are still working on is not a person's yet.
  const { autopilot, env, ready: autopilotReady, reload: reloadAutopilot } = useAutopilot();
  const ready = clientsReady && bookReady && autopilotReady;
  const [note, setNote] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  // "Case" (everything below) or "Reports" (every report in the file). "?pestana=reportes" opens the second.
  const [tab, setTab] = useState<"case" | "reports">("case");
  const client = clients.find((c) => c.id === id) ?? null;

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("pestana") === "reportes") setTab("reports");
    // "?importar=1" (from the console's search: "Import report"): the importer opens.
    if (query.get("importar") === "1") setImporting(true);
  }, []);

  // The page is drawn after the data loads, so a link to "#cartas" is honoured here.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [ready]);

  if (!ready) return null;

  if (!client) {
    return (
      <main className="animate-rise">
        <h1 className="page-title">{t("No encontramos a este cliente", "We couldn't find this client")}</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          {t("Puede que no exista o que no esté entre los clientes que tu rol te deja ver.", "They may not exist, or they aren't among the clients your role lets you see.")}
        </p>
        <Link href="/equipo/clientes" className={`${BACK_LINK} mt-2`}>
          {t("Volver a clientes", "Back to clients")}
        </Link>
      </main>
    );
  }

  const stage = clientStage(client, now);
  const step = nextStepFor(client, now, viewer, locale);
  const STAGES = STAGE_TEXT[locale];
  const denied = (capability: Parameters<typeof deniedReason>[0]) => deniedReason(capability, locale);
  // What this member's role is shown and may do (permissions.ts; the data layer checks again).
  const caseView = can("case.view");
  const exceptions = personExceptions(client, now, { furnishers, autopilot: env, locale })
    .map((p) => p.exception)
    .filter((e) => exceptionVisibleTo(viewer?.role, e.kind));
  const handled = handledExceptions(client, now, { furnishers, locale }).filter((e) => exceptionVisibleTo(viewer?.role, e.kind));
  const prepared = sendableRound(client, now, { furnishers });
  const round = can("rounds.send") ? prepared : null;
  const activity = clientActivity(client, members, locale).filter((e) => e.actor !== "client");
  const blocked = stage === "ready_to_send" || stage === "next_round_ready" ? sendBlockReason(client, now, { furnishers, locale }) : null;
  const at = (iso: string) => shortDateTime(iso, locale);
  // The agreement record, as rows: what is on file and when.
  const deadline = client.agreementSignedAt ? deadlineOf(clientAgreement(client)) : null;
  const acknowledgedAt = clientAgreement(client).disclosureAcknowledgedAt;
  const agreementRows: Array<[string, string]> = [
    [t("Declaración de derechos", "Statement of rights"), acknowledgedAt ? t(`Recibida el ${at(acknowledgedAt)}`, `Received ${at(acknowledgedAt)}`) : t("Sin recibir", "Not received")],
    [t("Contrato", "Contract"), client.agreementSignedAt ? t(`Firmado el ${at(client.agreementSignedAt)}`, `Signed ${at(client.agreementSignedAt)}`) : t("Sin firmar", "Not signed")],
    ...(client.agreementSignedAt
      ? ([
          [t("Versión del texto", "Text version"), client.agreementVersion ?? t("Sin registro", "Not recorded")],
          [
            t("Puede cancelar sin costo", "Can cancel at no cost"),
            deadline
              ? t(
                  `Hasta el ${at(deadline.toISOString())}${deadline.getTime() >= now.getTime() ? "" : " (ya pasó)"}`,
                  `Until ${at(deadline.toISOString())}${deadline.getTime() >= now.getTime() ? "" : " (passed)"}`,
                )
              : t("Sin fecha", "No date"),
          ],
        ] as Array<[string, string]>)
      : []),
    ...(client.agreementCancelledAt
      ? ([
          [
            t("Cancelación", "Cancellation"),
            `${at(client.agreementCancelledAt)}, ${
              client.cancelledWithinWindow === false ? t("después del plazo", "after the deadline") : t("dentro del plazo", "within the deadline")
            }`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(client.serviceEndRequestedAt
      ? ([[t("Pidió terminar el servicio", "Asked to end the service"), at(client.serviceEndRequestedAt)]] as Array<[string, string]>)
      : []),
  ];
  const review = reviewProgress(client);
  const timeline = historyFor(clientTimeline(client, now, locale), viewer);
  const missing = missingDocuments(client);
  const rounds = [...client.rounds].sort((a, b) => b.number - a.number);
  // An identity theft claim needs its own document: it is listed as soon as it is being waited on.
  const theftReportMissing = identityTheftItemsWithoutReport(client, locale).length > 0;
  const documents: DocumentKind[] = [
    ...REQUIRED_DOCUMENTS,
    ...client.documents.filter((d) => !REQUIRED_DOCUMENTS.includes(d)),
    ...(theftReportMissing ? (["identity_theft_report"] as const) : []),
  ];
  const samples = client.reportSamples ?? [];
  const reportCount = reportHistoryOf(client).length;
  // Items a round saw disappear that the report lists again (FCRA § 611(a)(5)(B)): back to the client's review.
  const reappeared = new Map(reappearedItems(client.rounds, client.report).map((r) => [r.item.fingerprint, r]));
  // What the report's own data shows, per item (domain/checks.ts). Read-only:
  // for answering the client's questions. Nothing on this page can apply it.
  const checks = client.report ? dataChecks(client.report.items, client.report.pulledAt) : [];

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
      <Link href="/equipo/clientes" className={BACK_LINK}>
        <Icon name="chevron" size={16} className="rotate-180" />
        {t("Clientes", "Clients")}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="page-title">{fullName(client)}</h1>
        <OptionBadge option={clientOption(client)} />
        <StageChip stage={stage} />
        <ItinBadge client={client} />
      </div>
      <p className="mt-1 text-[14px] text-slate-500">
        {client.state === "TX" ? "Texas" : client.state} ·{" "}
        {t(`con ventas desde el ${shortDay(client.createdAt, "es")}`, `with sales since ${shortDay(client.createdAt, "en")}`)} · {t("vendedor", "salesperson")}:{" "}
        {memberName(members, client.salesperson, locale)} · {t("trabaja el caso", "working the case")}:{" "}
        {client.assignedTo ? memberName(members, client.assignedTo, locale) : t("nadie todavía", "nobody yet")} · {t("última actividad", "last activity")}{" "}
        {relativeDay(client.lastActivityAt, now, locale)} · <ClientLanguageTag client={client} />
      </p>
      {isDiy(client) && (
        <p className="mt-1.5 text-[14px] leading-snug text-slate-600" data-testid="client-diy-note">
          <span className="font-medium text-slate-900">{OPTION_NAME.diy[locale]}:</span>{" "}
          {t(
            "el cliente imprime y envía sus propias cartas, preparadas por Alti con los modelos aprobados. El equipo responde sus preguntas y solo envía las cartas que el cliente nos pague por enviar.",
            "the client prints and mails their own letters, prepared by Alti from the approved templates. The team answers their questions and mails only the letters the client pays us to mail.",
          )}
          {openMailRequest(client) &&
            t(
              ` Pidió «Envíenlas por mí» para ${count(openMailRequest(client)!.letterCount, "carta", "cartas")}: están en «Listas para enviar».`,
              ` Asked "Mail them for me" for ${count(openMailRequest(client)!.letterCount, "letter", "letters")}: they're under "Ready to send".`,
            )}
        </p>
      )}
      {client.household && (
        <p className="mt-1.5 text-[14px] text-slate-600" data-testid="client-household">
          <span className="font-medium text-slate-900">{t("Hogar", "Household")}:</span>{" "}
          <Link href={`/equipo/clientes/${client.household.partnerId}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
            {client.household.partnerName}
          </Link>
          {client.household.relationship !== "household" ? ` · ${RELATIONSHIP_LABEL[locale][client.household.relationship]}` : ""}
          {" · "}
          {client.household.status === "linked"
            ? t("los dos tienen cuenta; descuento de hogar", "both have accounts; household discount")
            : t("invitación enviada; cada uno con su propio caso", "invited; each has their own case")}
        </p>
      )}

      {caseView && (
        <div className="mt-5 flex gap-1.5 sm:inline-flex" role="tablist" aria-label={t("Secciones del cliente", "Client sections")} data-testid="client-tabs">
          {(
            [
              ["case", t("Caso", "Case")],
              ["reports", `${t("Reportes", "Reports")} · ${reportCount}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`tab-${key}`}
              onClick={() => {
                setTab(key);
                const url = new URL(window.location.href);
                if (key === "reports") url.searchParams.set("pestana", "reportes");
                else url.searchParams.delete("pestana");
                window.history.replaceState(null, "", url.toString());
              }}
              className={`${pillTab(tab === key)} flex-1 sm:flex-none`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {caseView && tab === "reports" ? (
          <div className="min-w-0">
            <ReportsTab client={client} demo={data.demo} locale={locale} />
          </div>
        ) : (
        <div className="min-w-0 space-y-6">
          <section className="card px-5 py-5 sm:px-6" aria-label={t("Dónde está y qué sigue", "Where they are and what's next")}>
            <JourneyStrip client={client} stage={stage} />
            <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Dónde está", "Where they are")}</p>
            <p className="mt-1.5 text-[17px] leading-snug text-slate-900">
              {/* The documents stage names the ones still missing (or not accepted), not both every time. */}
              {stage === "documents_pending" && missing.length > 0
                ? t(
                    `Falta: ${missing.map((k) => DOCUMENT_KIND_LABEL.es[k as Exclude<typeof k, "ssn_card">].toLowerCase()).join(" y ")}. Van dentro de cada carta; el cliente lo sube desde su app.`,
                    `Missing: ${missing.map((k) => DOCUMENT_KIND_LABEL.en[k as Exclude<typeof k, "ssn_card">].toLowerCase()).join(" and ")}. They go inside every letter; the client uploads them from their app.`,
                  )
                : STAGES[stage].description}
            </p>
            {/* A client past signing with nobody working the case: say so where the next step is read. */}
            {!client.assignedTo && client.agreementSignedAt && stage !== "cancelled" && stage !== "graduated" && (
              <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" data-testid="no-owner">
                {t("Nadie trabaja este caso todavía.", "Nobody is working this case yet.")}{" "}
                {can("clients.assign")
                  ? t("Asígnalo en «Quién lo trabaja», a la derecha (abajo en el teléfono).", "Assign it under “Who works it”, on the right (below on a phone).")
                  : t("Pide a un administrador que lo asigne.", "Ask an administrator to assign it.")}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-4 border-t hairline pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t("Qué sigue", "What's next")}</p>
                <p className="mt-1">
                  <ActorTag actor={step.actor} />
                </p>
                <p className="text-[17px] font-medium leading-snug text-slate-900">{step.text}</p>
              </div>
              {/* The send screen shows each letter's address, mail class and cost before anything goes out. */}
              {round && (
                <Link href={sendRefsHref([{ clientId: client.id, roundNumber: round.number }])} className={`${PRIMARY_BUTTON} shrink-0`}>
                  {t(`Enviar ronda ${round.number} · ${count(round.letters.length, "carta", "cartas")}`, `Send round ${round.number} · ${count(round.letters.length, "letter", "letters")}`)}
                </Link>
              )}
              {prepared && !round && <DeniedNote>{denied("rounds.send")}</DeniedNote>}
              {stage === "lead" && can("clients.invite") && (
                <Link href={`/equipo/invitar?cliente=${client.id}`} className={`${PRIMARY_BUTTON} shrink-0`}>
                  {t("Preparar su invitación", "Prepare their invite")}
                </Link>
              )}
            </div>

            {blocked && (
              <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900">
                {t("La ronda está preparada, pero todavía no se puede enviar.", "The round is prepared, but it can't be sent yet.")} {blocked}
              </p>
            )}
          </section>

          {(exceptions.length > 0 || handled.length > 0) && (
            <section aria-labelledby="avisos">
              <SectionTitle aside={exceptions.some((e) => e.action === "whatsapp") ? <ClientLanguageTag client={client} /> : undefined}>
                <span id="avisos">{t("Necesita una persona", "Needs a person")}</span>
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
                      ) : exception.href ? (
                        <Link href={exception.href} className={ROW_BUTTON}>
                          {exception.actionLabel}
                        </Link>
                      ) : (
                        <a href="#cartas" className={ROW_BUTTON}>
                          {exception.actionLabel}
                        </a>
                      )}
                      <button type="button" onClick={() => markHandled(exception.key)} className={QUIET_BUTTON}>
                        <Icon name="check" size={16} />
                        {t("Atendido", "Handled")}
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
                      <span className="font-medium text-slate-700">
                        {t("Atendido", "Handled")} {relativeDay(exception.handledAt, now, locale)}.
                      </span>{" "}
                      {exception.sentence}{" "}
                      {t(
                        `Si sigue igual, vuelve a la lista el ${formatDay(new Date(exception.returnsAt), "es")}.`,
                        `If nothing changes, it comes back to the list on ${formatDay(new Date(exception.returnsAt), "en")}.`,
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(caseView || can("clients.followup")) && client.signedUpAt && (
            <AutopilotCard
              client={client}
              now={now}
              env={env}
              autopilot={autopilot}
              by={staffAuthor()}
              canHold={can("rounds.send") && caseView}
              canOptOut={can("clients.followup")}
              holdDenied={denied("rounds.send")}
              onChanged={async () => {
                await Promise.all([reload(), reloadAutopilot()]);
              }}
            />
          )}

          {!caseView && (
            <p className="card px-5 py-4 text-[14px] leading-snug text-slate-600" data-testid="case-hidden">
              {denied("case.view")} {t("Aquí ves su etapa, su acuerdo, sus documentos y sus notas.", "Here you see their stage, agreement, documents and notes.")}
            </p>
          )}

          {caseView && (
            <Conversation client={client} data={data} now={now} onSent={reload} viewer={viewer} replyDenied={can("clients.reply") ? null : denied("clients.reply")} />
          )}

          {caseView && client.pulses && client.pulses.length > 0 && <ClientPulse client={client} />}

          {caseView && (
          <section aria-labelledby="reporte">
            <SectionTitle
              aside={
                <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  {client.report && (
                    <span className="text-[13px] text-slate-500">
                      {t(`Reporte del ${longDay(client.report.pulledAt, "es")}`, `Report from ${longDay(client.report.pulledAt, "en")}`)}
                    </span>
                  )}
                  {!importing && can("reports.import") && (
                    <button
                      type="button"
                      onClick={() => {
                        setImporting(true);
                        setImportNote(null);
                      }}
                      className="pressable inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-50 px-3.5 md:h-9 text-[13px] font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <Icon name="arrowUp" size={15} strokeWidth={2.25} />
                      {t("Importar reporte", "Import report")}
                    </button>
                  )}
                </span>
              }
            >
              <span id="reporte">{t("Reporte y respuestas del cliente", "Report and the client's answers")}</span>
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
                {t(
                  "Todavía no hay reporte. Llega solo cuando el cliente activa su monitoreo de crédito, o lo trae el equipo con «Importar reporte».",
                  "No report yet. It comes in on its own once the client turns on their credit monitoring, or the team brings it in with “Import report”.",
                )}
              </div>
            ) : (
              <div className="card overflow-hidden">
                <p className="px-5 py-3.5 text-[14px] leading-snug text-slate-600">
                  <span className="font-medium text-slate-900">
                    {t(
                      `${count(review.total, "punto", "puntos")}: ${review.inaccurate} ${review.inaccurate === 1 ? "inexacto" : "inexactos"}, ${review.correct} ${review.correct === 1 ? "correcto" : "correctos"}, ${review.pending} sin responder.`,
                      `${count(review.total, "item", "items")}: ${review.inaccurate} inaccurate, ${review.correct} correct, ${review.pending} not answered.`,
                    )}
                  </span>{" "}
                  {t("Las respuestas son del cliente. Aquí se leen, no se cambian.", "The answers are the client's. You read them here; you don't change them.")}
                </p>
                <ul>
                  {client.report.items.map((item) => {
                    const { kicker, title } = itemTitle(item, locale);
                    const answer = client.answers[item.fingerprint];
                    const facts = itemFacts(item, locale);
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
                            {reappeared.has(item.fingerprint) && <Chip tone="bg-amber-100 text-blue-900">{t("Volvió a aparecer", "Reappeared")}</Chip>}
                            <AnswerReason answer={answer} />
                            <AnswerChip answer={answer} />
                          </div>
                        </div>
                        {answer?.status === "inaccurate" && (
                          <p className="mt-1 text-[14px] leading-snug text-slate-600">
                            {answer.reason ? `«${answer.reason}» ` : ""}
                            <span className="text-slate-500">
                              {t(`Confirmado por el cliente el ${shortDay(answer.confirmedAt, "es")}.`, `Confirmed by the client ${shortDay(answer.confirmedAt, "en")}.`)}
                            </span>
                          </p>
                        )}
                        {reappeared.has(item.fingerprint) && (
                          <p className="mt-1 text-[13px] leading-snug text-slate-600" data-testid="reappeared-note">
                            {t(
                              `Ya no aparecía en el reporte del ${shortDay(reappeared.get(item.fingerprint)!.goneOn, "es")} (ronda ${reappeared.get(item.fingerprint)!.round}) y volvió. El buró debe certificar que es exacto y avisar al cliente por escrito (FCRA § 611(a)(5)(B)). Está en la revisión del cliente; puede ir en la próxima ronda si el cliente dice que es inexacto.`,
                              `It was gone on the ${shortDay(reappeared.get(item.fingerprint)!.goneOn, "en")} report (round ${reappeared.get(item.fingerprint)!.round}) and came back. The bureau must certify it's accurate and tell the client in writing (FCRA § 611(a)(5)(B)). It's in the client's review; it can go in the next round if the client says it's inaccurate.`,
                            )}
                          </p>
                        )}
                        {answer?.status === "inaccurate" && answer.reasonCode === "identity_theft" && (
                          <p className="mt-1 text-[13px] leading-snug text-slate-500">
                            {t("Este motivo requiere un reporte de robo de identidad de la FTC.", "This reason needs an FTC identity theft report.")}{" "}
                            {client.documents.includes("identity_theft_report") ? t("Está en archivo.", "It's on file.") : t("Todavía no está en archivo.", "It's not on file yet.")}
                          </p>
                        )}
                        {facts.length > 0 && (
                          <details className="group mt-1.5">
                            <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] md:min-h-0 font-medium text-blue-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                              <span className="group-open:hidden">{t("Lo que dice el reporte", "What the report says")}</span>
                              <span className="hidden group-open:inline">{t("Ocultar", "Hide")}</span>
                            </summary>
                            <ItemFacts facts={facts} variant="list" className="mt-2 max-w-md" />
                          </details>
                        )}
                        <DataChecks
                          checks={checksForItem(checks, item.fingerprint)}
                          category={item.category}
                          locale={locale}
                          variant="staff"
                          included={answer?.status === "inaccurate" ? answer.checkIds : undefined}
                          className="mt-2 max-w-2xl"
                        />
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
                    {t(count(samples.length, "muestra guardada", "muestras guardadas"), count(samples.length, "saved sample", "saved samples"))}.
                  </span>{" "}
                  {t(
                    "Son reportes de proveedores que todavía no podemos leer. Se guardan tal como llegaron, para construir el lector con ellos; no cambian la etapa del cliente.",
                    "These are reports from providers we can't read yet. They're kept exactly as they came, to build the reader from them; they don't change the client's stage.",
                  )}
                </p>
                <ul>
                  {samples.map((sample) => (
                    <li key={sample.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t hairline px-5 py-3">
                      <p className="min-w-0 break-words text-[14px] leading-snug text-slate-900">
                        <span className="font-medium">{readerLabel(sample.provider)}</span>
                        <span className="text-slate-500">
                          {" "}
                          · {sample.fileName ?? t("texto pegado", "pasted text")} · {formatBytes(new Blob([sample.text]).size)}
                        </span>
                      </p>
                      <p className="shrink-0 text-[13px] text-slate-500">
                        {shortDay(sample.savedAt, locale)} · {sample.savedBy}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          )}

          {caseView && (
          <section aria-labelledby="cartas" className="scroll-mt-28">
            <SectionTitle>
              <span id="cartas" className="scroll-mt-28">{t("Rondas y cartas", "Rounds and letters")}</span>
            </SectionTitle>
            {rounds.length === 0 ? (
              <div className="card px-5 py-6 text-[15px] leading-snug text-slate-500">
                {t("Todavía no hay cartas. El sistema las prepara cuando el cliente termina su revisión.", "No letters yet. The system prepares them when the client finishes their review.")}
              </div>
            ) : (
              <div className="space-y-4">
                {rounds.map((r) => (
                  <div key={r.number} className="card overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="text-[16px] font-semibold text-slate-900">{t(`Ronda ${r.number}`, `Round ${r.number}`)}</p>
                        <p className="text-[13px] leading-snug text-slate-500">
                          {t(count(r.letters.length, "carta", "cartas"), count(r.letters.length, "letter", "letters"))}
                          {r.mailedAt ? t(` · enviada el ${shortDay(r.mailedAt, "es")}`, ` · mailed ${shortDay(r.mailedAt, "en")}`) : ""}
                          {r.respondedAt ? t(` · reporte nuevo el ${shortDay(r.respondedAt, "es")}`, ` · new report ${shortDay(r.respondedAt, "en")}`) : ""}
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
                            {t("Imprimir esta ronda", "Print this round")}
                          </Link>
                        )}
                        <Chip tone={ROUND_STATUS[r.status].tone}>{ROUND_STATUS[r.status].label[locale]}</Chip>
                      </div>
                    </div>
                    <ul>
                      {r.letters.map((letter) => (
                        <Letter key={letter.id} client={client} round={r} letter={letter} now={now} furnishers={furnishers} letterVersions={letterVersions} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </div>
        )}

        <aside className="min-w-0 space-y-6">
          <section aria-labelledby="contacto">
            <SectionTitle>
              <span id="contacto">{t("Contacto", "Contact")}</span>
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
                {t("Abrir WhatsApp", "Open WhatsApp")}
              </a>
              <ClientLanguageTag client={client} className="mt-2" />
              <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-500">
                {STAFF_MESSAGE_RULE_TEXT[locale].map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              {can("clients.invite") && (
              <dl className="mt-4 space-y-2.5 border-t hairline pt-4 text-[14px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{t("Invitación", "Invite")}</dt>
                  <dd>
                    <Link
                      href={`/equipo/invitar?cliente=${client.id}`}
                      className="font-medium text-blue-700 underline-offset-2 hover:underline"
                    >
                      {client.signedUpAt ? t("Reenviar enlace", "Resend link") : t("Preparar enlace", "Prepare link")}
                    </Link>
                  </dd>
                </div>
              </dl>
              )}
            </div>
          </section>

          <MessagesCard client={client} />

          <MonitoringCard client={client} now={now} demo={data.demo} canRecord={can("clients.followup")} viewerName={viewer?.name ?? staffAuthor()} onChanged={reload} />

          {can("clients.add") && viewer && (
            <section aria-labelledby="hogar">
              <SectionTitle>
                <span id="hogar">{t("Hogar", "Household")}</span>
              </SectionTitle>
              <HouseholdMemberCard primary={client} viewer={viewer} team={team} members={members} onAdded={reload} />
              <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
                {t("Cada persona del hogar tiene su propio caso. Pausar o cancelar es por persona.", "Each person in the household has their own case. Pausing or cancelling is per person.")}
              </p>
            </section>
          )}

          <LeadSourceCard source={client.leadSource} />

          <AftercareCard client={client} now={now} />

          <PartnerThreadCard client={client} viewer={viewer} canWrite={can("clients.followup")} />

          <AssignmentCard client={client} viewer={viewer} members={members} team={team} canAssign={can("clients.assign")} onChanged={reload} />

          <section aria-labelledby="acuerdo" data-testid="agreement-record">
            <SectionTitle>
              <span id="acuerdo">{t("Acuerdo", "Agreement")}</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              <p className="text-[15px] font-medium leading-snug text-slate-900">{agreementLine(client, now, locale)}</p>
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
                  {t("Lo que escribió:", "What they wrote:")} «{client.serviceEndReason}»
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                {t(
                  "El acuerdo lo firma y lo cancela el cliente desde su app. El equipo no puede firmarlo ni cambiarlo.",
                  "The client signs and cancels the agreement from their app. The team can't sign or change it.",
                )}
              </p>
            </div>
          </section>

          {can("billing.view") && (
            <BillingCard
              client={client}
              data={data}
              now={now}
              onChanged={reload}
              refundDenied={can("billing.refund") ? null : denied("billing.refund")}
              pauseDenied={can("billing.pause") ? null : denied("billing.pause")}
            />
          )}

          <section aria-labelledby="documentos">
            <SectionTitle>
              <span id="documentos">{t("Documentos", "Documents")}</span>
            </SectionTitle>
            <DocumentsCard
              client={client}
              documents={documents}
              missing={missing}
              demo={data.demo}
              canReview={can("documents.review")}
              viewerName={viewer?.name ?? staffAuthor()}
              onChanged={reload}
            />
            {data.demo && theftReportMissing && (
              <p className="px-1 pt-2 text-xs leading-relaxed text-slate-500">
                {t("Los documentos los sube el cliente. Demo:", "The client uploads documents. Demo:")}{" "}
                <button
                  type="button"
                  data-testid="demo-upload-theft-report"
                  onClick={async () => {
                    demoClientUploads(client.id, "identity_theft_report");
                    await reload();
                  }}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  {t("simular que el cliente subió su reporte de robo de identidad", "pretend the client uploaded their identity theft report")}
                </button>
                .
              </p>
            )}
            <IntakeChecks client={client} demo={data.demo} canUpload={can("reports.import")} onChanged={reload} />
          </section>

          <section aria-labelledby="historia">
            <SectionTitle>
              <span id="historia">{t("Historia", "History")}</span>
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
                      {entry.kind === "upcoming" ? `${t("Sigue", "Next")}: ${entry.text.charAt(0).toLowerCase() + entry.text.slice(1)}` : entry.text}
                    </p>
                    {entry.kind !== "upcoming" && (
                      <p className="text-xs text-slate-500">
                        {shortDay(entry.at, locale)} · {relativeDay(entry.at, now, locale)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="actividad" data-testid="client-activity">
            <SectionTitle
              aside={
                <Link href={`/equipo/actividad?cliente=${client.id}`} className="inline-flex min-h-11 items-center md:min-h-0 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline">
                  {t("Ver todo", "See all")}
                </Link>
              }
            >
              <span id="actividad">{t("Quién hizo qué", "Who did what")}</span>
            </SectionTitle>
            <div className="card overflow-hidden">
              <ActivityList entries={activity.slice(0, 6)} now={now} showClient={false} />
            </div>
          </section>

          <section aria-labelledby="notas">
            <SectionTitle>
              <span id="notas">{t("Notas del equipo", "Team notes")}</span>
            </SectionTitle>
            <div className="card px-5 py-4">
              {client.notes.length === 0 ? (
                <p className="text-[14px] text-slate-500">{t("Sin notas.", "No notes.")}</p>
              ) : (
                <ul className="space-y-3">
                  {[...client.notes].reverse().map((n) => (
                    <li key={n.id}>
                      <p className="break-words text-[14px] leading-snug text-slate-800">{n.text}</p>
                      <p className="text-xs text-slate-500">
                        {n.author} · {shortDay(n.at, locale)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <label htmlFor="nota" className="sr-only">
                {t("Nota nueva", "New note")}
              </label>
              <textarea
                id="nota"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={t("Escribe una nota para el equipo", "Write a note for the team")}
                className="mt-3.5 w-full resize-y rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300"
              />
              <button
                type="button"
                onClick={saveNote}
                disabled={!note.trim()}
                className="pressable mt-2 flex h-11 w-full items-center justify-center rounded-full bg-slate-100 text-[14px] font-medium text-slate-900 hover:bg-slate-200 disabled:text-slate-400"
              >
                {t("Guardar nota", "Save note")}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
