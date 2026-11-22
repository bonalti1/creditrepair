"use client";

import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { count, longDay } from "@/lib/staff/format";
import {
  buildPrintBatch,
  parseRoundRefs,
  ROUND_REFS_PARAM,
  slipLine,
  slipNames,
  totalPages,
  type PrintBatch,
  type PrintLetter,
} from "@/lib/staff/printBatch";
import { RESPONSE_WINDOW_DAYS } from "@/lib/staff/stage";
import { useStaff } from "@/lib/staff/useStaff";
import { useMail } from "@/lib/mail/useMail";
import { useLetterVersions } from "@/lib/letters/versions/useLetterVersions";
import { useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";
import Icon from "@/components/Icon";
import { PRIMARY_BUTTON, PRIMARY_BUTTON_COMPACT, SECONDARY_BUTTON, SECONDARY_BUTTON_COMPACT } from "@/components/staff/ui";

// Print a batch of letters here, in the office, instead of through a mail
// service. The screen shows the pages as they come out of the printer; the
// toolbar above them is the only thing that is not printed.
//
// On paper, in this order: one cover for the batch (who, which letters, and
// boxes to tick as each is printed, signed and mailed), then every letter, each
// followed by a slip naming the copies that go in its envelope. The copies are
// the client's own photos, so the slip is a reminder and not the copy itself.
//
// The cover and the slips are for the team, so they are in the member's
// language; the letters themselves are the English letter text.
//
// The page layout is plain print CSS in physical units, kept in this file so it
// can be read in one place. Two things in it are deliberate:
//   - @page has no margin, and each sheet carries its own. With a margin the
//     browser may print its own header and footer there (address, date, page
//     number); with none there is nowhere for them to go.
//   - Each sheet is a table whose empty header and footer rows are the top and
//     bottom margins. The browser repeats those rows on every page a sheet
//     runs to, so a long letter keeps its margins on the second page.
//
// The recipient's address is placed for a standard #10 window envelope with
// the sheet folded in thirds: 1 in from the left edge and 2.5 in from the top.
// The sender and date sit above the window and the letter starts below it.

const PRINT_CSS = `
@page { size: letter; margin: 0; }

.pl-stack { display: flex; flex-direction: column; align-items: center; gap: 24px; width: max-content; min-width: 100%; }
.pl-sheet {
  width: 8.5in; height: 11in; flex: none; table-layout: fixed; border-collapse: collapse;
  background: #fff; color: #000;
  box-shadow: 0 0 0 1px rgba(29, 29, 31, 0.08), 0 8px 24px -12px rgba(29, 29, 31, 0.25);
}
.pl-sheet td { padding: 0; vertical-align: top; }
.pl-margin { height: 0.75in; }
.pl-cell { padding: 0 1in !important; }

.pl-letter { font-family: "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif; font-size: 11pt; line-height: 1.35; }
.pl-head { position: relative; height: 3in; }
.pl-lines { white-space: pre-line; }
.pl-date { margin-top: 1.35em; }
.pl-recipient { position: absolute; top: 1.75in; left: 0; width: 3.4in; line-height: 1.2; white-space: pre-line; overflow-wrap: break-word; }
.pl-text { white-space: pre-wrap; overflow-wrap: break-word; orphans: 2; widows: 2; }
.pl-closing { margin-top: 1.35em; break-inside: avoid; }
.pl-sign { height: 0.55in; }
.pl-after { margin-top: 1.35em; white-space: pre-wrap; break-inside: avoid; }

.pl-note { font-family: Helvetica, Arial, "Liberation Sans", sans-serif; font-size: 10.5pt; line-height: 1.4; }
.pl-note h1 { font-size: 18pt; font-weight: 700; line-height: 1.2; margin: 0; letter-spacing: 0; }
.pl-note p { margin: 0; }
.pl-kicker { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #444; }
.pl-list { width: 100%; border-collapse: collapse; margin-top: 0.3in; }
.pl-list th { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; text-align: left; padding: 0 6pt 5pt 0 !important; border-bottom: 1pt solid #000; }
.pl-list td { padding: 6pt 6pt 6pt 0 !important; border-bottom: 0.5pt solid #999; overflow-wrap: break-word; }
.pl-list tr { break-inside: avoid; }
.pl-list .pl-tick { width: 0.72in; text-align: center; padding-right: 0 !important; }
.pl-box { display: inline-block; width: 11pt; height: 11pt; border: 1pt solid #000; vertical-align: middle; }
.pl-slip-list { list-style: none; margin: 0.3in 0 0; padding: 0; font-size: 13pt; }
.pl-slip-list li { display: flex; align-items: center; gap: 10pt; padding: 7pt 0; }
.pl-small { font-size: 9.5pt; color: #444; }

@media print {
  html, body { background: #fff !important; }
  .pl-screen { display: none !important; }
  nextjs-portal { display: none !important; }
  .pl-scroll { overflow: visible !important; padding: 0 !important; margin: 0 !important; }
  .pl-stack { display: block; width: auto; min-width: 0; }
  .pl-sheet { height: auto; box-shadow: none; break-after: page; }
  .pl-sheet:last-child { break-after: auto; }
}
`;

/** CSS pixels per inch: how the browser maps the sheet's inches on screen. */
const INCH = 96;
/** Room for text on a page between the top and bottom margins, in inches. */
const PAGE_ROOM = 11 - 2 * 0.75;
/** Room on a letter's first page, below the address block. */
const FIRST_PAGE_ROOM = PAGE_ROOM - 3;

/** One sheet of paper: its content between a top and a bottom margin that repeat on every page it runs to. */
function Sheet({ kind, className, children }: { kind: string; className: string; children: React.ReactNode }) {
  return (
    <table className={`pl-sheet ${className}`} role="presentation" data-sheet={kind}>
      <thead>
        <tr>
          <td className="pl-margin" />
        </tr>
      </thead>
      <tfoot>
        <tr>
          <td className="pl-margin" />
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td className="pl-cell">{children}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Box() {
  return <span className="pl-box" aria-hidden="true" />;
}

function Cover({ batch, now }: { batch: PrintBatch; now: Date }) {
  const t = useTx();
  const { locale } = useStaffLocale();
  return (
    <Sheet kind="cover" className="pl-note">
      <div data-pl-flow="cover">
        <p className="pl-kicker">{t("Hoja de control · no va en ningún sobre", "Control sheet · doesn't go in any envelope")}</p>
        <h1>{t("Lote de cartas para imprimir", "Batch of letters to print")}</h1>
        <p style={{ marginTop: "4pt" }}>
          {longDay(now.toISOString(), locale)} ·{" "}
          {t(
            `${count(batch.counts.rounds, "ronda", "rondas")} de ${count(batch.counts.clients, "cliente", "clientes")} · ${count(batch.counts.letters, "carta", "cartas")}`,
            `${count(batch.counts.rounds, "round", "rounds")} for ${count(batch.counts.clients, "client", "clients")} · ${count(batch.counts.letters, "letter", "letters")}`,
          )}
        </p>
        <table className="pl-list">
          <thead>
            <tr>
              <th style={{ width: "1.55in" }}>{t("Cliente", "Client")}</th>
              <th style={{ width: "0.6in" }}>{t("Ronda", "Round")}</th>
              <th>{t("Carta para", "Letter to")}</th>
              <th className="pl-tick">{t("Impresa", "Printed")}</th>
              <th className="pl-tick">{t("Firmada", "Signed")}</th>
              <th className="pl-tick">{t("Enviada", "Mailed")}</th>
            </tr>
          </thead>
          <tbody>
            {batch.rounds.flatMap(({ client, round, letters }) =>
              letters.map((letter, index) => (
                <tr key={letter.id} data-cover-row={client.id}>
                  <td>{index === 0 ? letter.clientName : ""}</td>
                  <td>{index === 0 ? round.number : ""}</td>
                  <td>{letter.recipient.name}</td>
                  <td className="pl-tick">
                    <Box />
                  </td>
                  <td className="pl-tick">
                    <Box />
                  </td>
                  <td className="pl-tick">
                    <Box />
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <p className="pl-small" style={{ marginTop: "0.25in" }}>
          {t(
            "Después de cada carta que lleva copias sale una hoja «Adjuntar» con lo que va en su sobre. Esas hojas y esta son para el equipo: no van en ningún sobre.",
            "Each letter that needs copies is followed by an “Enclose” sheet listing what goes in its envelope. Those sheets and this one are for the team: they don't go in any envelope.",
          )}
        </p>
      </div>
    </Sheet>
  );
}

function LetterSheet({ letter }: { letter: PrintLetter }) {
  const { parts } = letter;
  return (
    <Sheet kind="letter" className="pl-letter">
      {parts ? (
        <>
          <div className="pl-head">
            <div className="pl-lines">{parts.sender.join("\n")}</div>
            <div className="pl-date">{parts.date}</div>
            <div className="pl-recipient" data-pl-recipient>
              {parts.recipient.join("\n")}
            </div>
          </div>
          <div data-pl-flow="letter" data-pl-room={FIRST_PAGE_ROOM}>
            <div className="pl-text">{parts.body}</div>
            {parts.closing && (
              <div className="pl-closing">
                <div>{parts.closing.valediction}</div>
                {/* Room for the signature, by hand. */}
                <div className="pl-sign" />
                <div>{parts.closing.name}</div>
              </div>
            )}
            {parts.after && <div className="pl-after">{parts.after}</div>}
          </div>
        </>
      ) : (
        // A text without the usual header is printed exactly as it is.
        <div data-pl-flow="letter" data-pl-room={PAGE_ROOM} className="pl-text">
          {letter.text}
        </div>
      )}
    </Sheet>
  );
}

function Slip({ letter, locale }: { letter: PrintLetter; locale: StaffLocale }) {
  const t = useTx();
  return (
    <Sheet kind="slip" className="pl-note">
      <p className="pl-kicker">{t("Recordatorio para el equipo · no va en el sobre", "Reminder for the team · doesn't go in the envelope")}</p>
      <h1>{slipLine(letter.enclosures, locale)}</h1>
      <p style={{ marginTop: "6pt" }}>
        {t(
          `En el sobre de la carta anterior: ${letter.clientName}, ronda ${letter.roundNumber}, para ${letter.recipient.name}.`,
          `In the envelope of the letter before this: ${letter.clientName}, round ${letter.roundNumber}, to ${letter.recipient.name}.`,
        )}
      </p>
      <ul className="pl-slip-list">
        {slipNames(letter.enclosures, locale).map((name) => (
          <li key={name}>
            <Box />
            <span>{name.charAt(0).toUpperCase() + name.slice(1)}</span>
          </li>
        ))}
      </ul>
      <p className="pl-small" style={{ marginTop: "0.3in" }}>
        {t(
          "Las copias son las fotos que subió el cliente. Se imprimen aparte y van detrás de la carta.",
          "The copies are the photos the client uploaded. Print them separately and put them behind the letter.",
        )}
      </p>
    </Sheet>
  );
}

function PrintView() {
  const params = useSearchParams();
  const t = useTx();
  const { locale } = useStaffLocale();
  const { data, ready: clientsReady, clients, now, reload } = useStaff();
  // Letters to creditors and collectors print with the address book's address, and wait without one.
  const { furnishers, ready: bookReady } = useMail();
  // Letters print with the attorney-approved text, the one the server records as mailed.
  const { versions: letterVersions, ready: lettersReady } = useLetterVersions({ approvedOnly: true });
  const ready = clientsReady && bookReady && lettersReady;
  const requested = params.get(ROUND_REFS_PARAM);
  const refs = useMemo(() => parseRoundRefs(requested), [requested]);
  const batch = useMemo(
    () => buildPrintBatch(clients, refs, now, { furnishers, letterVersions, locale }),
    [clients, refs, now, furnishers, letterVersions, locale],
  );

  const stackRef = useRef<HTMLDivElement>(null);
  /** Pages on paper, measured from the sheets on screen (they are the same size as the paper). */
  const [pages, setPages] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [marked, setMarked] = useState<{ rounds: number; clients: number } | null>(null);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const flows = [...stack.querySelectorAll<HTMLElement>("[data-pl-flow]")];
    const pagesFor = (el: HTMLElement, firstRoom: number) => {
      const height = el.offsetHeight / INCH;
      return height <= firstRoom + 0.01 ? 1 : 1 + Math.ceil((height - firstRoom) / PAGE_ROOM);
    };
    const cover = flows.filter((el) => el.dataset.plFlow === "cover").map((el) => pagesFor(el, PAGE_ROOM));
    const letters = flows
      .filter((el) => el.dataset.plFlow === "letter")
      .map((el) => pagesFor(el, Number(el.dataset.plRoom) || PAGE_ROOM));
    setPages(totalPages(cover[0] ?? 1, letters, batch.counts.slips));
  }, [batch]);

  if (!ready) return null;

  const { counts, toMark } = batch;
  const markClients = new Set(toMark.map((ref) => ref.clientId)).size;
  const markSummary = t(
    `${count(toMark.length, "ronda", "rondas")} de ${count(markClients, "cliente", "clientes")}`,
    `${count(toMark.length, "round", "rounds")} for ${count(markClients, "client", "clients")}`,
  );
  const shownPages = pages ?? counts.pagesAtLeast;

  const mark = async () => {
    if (toMark.length === 0 || working) return;
    setWorking(true);
    try {
      await data.markRoundsSent(toMark, { via: "print" });
      setMarked({ rounds: toMark.length, clients: markClients });
    } catch (error) {
      // With the database the server checks every round again; one it refuses is not marked.
      window.alert(staffMessage(error instanceof Error && error.message ? error.message : "No se pudo marcar como enviadas. Intenta de nuevo.", locale));
    }
    setConfirming(false);
    await reload();
    setWorking(false);
  };

  return (
    <main>
      <style>{PRINT_CSS}</style>

      <div className="pl-screen">
        <Link href="/equipo" className="inline-flex items-center gap-1 text-[14px] font-medium text-blue-700">
          <Icon name="chevron" size={16} className="rotate-180" />
          {t("Inicio", "Home")}
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{t("Imprimir cartas", "Print letters")}</h1>

        {counts.letters === 0 ? (
          <div className="card mt-5 px-5 py-6 text-[15px] leading-snug text-slate-600" data-testid="print-empty">
            {t(
              "No hay cartas para imprimir. Elige las rondas en «Listas para enviar», en el inicio, o abre la ronda desde la página del cliente.",
              "There are no letters to print. Choose the rounds under “Ready to send” on the home screen, or open the round from the client's page.",
            )}
          </div>
        ) : (
          <div className="card mt-5 px-5 py-4" data-testid="print-toolbar">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <p className="text-[16px] font-semibold tabular-nums text-slate-900" data-testid="print-counts">
                {t(
                  `${count(counts.letters, "carta", "cartas")} · ${count(shownPages, "página", "páginas")}`,
                  `${count(counts.letters, "letter", "letters")} · ${count(shownPages, "page", "pages")}`,
                )}
                <span className="block text-[13px] font-normal text-slate-500">
                  {t(
                    `${count(counts.rounds, "ronda", "rondas")} de ${count(counts.clients, "cliente", "clientes")} · 1 hoja de control · ${count(counts.slips, "hoja «Adjuntar»", "hojas «Adjuntar»")}`,
                    `${count(counts.rounds, "round", "rounds")} for ${count(counts.clients, "client", "clients")} · 1 control sheet · ${count(counts.slips, "“Enclose” sheet", "“Enclose” sheets")}`,
                  )}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => window.print()} className={PRIMARY_BUTTON}>
                  {t("Imprimir", "Print")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={toMark.length === 0 || confirming}
                  className={SECONDARY_BUTTON}
                >
                  {t("Marcar como enviadas por correo", "Mark as mailed")}
                </button>
              </div>
            </div>

            {confirming && toMark.length > 0 && (
              <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3.5" role="group" aria-labelledby="confirmar-envio" data-testid="mark-confirm">
                <p id="confirmar-envio" className="text-[15px] font-semibold leading-snug text-slate-900">
                  {t(`¿Marcar ${markSummary} como enviadas por correo?`, `Mark ${markSummary} as mailed?`)}
                </p>
                <p className="mt-1 text-[14px] leading-snug text-slate-700">
                  {batch.rounds
                    .filter((r) => !r.alreadySent)
                    .map((r) => t(`${r.letters[0]!.clientName} (ronda ${r.round.number})`, `${r.letters[0]!.clientName} (round ${r.round.number})`))
                    .join(" · ")}
                  {t(
                    `. Hazlo cuando los sobres ya estén en el correo: desde ese día el sistema cuenta los ${RESPONSE_WINDOW_DAYS} días de respuesta.`,
                    `. Do this once the envelopes are in the mail: from that day the system counts the ${RESPONSE_WINDOW_DAYS} days for answers.`,
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={mark} disabled={working} className={PRIMARY_BUTTON_COMPACT}>
                    {t(`Sí, marcar ${count(toMark.length, "ronda", "rondas")}`, `Yes, mark ${count(toMark.length, "round", "rounds")}`)}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={SECONDARY_BUTTON_COMPACT}>
                    {t("Cancelar", "Cancel")}
                  </button>
                </div>
              </div>
            )}

            {marked && (
              <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700" role="status" data-testid="mark-done">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>
                  {t(
                    `${count(marked.rounds, "ronda marcada", "rondas marcadas")} como ${marked.rounds === 1 ? "enviada" : "enviadas"} por correo, de ${count(marked.clients, "cliente", "clientes")}. El sistema vuelve a importar cada reporte en ${RESPONSE_WINDOW_DAYS} días.`,
                    `${count(marked.rounds, "round", "rounds")} marked as mailed, for ${count(marked.clients, "client", "clients")}. The system imports each report again in ${RESPONSE_WINDOW_DAYS} days.`,
                  )}
                  {data.demo && t(" (En la demo solo quedan marcadas.)", " (In the demo they're only marked.)")}
                </span>
              </p>
            )}
            {!marked && toMark.length === 0 && (
              <p className="mt-3 text-[13px] leading-snug text-slate-500">
                {t("Estas rondas ya están marcadas como enviadas. Lo que ves es una copia.", "These rounds are already marked as mailed. What you see is a copy.")}
              </p>
            )}

            <p className="mt-3 border-t hairline pt-3 text-xs leading-relaxed text-slate-500">
              {t(
                "En el cuadro de impresión: papel tamaño Carta, escala 100 %, sin encabezados ni pies de página. Con la hoja doblada en tres, la dirección del destinatario queda en la ventana de un sobre #10. Las copias de identificación y de domicilio son las fotos del cliente y se imprimen aparte",
                "In the print dialog: Letter paper, 100% scale, no headers or footers. With the sheet folded in thirds, the recipient's address shows in the window of a #10 envelope. The ID and proof-of-address copies are the client's photos and print separately",
              )}
              {data.demo ? t("; en la demo no hay ninguna.", "; the demo has none.") : "."}
            </p>
          </div>
        )}

        {batch.skipped.length > 0 && (
          <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-[14px] leading-snug text-blue-900" data-testid="print-skipped">
            <p className="font-semibold">{t(`No se ${batch.skipped.length === 1 ? "incluye" : "incluyen"}:`, "Left out:")}</p>
            <ul className="mt-1 space-y-0.5">
              {batch.skipped.map((s) => (
                <li key={`${s.ref.clientId}:${s.ref.roundNumber}`}>
                  {s.clientName ?? s.ref.clientId}, {t("ronda", "round")} {s.ref.roundNumber}. {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {counts.letters > 0 && (
        // Scrolls sideways inside itself on a narrow screen: a sheet is always its real width.
        <div className="pl-scroll -mx-4 mt-6 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
          <div ref={stackRef} className="pl-stack">
            <Cover batch={batch} now={now} />
            {batch.letters.flatMap((letter) => [
              <LetterSheet key={letter.id} letter={letter} />,
              ...(letter.enclosures.length > 0 ? [<Slip key={`${letter.id}-slip`} letter={letter} locale={locale} />] : []),
            ])}
          </div>
        </div>
      )}
    </main>
  );
}

export default function ImprimirPage() {
  return (
    <Suspense fallback={null}>
      <PrintView />
    </Suspense>
  );
}
