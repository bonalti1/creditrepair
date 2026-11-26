"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AgreementDocumentCard, { Blocks, DraftBanner } from "@/components/agreement/AgreementDocument";
import Icon from "@/components/Icon";
import { cancellationDeadline } from "@/lib/agreement/businessDays";
import { agreementDocuments, type AgreementDocument } from "@/lib/agreement/documents";
import { deadlineMoment, longDate } from "@/lib/agreement/format";
import { agreementPhase, deadlineOf } from "@/lib/agreement/gate";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { isFullName, signerNameMatches } from "@/lib/agreement/signature";
import { resolveTerms, withOption, withPlan } from "@/lib/agreement/terms";
import { mostYoullPay, planSummary } from "@/lib/billing/plans";
import { stateLaw } from "@/lib/compliance/states";
import { SIGNUP_COPY } from "@/lib/signup/copy";
import { useAgreement } from "@/lib/ux/agreementStore";
import { markMilestone } from "@/lib/ux/firstWeek";
import { AltiRun } from "./Bubbles";

// The agreement inside the chat. Not a second agreement: the same documents
// (src/lib/agreement/documents.ts), the same store and endpoints as /acuerdo
// (useAgreement → /api/agreement/acknowledge and /sign), the same server
// checks (readiness, the state's documents, the plan snapshot, the hash of
// what was shown, the name on the account), the same 3-business-day window.
//
//   Sheet 1 of 2  The disclosures, as their own document before the
//                 contract (CROA §1679c(b)): the federal "Consumer Credit File
//                 Rights Under State and Federal Law", the Texas statement and
//                 the consent to electronic records. "I read this" records
//                 the acknowledgement; "I have a question first" closes the
//                 sheet and asks Alti in the chat, then brings the person back
//                 to the same place in the sheet.
//   Sheet 2 of 2  The contract, the authorization and the notice of
//                 cancellation, the statements by the signature, the typed
//                 legal name and the three consents, then "Sign".
//
// Nothing is charged when signing (billing triggers refuse any charge before
// the work, docs/BILLING.md). The per-item attestation is not involved here:
// the client makes it later, item by item, in the review.

export type SheetKind = "rights" | "contract";

const PRIMARY =
  "pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY = "pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200";

function errorText(code: string, locale: "en" | "es", profileName: string | null): string {
  const es = locale === "es";
  switch (code) {
    case "name_invalid":
      return es ? "Escribe tu nombre legal completo: nombre y apellido." : "Type your full legal name: first and last name.";
    case "name_mismatch":
      return es
        ? `El nombre no coincide con el de tu cuenta${profileName ? ` (${profileName})` : ""}. Escríbelo como aparece en tu identificación.`
        : `The name does not match the one on your account${profileName ? ` (${profileName})` : ""}. Type it as it appears on your ID.`;
    case "version_changed":
    case "document_changed":
      return es ? "El texto del acuerdo se actualizó. Vuelve a cargar la página. No se guardó nada." : "The agreement text was updated. Reload the page. Nothing was saved.";
    case "state_not_open":
      return es ? "Todavía no trabajamos en tu estado. No se guardó nada." : "We do not work in your state yet. Nothing was saved.";
    default:
      return es ? "No se pudo guardar. No cambió nada; inténtalo de nuevo en un momento." : "It could not be saved. Nothing changed; please try again in a moment.";
  }
}

function Check({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testId: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700" />
      <span className="min-w-0 text-[15px] leading-snug text-slate-800">{children}</span>
    </label>
  );
}

/** A sheet over the chat: from the bottom on a phone, centred on a wide screen. Escape closes it. */
function Sheet({
  label,
  onClose,
  scrollKey,
  positions,
  children,
  footer,
  closeLabel,
}: {
  label: string;
  onClose: () => void;
  scrollKey: string;
  positions: React.MutableRefObject<Record<string, number>>;
  children: React.ReactNode;
  footer: React.ReactNode;
  closeLabel: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = positions.current[scrollKey] ?? 0;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, positions, scrollKey]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-blue-900/40 sm:items-center sm:p-6" data-testid={`sheet-${scrollKey}`}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="animate-rise flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="flex justify-end px-3 pt-2">
          <button type="button" onClick={onClose} aria-label={closeLabel} className="pressable flex h-11 w-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-200">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div ref={body} onScroll={(e) => (positions.current[scrollKey] = e.currentTarget.scrollTop)} className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 sm:px-6">
          {children}
        </div>
        <div className="border-t hairline bg-white px-4 py-4 sm:px-6">{footer}</div>
      </div>
    </div>
  );
}

