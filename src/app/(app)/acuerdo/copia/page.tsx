"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AgreementDocumentCard, { Blocks, DraftBanner } from "@/components/agreement/AgreementDocument";
import Icon from "@/components/Icon";
import { AGREEMENT_VERSION, agreementDocuments } from "@/lib/agreement/documents";
import { deadlineMoment, recordMoment } from "@/lib/agreement/format";
import { deadlineOf } from "@/lib/agreement/gate";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { resolveTerms } from "@/lib/agreement/terms";
import { useLocale } from "@/lib/i18n";
import { useAgreement } from "@/lib/ux/agreementStore";

// The client's copy: every document, the record of the signature, and the
// notice of cancellation twice (the law attaches it in duplicate), set up to
// print cleanly. Open at any time, before or after signing.
//
// A signed copy is drawn from what was signed: the language and the business
// terms recorded with the signature, not today's. The text itself is this
// build's; the version and fingerprint printed on the copy say which text the
// signature belongs to.

export default function AcuerdoCopiaPage() {
  const { locale: appLocale } = useLocale();
  const { agreement, hydrated, mode } = useAgreement();
  const readiness = useMemo(() => agreementReadiness(), []);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  useEffect(() => setPrintedAt(new Date()), []);

  if (!hydrated || !printedAt) return null;

  const signed = Boolean(agreement?.signedAt);
  const locale = signed && agreement?.locale ? agreement.locale : appLocale;
  const es = locale === "es";
  const terms = (signed && agreement?.terms) || resolveTerms();
  const deadline = agreement ? deadlineOf(agreement) : null;
  const documents = agreementDocuments(locale, terms, { deadline });
  const notice = documents.find((d) => d.key === "cancellation_notice")!;
  const contract = documents.find((d) => d.key === "contract")!;
  const marks = !readiness.ready;
  const sameVersion = !agreement?.version || agreement.version === AGREEMENT_VERSION;

  const rows: Array<[string, string]> = agreement
    ? [
        [
          es ? "Recibió las declaraciones de sus derechos" : "Received the statements of rights",
          agreement.disclosureAcknowledgedAt ? recordMoment(agreement.disclosureAcknowledgedAt, locale) : "—",
        ],
        [es ? "Firmó el contrato" : "Signed the contract", agreement.signedAt ? recordMoment(agreement.signedAt, locale) : es ? "Sin firmar" : "Not signed"],
        [es ? "Nombre con que firmó" : "Name signed", agreement.signerName ?? "—"],
        [es ? "Puede cancelar sin costo hasta" : "May cancel at no cost until", deadline ? deadlineMoment(deadline, locale) : "—"],
        ...(agreement.cancelledAt
          ? ([[es ? "Canceló" : "Cancelled", `${recordMoment(agreement.cancelledAt, locale)}${agreement.cancelledWithinWindow ? (es ? " (dentro del plazo)" : " (inside the period)") : ""}`]] as Array<[string, string]>)
          : []),
        ...(agreement.serviceEndRequestedAt
          ? ([[es ? "Pidió terminar el servicio" : "Asked to end the service", recordMoment(agreement.serviceEndRequestedAt, locale)]] as Array<[string, string]>)
          : []),
        [es ? "Versión del acuerdo" : "Agreement version", agreement.version ?? AGREEMENT_VERSION],
        [es ? "Huella del texto firmado (SHA-256)" : "Fingerprint of the signed text (SHA-256)", agreement.documentHash ?? "—"],
        [es ? "Firma" : "Signature", es ? "Electrónica, escribiendo su nombre" : "Electronic, by typing the name"],
      ]
    : [];

  return (
    <main className="agreement-copy animate-rise space-y-5">
      {/* The app's bars and the buttons stay on screen and off the paper. */}
      <style>{`
        @media print {
          header, nav, .no-print { display: none !important; }
          body { background: #fff !important; }
          .agreement-copy .card { box-shadow: none !important; border-radius: 0 !important; padding-left: 0 !important; padding-right: 0 !important; }
          .agreement-copy .page-break { break-before: page; }
          .agreement-copy h2, .agreement-copy h3 { break-after: avoid; }
        }
      `}</style>

      <div className="no-print space-y-4">
        <Link href="/acuerdo" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
          <Icon name="chevron" size={16} className="rotate-180" />
          {es ? "Mi acuerdo" : "My agreement"}
        </Link>
        <header className="px-1">
          <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{es ? "Mi copia" : "My copy"}</h1>
          <p className="mt-2 text-[16px] leading-relaxed text-slate-600">
            {es
              ? "Todos tus documentos, el registro de tu firma y el aviso de cancelación. Puedes imprimirlo o guardarlo como PDF cuando quieras."
              : "All your documents, the record of your signature and the notice of cancellation. Print it or save it as a PDF whenever you want."}
          </p>
        </header>
        <button
          type="button"
          onClick={() => window.print()}
          data-testid="print"
          className="pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500"
        >
          {es ? "Imprimir o guardar como PDF" : "Print or save as PDF"}
        </button>
      </div>

      {(marks || mode === "demo_draft") && <DraftBanner locale={locale} demo={mode !== "blocked"} />}
      {!sameVersion && (
        <p role="note" className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-700">
          {es
            ? `Usted firmó la versión ${agreement?.version}. El texto que se muestra es la versión vigente (${AGREEMENT_VERSION}); pida al equipo la copia exacta de la versión que firmó.`
            : `You signed version ${agreement?.version}. The text shown is the current version (${AGREEMENT_VERSION}); ask the team for the exact copy of the version you signed.`}
        </p>
      )}

      <section className="card px-5 py-6 sm:px-7" data-testid="signature-record">
        <h2 className="text-[22px] font-semibold leading-tight text-slate-900">
          {signed ? (es ? "Registro de la firma" : "Signature record") : es ? "Todavía sin firmar" : "Not signed yet"}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            {es
              ? "Esta es una copia para leer antes de firmar. Cuando firmes, aquí queda el registro con la fecha y la hora."
              : "This is a copy to read before signing. Once you sign, the record with the date and time appears here."}
          </p>
        ) : (
          <dl className="mt-3">
            {rows.map(([label, value], index) => (
              <div key={label} className={`py-2.5 ${index > 0 ? "border-t hairline" : ""}`}>
                <dt className="text-[13px] text-slate-500">{label}</dt>
                <dd className="break-words text-[16px] font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {documents.map((document, index) => (
        <div key={document.key} className={index > 0 ? "page-break" : ""}>
          <AgreementDocumentCard
            document={document}
            locale={locale}
            marks={marks}
            number={es ? `Documento ${index + 1} de ${documents.length}` : `Document ${index + 1} of ${documents.length}`}
          />
          {document.key === "contract" && (
            <section className="card mt-5 px-5 py-6 sm:px-7">
              <h2 className="text-[19px] font-semibold text-slate-900">{es ? "Junto a la firma" : "Next to the signature"}</h2>
              <div className="mt-3">
                <Blocks blocks={contract.signatureStatements ?? []} marks={marks} locale={locale} />
              </div>
              <p className="mt-5 text-[16px] text-slate-900">
                {es ? "Firma: " : "Signature: "}
                <span className="font-serif text-[20px] italic">{agreement?.signerName ?? "______________________________"}</span>
              </p>
              <p className="mt-1 text-[16px] text-slate-900">
                {es ? "Fecha: " : "Date: "}
                {agreement?.signedAt ? recordMoment(agreement.signedAt, locale) : "______________________________"}
              </p>
            </section>
          )}
        </div>
      ))}

      {/* The second copy of the notice: the law attaches it in duplicate, so one can be sent and one kept. */}
      <div className="page-break">
        <AgreementDocumentCard
          document={notice}
          locale={locale}
          marks={marks}
          number={es ? "Aviso de cancelación · segunda copia" : "Notice of cancellation · second copy"}
        />
      </div>

      <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
        {es ? "Copia generada el " : "Copy generated on "}
        {recordMoment(printedAt, locale)}
      </p>
    </main>
  );
}