function SheetHeader({ step, state, title, lead, locale }: { step: 1 | 2; state: string; title: string; lead: string; locale: "en" | "es" }) {
  const c = SIGNUP_COPY[locale].sheet;
  return (
    <header className="px-1">
      <div className="flex items-center gap-2">
        {[1, 2].map((n) => (
          <span key={n} aria-hidden="true" className={`h-1.5 rounded-full ${n <= step ? "w-8 bg-blue-700" : "w-2 bg-slate-300"}`} />
        ))}
        <span className="ml-1 text-[13px] font-semibold text-slate-600" data-testid="sheet-step">
          {c.stepOf(step, state)}
        </span>
      </div>
      <h2 className="mt-2 font-display text-[26px] font-bold leading-tight text-blue-700">{title}</h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{lead}</p>
    </header>
  );
}

export default function AgreementFlow({
  locale,
  sheet,
  setSheet,
  onAsk,
  onSigned,
  suggestedName,
}: {
  locale: "en" | "es";
  sheet: SheetKind | null;
  setSheet: (s: SheetKind | null) => void;
  /** "I have a question first": back to the chat, to ask Alti. */
  onAsk: () => void;
  onSigned: (summary: { name: string; deadlineIso: string | null }) => void;
  /** The name typed in the chat, to fill in the signature (the person checks it). */
  suggestedName: string;
}) {
  const c = SIGNUP_COPY[locale];
  const es = locale === "es";
  const { agreement, hydrated, signedIn, profileName, mode, plan, stateDocuments, acknowledge, sign, option } = useAgreement();
  // The agreement of the option the person chose in the chat (Credalti Complete or Credalti DIY).
  const terms = useMemo(() => withOption(withPlan(resolveTerms(), plan), option), [plan, option]);
  const readiness = useMemo(() => agreementReadiness({ terms, state: stateDocuments.state }), [terms, stateDocuments.state]);
  const positions = useRef<Record<string, number>>({});
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState(() => (profileName && isFullName(profileName) ? profileName : isFullName(suggestedName) ? suggestedName : ""));
  const [agreeContract, setAgreeContract] = useState(false);
  const [agreeAuthorization, setAgreeAuthorization] = useState(false);
  const [agreeEsign, setAgreeEsign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reported = useRef(false);
  const now = useMemo(() => new Date(), []);

  const phase = hydrated ? agreementPhase(agreement, new Date()) : "none";
  const signed = phase === "in_window" || phase === "active" || phase === "end_requested";

  useEffect(() => {
    if (!hydrated || !signed || reported.current || !agreement) return;
    reported.current = true;
    const deadline = deadlineOf(agreement);
    onSigned({ name: agreement.signerName ?? name, deadlineIso: deadline ? deadline.toISOString() : null });
  }, [hydrated, signed, agreement, name, onSigned]);

  if (!hydrated) return null;
  const stateName = stateLaw(stateDocuments.state)?.name ?? stateDocuments.state;

  if (mode === "blocked") {
    return <AltiRun lines={[stateDocuments.status === "needs_attorney_text" ? c.alti.stateDocs(stateName) : c.alti.notReady]} locale={locale} />;
  }
  if (phase === "cancelled") {
    return (
      <AltiRun lines={[]} locale={locale}>
        <Link href="/acuerdo" className={SECONDARY}>
          {es ? "Ver mi acuerdo" : "See my agreement"}
        </Link>
      </AltiRun>
    );
  }
  if (signed) return null;

  const marks = !readiness.ready;
  const banner = marks || mode === "demo_draft" ? <DraftBanner locale={locale} demo={mode === "demo_draft"} /> : null;
  const documents = agreementDocuments(locale, terms);
  const find = (key: AgreementDocument["key"]) => documents.find((d) => d.key === key)!;
  const disclosed = phase === "disclosed";
  const contract = find("contract");

  const doAcknowledge = async () => {
    if (!consent || busy) return;
    setBusy(true);
    setError(null);
    const result = await acknowledge(locale);
    setBusy(false);
    if (!result.ok) return setError(errorText(result.code, locale, profileName));
    markMilestone("disclosures_acknowledged");
    setSheet("contract");
  };

  const allChecked = agreeContract && agreeAuthorization && agreeEsign;
  const doSign = async () => {
    if (!isFullName(name)) return setError(errorText("name_invalid", locale, profileName));
    if (signedIn && !signerNameMatches(name, profileName)) return setError(errorText("name_mismatch", locale, profileName));
    if (!allChecked || busy) return;
    setBusy(true);
    setError(null);
    const result = await sign(name, locale);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "disclosure_not_acknowledged") setSheet("rights");
      return setError(errorText(result.code, locale, profileName));
    }
    markMilestone("agreement_signed");
    setSheet(null);
  };

  return (
    <>
      {disclosed && <AltiRun lines={[c.alti.acknowledged]} locale={locale} />}
      <AltiRun lines={[]} locale={locale}>
        <button type="button" onClick={() => setSheet(disclosed ? "contract" : "rights")} className={PRIMARY} data-testid={disclosed ? "open-contract" : "open-rights"}>
          {disclosed ? (es ? "Leer y firmar mi contrato" : "Read and sign my contract") : c.plan.continue}
        </button>
      </AltiRun>

      {sheet === "rights" && !disclosed && (
        <Sheet
          label={c.sheet.rightsTitle}
          onClose={() => setSheet(null)}
          scrollKey="rights"
          positions={positions}
          closeLabel={c.sheet.close}
          footer={
            <div>
              <Check checked={consent} onChange={setConsent} testId="sheet-esign">
                {c.sheet.esign}
              </Check>
              {error && (
                <p role="alert" className="mt-1 rounded-2xl bg-red-50 px-4 py-2.5 text-[14px] leading-snug text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                <button type="button" onClick={doAcknowledge} disabled={!consent || busy} className={PRIMARY} data-testid="sheet-read">
                  {c.sheet.read}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSheet(null);
                    onAsk();
                  }}
                  className={`${SECONDARY} h-14`}
                  data-testid="sheet-question"
                >
                  {c.sheet.question}
                </button>
              </div>
              <p className="mt-2 text-center text-[12px] text-slate-500">{c.sheet.recorded}</p>
            </div>
          }
        >
          <SheetHeader step={1} state={stateDocuments.state} title={c.sheet.rightsTitle} lead={c.sheet.rightsLead} locale={locale} />
          {banner}
          {[find("federal_disclosure"), find("texas_disclosure"), find("esign_consent")].map((d, i) => (
            <AgreementDocumentCard key={d.key} document={d} locale={locale} marks={marks} number={es ? `Documento ${i + 1} de 3` : `Document ${i + 1} of 3`} />
          ))}
        </Sheet>
      )}

      {sheet === "contract" && disclosed && (
        <Sheet
          label={c.sheet.contractTitle}
          onClose={() => setSheet(null)}
          scrollKey="contract"
          positions={positions}
          closeLabel={c.sheet.close}
          footer={
            <div>
              {error && (
                <p role="alert" className="mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-[14px] leading-snug text-red-700">
                  {error}
                </p>
              )}
              <button type="button" onClick={doSign} disabled={!allChecked || !isFullName(name) || busy} className={PRIMARY} data-testid="sheet-sign">
                {es ? "Firmar" : "Sign"}
              </button>
              <p className="mt-2 text-center text-[13px] leading-snug text-slate-500">
                {es ? "No se cobra nada al firmar. Tu equipo no empieza ningún trabajo hasta que termine tu plazo para cancelar." : "Nothing is charged when you sign. Your team starts no work until your time to cancel is over."}
              </p>
            </div>
          }
        >
          <SheetHeader step={2} state={stateDocuments.state} title={c.sheet.contractTitle} lead={c.sheet.contractLead} locale={locale} />
          {banner}
          <section className="rounded-3xl bg-blue-700 px-5 py-5 text-white" aria-labelledby="chat-simple">
            <h3 id="chat-simple" data-on-navy className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">
              {es ? "En palabras simples" : "In plain words"}
            </h3>
            <ul className="mt-3 space-y-3 text-[15px] leading-snug text-blue-100">
              <li>
                <strong className="text-white">{es ? "Lo que hace tu equipo. " : "What your team does. "}</strong>
                {es
                  ? "Prepara las cartas sobre lo que tú digas que es inexacto y las envía por correo, en rondas."
                  : "Prepares the letters about what you say is inaccurate and mails them, in rounds."}
              </li>
              <li>
                <strong className="text-white">{es ? "Lo que haces tú. " : "What you do. "}</strong>
                {es ? "Revisas tu reporte y dices qué es inexacto. Solo tú lo decides." : "You review your report and say what is inaccurate. Only you decide."}
              </li>
              <li data-testid="sheet-plan">
                <strong className="text-white">{es ? "Lo que cuesta. " : "What it costs. "}</strong>
                {terms.plan ? `${planSummary(terms.plan, locale)}. ${mostYoullPay(terms.plan, locale)}. ` : ""}
                {es ? "Cada cobro se hace solo después del trabajo que paga." : "Each charge is made only after the work it pays for."}
              </li>
              <li>
                <strong className="text-white">{es ? "Sin garantías. " : "No guarantees. "}</strong>
                {es ? "Nadie puede prometerte un resultado. Los burós deciden." : "Nobody can promise you a result. The bureaus decide."}
              </li>
              <li>
                <strong className="text-white">{es ? "Puedes cancelar sin costo. " : "You can cancel at no cost. "}</strong>
                {es
                  ? `Si firmas hoy, hasta el ${deadlineMoment(cancellationDeadline(now), "es")}. Son 3 días hábiles.`
                  : `If you sign today, until ${deadlineMoment(cancellationDeadline(now), "en")}. That is 3 business days.`}
              </li>
            </ul>
          </section>
          <AgreementDocumentCard document={contract} locale={locale} marks={marks} number={es ? "Documento 1 de 3" : "Document 1 of 3"} />
          <AgreementDocumentCard document={find("authorization")} locale={locale} marks={marks} number={es ? "Documento 2 de 3" : "Document 2 of 3"} />
          <AgreementDocumentCard document={find("cancellation_notice")} locale={locale} marks={marks} number={es ? "Documento 3 de 3 · adjunto al contrato" : "Document 3 of 3 · attached to the contract"} />
          <section className="card px-5 py-5" aria-labelledby="chat-firma" data-testid="sheet-signature">
            <h3 id="chat-firma" className="text-[20px] font-semibold text-slate-900">
              {es ? "Tu firma" : "Your signature"}
            </h3>
            <div className="mt-3 rounded-2xl bg-slate-100 px-4 py-4">
              <Blocks blocks={contract.signatureStatements ?? []} marks={marks} locale={locale} compact />
            </div>
            <label htmlFor="chat-signer-name" className="mt-4 block text-[15px] font-semibold text-slate-900">
              {es ? "Tu nombre legal completo" : "Your full legal name"}
            </label>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
              {es ? "Como aparece en tu identificación. Escribirlo es tu firma." : "As it appears on your ID. Typing it is your signature."}
            </p>
            <input
              id="chat-signer-name"
              data-testid="sheet-signer-name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className="mt-2 h-14 w-full rounded-2xl bg-white px-4 font-serif text-[20px] italic text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.14)] outline-none focus:ring-2 focus:ring-blue-300"
            />
            <p className="mt-2 text-[14px] text-slate-600">
              {es ? "Fecha: " : "Date: "}
              <span className="font-medium text-slate-900">{longDate(now, locale)}</span>
            </p>
            <div className="mt-2 border-t hairline pt-2">
              <Check checked={agreeContract} onChange={setAgreeContract} testId="sheet-agree-contract">
                {es ? "Leí el contrato de servicios y lo acepto." : "I read the service agreement and I accept it."}
              </Check>
              <Check checked={agreeAuthorization} onChange={setAgreeAuthorization} testId="sheet-agree-authorization">
                {es
                  ? "Doy la autorización limitada para que preparen y envíen cartas a mi nombre, solo sobre lo que yo confirme como inexacto."
                  : "I give the limited authorization to prepare and mail letters in my name, only about what I confirm as inaccurate."}
              </Check>
              <Check checked={agreeEsign} onChange={setAgreeEsign} testId="sheet-agree-esign">
                {es ? "Acepto firmar de forma electrónica y recibí el aviso de cancelación adjunto." : "I agree to sign electronically and I received the attached notice of cancellation."}
              </Check>
            </div>
          </section>
          <p className="px-1 text-center text-[14px] text-slate-500">
            <button type="button" onClick={() => setSheet(null)} className="font-medium text-blue-700 underline-offset-2 hover:underline">
              {es ? "Volver al chat" : "Back to the chat"}
            </button>
          </p>
        </Sheet>
      )}
    </>
  );
}
