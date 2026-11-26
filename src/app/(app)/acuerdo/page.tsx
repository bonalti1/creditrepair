"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AgreementDocumentCard, { Blocks, DraftBanner } from "@/components/agreement/AgreementDocument";
import Icon, { type IconName } from "@/components/Icon";
import IdentityDocs from "@/components/IdentityDocs";
import { cancellationDeadline, firstWorkingDay } from "@/lib/agreement/businessDays";
import { agreementDocuments, agreementVersionOf, type AgreementDocument } from "@/lib/agreement/documents";
import OptionNotice from "@/components/service/OptionNotice";
import { optionOfTerms } from "@/lib/service/options";
import { clockTime, deadlineMoment, longDate, recordMoment } from "@/lib/agreement/format";
import { agreementPhase, canCancelWithoutPenalty, deadlineOf } from "@/lib/agreement/gate";
import { agreementReadiness } from "@/lib/agreement/readiness";
import { stateLaw } from "@/lib/compliance/states";
import type { AgreementState } from "@/lib/agreement/record";
import { isFullName, signerNameMatches } from "@/lib/agreement/signature";
import { resolveTerms, withOption, withPlan, type ResolvedTerms } from "@/lib/agreement/terms";
import { mostYoullPay, planSummary } from "@/lib/billing/plans";
import { useClientReport, withReport } from "@/lib/ux/reportStore";
import { useLocale } from "@/lib/i18n";
import { useAgreement, type AgreementActionResult } from "@/lib/ux/agreementStore";
import { useFlags } from "@/lib/ux/flagsStore";
import { humanHelpHref } from "@/lib/ux/humanHelp";
import { nextAction, sessionJourneyState } from "@/lib/ux/journey";
import { markMilestone } from "@/lib/ux/firstWeek";
import FirstWeekProgress from "@/components/FirstWeekProgress";

// "Mi acuerdo": everything the law asks for before any work can begin, as two
// calm steps and one status screen.
//
//   Step 1  The disclosure statements, on their own screen, acknowledged with
//           their own timestamp. Federal law wants them given as a separate
//           document before the contract; the contract is not shown until then.
//   Step 2  The contract and the authorization, with a plain-language summary
//           on top, the full text below, the cancellation statements right by
//           the signature, then a typed legal name and three consents.
//   After   The exact deadline to cancel at no cost, the client's copy, what
//           happens next, and the way out: one tap and a confirmation, always
//           in the same place. No retention screen.
//
// The rules (who may sign, the deadline, whether work may start) live in
// src/lib/agreement; this file only shows them.

const PRIMARY =
  "pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY =
  "pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200";
const SECTION_LABEL = "px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500";

type L = "es" | "en";

function PageTitle({ kicker, title, lead }: { kicker?: string; title: string; lead?: string }) {
  return (
    <header className="px-1">
      {kicker && <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{kicker}</p>}
      <h1 className="mt-1 font-display text-[30px] font-bold leading-tight text-blue-700">{title}</h1>
      {lead && <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{lead}</p>}
    </header>
  );
}

function StepDots({ step, label }: { step: 1 | 2; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1" role="img" aria-label={label}>
      {[1, 2].map((n) => (
        <span key={n} className={`h-1.5 rounded-full ${n <= step ? "w-8 bg-blue-700" : "w-2 bg-slate-300"}`} />
      ))}
      <span className="ml-1 text-[13px] font-medium text-slate-500">{label}</span>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700"
      />
      <span className="min-w-0 text-[15px] leading-snug text-slate-800">{children}</span>
    </label>
  );
}

/** The name to suggest for the signature: the account's, else a full name from the invitation link. */
function prefilledSignerName(profileName: string | null): string {
  if (profileName && isFullName(profileName)) return profileName;
  try {
    const invited = window.localStorage.getItem("bonalti.inviteName");
    return invited && isFullName(invited) ? invited : "";
  } catch {
    return "";
  }
}

function errorText(code: string, locale: L, profileName: string | null): string {
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
      return es
        ? "El texto del acuerdo se actualizó mientras lo leías. Vuelve a cargar la página para leer la versión vigente. No se guardó nada."
        : "The agreement text was updated while you were reading. Reload the page to read the current version. Nothing was saved.";
    case "disclosure_not_acknowledged":
      return es
        ? "Primero hay que confirmar que recibiste la declaración de tus derechos. Te llevamos a ese paso."
        : "The statement of your rights has to be acknowledged first. We are taking you to that step.";
    case "not_signed":
      return es ? "No hay un acuerdo firmado que cancelar." : "There is no signed agreement to cancel.";
    default:
      return es
        ? "No se pudo guardar. No cambió nada; inténtalo de nuevo en un momento."
        : "It could not be saved. Nothing changed; please try again in a moment.";
  }
}

export default function AcuerdoPage() {
  const { locale } = useLocale();
  const { agreement, hydrated, signedIn, profileName, mode, plan, stateDocuments, acknowledge, sign, cancel, option, previous } = useAgreement();
  // Under a plan, the contract's payment terms are generated from it (billing/plans.ts); the option decides
  // which agreement (Credalti Complete or Credalti DIY, docs/SERVICE-OPTIONS.md).
  const terms = useMemo(() => withOption(withPlan(resolveTerms(), plan), option), [plan, option]);
  const previousOption = previous?.signedAt ? optionOfTerms(previous.terms) : null;
  const notice = <OptionNotice option={option} previous={previousOption} locale={locale} />;
  const readiness = useMemo(() => agreementReadiness({ terms, state: stateDocuments.state }), [terms, stateDocuments.state]);
  // A new agreement after a cancellation starts again at step 1.
  const [startOver, setStartOver] = useState(false);
  /** Re-reading the disclosures from step 2: shows step 1 without asking again. */
  const [rereading, setRereading] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [fromOnboarding, setFromOnboarding] = useState(false);

  useEffect(() => {
    setNow(new Date());
    setFromOnboarding(new URLSearchParams(window.location.search).get("desde") === "inicio");
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!hydrated || !now) return null;

  const phase = agreementPhase(agreement, now);
  // The draft markings stay until an attorney approved this version; the banner also covers the demo.
  const marks = !readiness.ready;
  const banner = marks || mode === "demo_draft" ? <DraftBanner locale={locale} demo={mode !== "blocked"} /> : null;

  const goTop = () => window.scrollTo({ top: 0 });

  if (phase === "cancelled" && !startOver) {
    return <Cancelled agreement={agreement!} locale={locale} onStartOver={() => { setStartOver(true); goTop(); }} />;
  }

  if (phase === "in_window" || phase === "active" || phase === "end_requested") {
    return (
      <Signed
        agreement={agreement!}
        locale={locale}
        now={now}
        banner={banner}
        cancel={cancel}
        profileName={profileName}
        fromOnboarding={fromOnboarding}
      />
    );
  }

  // A real database with unapproved text or missing terms: nobody signs.
  if (mode === "blocked") return <NotReady locale={locale} stateNeedsText={stateDocuments.status === "needs_attorney_text" ? stateDocuments.state : null} />;

  const documents = agreementDocuments(locale, terms);
  const find = (key: AgreementDocument["key"]) => documents.find((d) => d.key === key)!;

  if (phase === "none" || startOver || rereading) {
    return (
      <>
      {notice}
      <StepOne
        locale={locale}
        banner={banner}
        marks={marks}
        documents={[find("federal_disclosure"), find("texas_disclosure"), find("esign_consent")]}
        alreadyAcknowledged={rereading}
        onBack={() => { setRereading(false); goTop(); }}
        fromOnboarding={fromOnboarding}
        onAcknowledge={async () => {
          const result = await acknowledge(locale);
          if (result.ok) {
            markMilestone("disclosures_acknowledged");
            setStartOver(false);
            goTop();
          }
          return result;
        }}
        profileName={profileName}
      />
      </>
    );
  }

  return (
    <>
    {notice}
    <StepTwo
      locale={locale}
      banner={banner}
      marks={marks}
      terms={terms}
      now={now}
      contract={find("contract")}
      authorization={find("authorization")}
      notice={find("cancellation_notice")}
      profileName={profileName}
      signedIn={signedIn}
      acknowledgedAt={agreement?.disclosureAcknowledgedAt ?? null}
      onReread={() => { setRereading(true); goTop(); }}
      fromOnboarding={fromOnboarding}
      onSign={async (name) => {
        const result = await sign(name, locale);
        if (result.ok) {
          markMilestone("agreement_signed");
          goTop();
        }
        else if (result.code === "disclosure_not_acknowledged") setStartOver(true);
        return result;
      }}
    />
    </>
  );
}

// ── Step 1: the disclosure statements ───────────────────────────────────

function StepOne({
  locale,
  banner,
  marks,
  documents,
  alreadyAcknowledged,
  onBack,
  onAcknowledge,
  profileName,
  fromOnboarding = false,
}: {
  locale: L;
  banner: React.ReactNode;
  marks: boolean;
  documents: AgreementDocument[];
  alreadyAcknowledged: boolean;
  fromOnboarding?: boolean;
  onBack: () => void;
  onAcknowledge: () => Promise<AgreementActionResult>;
  profileName: string | null;
}) {
  const es = locale === "es";
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!consent || busy) return;
    setBusy(true);
    setError(null);
    const result = await onAcknowledge();
    setBusy(false);
    if (!result.ok) setError(errorText(result.code, locale, profileName));
  };

  return (
    <main className="animate-rise space-y-5" data-testid="agreement-step-1">
      {fromOnboarding && <FirstWeekProgress step="agreement" className="px-1" />}
      <StepDots step={1} label={es ? "Paso 1 de 2" : "Step 1 of 2"} />
      <PageTitle
        title={es ? "Primero, tus derechos" : "First, your rights"}
        lead={
          es
            ? "La ley pide que recibas estas declaraciones antes del contrato y por separado. Léelas con calma. Aquí todavía no firmas ni te comprometes a nada."
            : "The law asks that you receive these statements before the contract, as their own document. Read them calmly. Nothing is signed or agreed to here yet."
        }
      />
      {banner}

      {documents.map((document, index) => (
        <AgreementDocumentCard
          key={document.key}
          document={document}
          locale={locale}
          marks={marks}
          number={es ? `Documento ${index + 1} de ${documents.length}` : `Document ${index + 1} of ${documents.length}`}
        />
      ))}

      {alreadyAcknowledged ? (
        <button type="button" onClick={onBack} className={PRIMARY}>
          {es ? "Volver al contrato" : "Back to the contract"}
        </button>
      ) : (
        <section className="card px-5 py-5">
          <Check checked={consent} onChange={setConsent} testId="esign-consent">
            {es
              ? "Acepto recibir y firmar estos documentos de forma electrónica. Sé que puedo pedir una copia en papel sin costo."
              : "I agree to receive and sign these documents electronically. I know I can ask for a paper copy at no cost."}
          </Check>
          {error && (
            <p role="alert" className="mt-2 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
              {error}
            </p>
          )}
          <button type="button" onClick={submit} disabled={!consent || busy} data-testid="acknowledge" className={`${PRIMARY} mt-3`}>
            {es ? "Lo recibí y lo leí" : "I received it and read it"}
          </button>
          <p className="mt-3 text-center text-[13px] leading-snug text-slate-500">
            {es
              ? "Guardamos la fecha y la hora en que lo confirmas. El contrato viene en el siguiente paso."
              : "The date and time you confirm are recorded. The contract comes in the next step."}
          </p>
        </section>
      )}
    </main>
  );
}

// ── Step 2: the contract, the authorization and the signature ───────────

function SummaryRow({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-semibold text-white">{title}</span>
        <span className="block text-[15px] leading-snug text-blue-100">{children}</span>
      </span>
    </li>
  );
}

function StepTwo({
  locale,
  banner,
  marks,
  terms,
  now,
  contract,
  authorization,
  notice,
  profileName,
  signedIn,
  acknowledgedAt,
  onReread,
  onSign,
  fromOnboarding = false,
}: {
  fromOnboarding?: boolean;
  locale: L;
  banner: React.ReactNode;
  marks: boolean;
  terms: ResolvedTerms;
  now: Date;
  contract: AgreementDocument;
  authorization: AgreementDocument;
  notice: AgreementDocument;
  profileName: string | null;
  signedIn: boolean;
  acknowledgedAt: string | null;
  onReread: () => void;
  onSign: (name: string) => Promise<AgreementActionResult>;
}) {
  const es = locale === "es";
  // Filled in with the name on the account (or a full name from the invitation link), like any
  // e-signature service: the client reads it, can change it, and signing still takes the three
  // consents and the button. The server checks it against the account (signerNameMatches).
  const [suggested] = useState(() => prefilledSignerName(profileName));
  const [name, setName] = useState(suggested);
  const [agreeContract, setAgreeContract] = useState(false);
  const [agreeAuthorization, setAgreeAuthorization] = useState(false);
  const [agreeEsign, setAgreeEsign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the deadline would be if the client signed right now.
  const ifSignedToday = cancellationDeadline(now);
  const fee = terms.monthlyFee
    ? `$${terms.monthlyFee}`
    : es
      ? "[PENDIENTE: cuota mensual]"
      : "[PENDING: monthly fee]";
  const allChecked = agreeContract && agreeAuthorization && agreeEsign;
  const nameOk = isFullName(name);
  const canSubmit = allChecked && nameOk && !busy;

  const submit = async () => {
    if (!nameOk) return setError(errorText("name_invalid", locale, profileName));
    if (signedIn && !signerNameMatches(name, profileName)) return setError(errorText("name_mismatch", locale, profileName));
    if (!allChecked) return;
    setBusy(true);
    setError(null);
    const result = await onSign(name);
    setBusy(false);
    if (!result.ok) setError(errorText(result.code, locale, profileName));
  };

  return (
    <main className="animate-rise space-y-5" data-testid="agreement-step-2">
      {fromOnboarding && <FirstWeekProgress step="agreement" className="px-1" />}
      <StepDots step={2} label={es ? "Paso 2 de 2" : "Step 2 of 2"} />
      <PageTitle
        title={es ? "Tu contrato" : "Your contract"}
        lead={
          es
            ? "Arriba, lo importante en palabras simples. Abajo, el contrato completo: es lo que firmas."
            : "On top, what matters in plain words. Below, the full contract: that is what you sign."
        }
      />
      {banner}

      <section className="rounded-3xl bg-blue-700 px-5 py-6 text-white" aria-labelledby="simple">
        <h2 id="simple" className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">
          {es ? "En palabras simples" : "In plain words"}
        </h2>
        <ul className="mt-4 space-y-4">
          <SummaryRow icon="mail" title={es ? "Lo que hace tu equipo" : "What your team does"}>
            {es
              ? "Importa tu reporte, prepara las cartas sobre lo que tú digas que es inexacto y las envía por correo, en rondas cada 40 días más o menos."
              : "Imports your report, prepares the letters about what you say is inaccurate and mails them, in rounds about every 40 days."}
          </SummaryRow>
          <SummaryRow icon="search" title={es ? "Lo que haces tú" : "What you do"}>
            {es
              ? "Revisas tu reporte y dices qué es inexacto. Solo tú lo decides; nadie del equipo lo decide por ti."
              : "You review your report and say what is inaccurate. Only you decide; nobody on the team decides for you."}
          </SummaryRow>
          <SummaryRow icon="doc" title={es ? "Lo que cuesta" : "What it costs"}>
            {terms.plan ? (
              <span data-testid="plan-summary">
                {planSummary(terms.plan, locale)}. <strong className="font-semibold">{mostYoullPay(terms.plan, locale)}.</strong>{" "}
                {es
                  ? `Cada cobro se hace solo después del trabajo que paga. Aparte pagas tu monitoreo de crédito (${terms.monitoringPriceLabel} al mes) directamente a quien lo ofrece.`
                  : `Each charge is made only after the work it pays for. Separately you pay for your credit monitoring (${terms.monitoringPriceLabel} a month), directly to its provider.`}
              </span>
            ) : es
              ? `${fee} al mes, y solo se cobra después de hecho el trabajo de ese mes. Aparte pagas tu monitoreo de crédito (${terms.monitoringPriceLabel} al mes) directamente a quien lo ofrece.`
              : `${fee} a month, charged only after that month's work is done. Separately you pay for your credit monitoring (${terms.monitoringPriceLabel} a month), directly to its provider.`}
          </SummaryRow>
          <SummaryRow icon="clipboard" title={es ? "Sin garantías" : "No guarantees"}>
            {es
              ? "Nadie puede prometerte un resultado. Los burós deciden cómo responden, y lo que es exacto se queda en tu reporte."
              : "Nobody can promise you a result. The bureaus decide how they respond, and what is accurate stays on your report."}
          </SummaryRow>
          <SummaryRow icon="clock" title={es ? "Puedes cancelar sin costo" : "You can cancel at no cost"}>
            {es
              ? `Si firmas hoy, hasta el ${deadlineMoment(ifSignedToday, "es")}. Son 3 días hábiles. Después puedes terminar el servicio cuando quieras.`
              : `If you sign today, until ${deadlineMoment(ifSignedToday, "en")}. That is 3 business days. After that you can end the service whenever you want.`}
          </SummaryRow>
        </ul>
      </section>

      <AgreementDocumentCard document={contract} locale={locale} marks={marks} number={es ? "Documento 1 de 3" : "Document 1 of 3"} />
      <AgreementDocumentCard document={authorization} locale={locale} marks={marks} number={es ? "Documento 2 de 3" : "Document 2 of 3"} />
      <AgreementDocumentCard
        document={notice}
        locale={locale}
        marks={marks}
        number={es ? "Documento 3 de 3 · adjunto al contrato" : "Document 3 of 3 · attached to the contract"}
      />

      <section className="card px-5 py-6 sm:px-7" aria-labelledby="firma" data-testid="signature-block">
        <h2 id="firma" className="text-[22px] font-semibold leading-tight text-slate-900">
          {es ? "Tu firma" : "Your signature"}
        </h2>

        {/* The law puts these statements in bold, right next to the signature. */}
        <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-4" data-testid="signature-statements">
          <Blocks blocks={contract.signatureStatements ?? []} marks={marks} locale={locale} compact />
        </div>

        <label htmlFor="signer-name" className="mt-5 block text-[15px] font-semibold text-slate-900">
          {es ? "Tu nombre legal completo" : "Your full legal name"}
        </label>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
          {suggested && name === suggested
            ? es
              ? "Lo llenamos con el nombre que nos diste. Revisa que esté como en tu identificación. Este nombre es tu firma."
              : "We filled in the name you gave us. Check that it matches your ID. This name is your signature."
            : es
              ? "Como aparece en tu identificación. Escribirlo es tu firma."
              : "As it appears on your ID. Typing it is your signature."}
        </p>
        <input
          id="signer-name"
          data-testid="signer-name"
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

        <div className="mt-3 border-t hairline pt-2">
          <Check checked={agreeContract} onChange={setAgreeContract} testId="agree-contract">
            {es ? "Leí el contrato de servicios y lo acepto." : "I read the service agreement and I accept it."}
          </Check>
          <Check checked={agreeAuthorization} onChange={setAgreeAuthorization} testId="agree-authorization">
            {es
              ? "Doy la autorización limitada para que preparen y envíen cartas a mi nombre, solo sobre lo que yo confirme como inexacto."
              : "I give the limited authorization to prepare and mail letters in my name, only about what I confirm as inaccurate."}
          </Check>
          <Check checked={agreeEsign} onChange={setAgreeEsign} testId="agree-esign">
            {es
              ? "Acepto firmar de forma electrónica y recibí el aviso de cancelación adjunto."
              : "I agree to sign electronically and I received the attached notice of cancellation."}
          </Check>
        </div>

        {error && (
          <p role="alert" className="mt-2 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
            {error}
          </p>
        )}
        <button type="button" onClick={submit} disabled={!canSubmit} data-testid="sign" className={`${PRIMARY} mt-4`}>
          {es ? "Firmar" : "Sign"}
        </button>
        <p className="mt-3 text-center text-[13px] leading-snug text-slate-500">
          {es
            ? "No se cobra nada al firmar. Tu equipo no empieza ningún trabajo hasta que termine tu plazo para cancelar."
            : "Nothing is charged when you sign. Your team starts no work until your time to cancel is over."}
        </p>
      </section>

      <p className="px-1 text-center text-[14px] leading-relaxed text-slate-500">
        {acknowledgedAt &&
          (es
            ? `Confirmaste que recibiste tus derechos el ${recordMoment(acknowledgedAt, "es")}. `
            : `You confirmed receiving your rights on ${recordMoment(acknowledgedAt, "en")}. `)}
        <button type="button" onClick={onReread} className="font-medium text-blue-700 underline-offset-2 hover:underline">
          {es ? "Volver a leerlos" : "Read them again"}
        </button>
        {" · "}
        <Link href="/acuerdo/copia" className="font-medium text-blue-700 underline-offset-2 hover:underline">
          {es ? "Imprimir todo antes de firmar" : "Print everything before signing"}
        </Link>
      </p>
    </main>
  );
}

// ── After signing ───────────────────────────────────────────────────────

function Signed({
  agreement,
  locale,
  now,
  banner,
  cancel,
  profileName,
  fromOnboarding,
}: {
  agreement: AgreementState;
  locale: L;
  now: Date;
  banner: React.ReactNode;
  cancel: (reason?: string) => Promise<AgreementActionResult>;
  profileName: string | null;
  fromOnboarding: boolean;
}) {
  const es = locale === "es";
  const { flags, roundApproved, hydrated } = useFlags();
  // The sample report in the demo; the client's own with a database (lib/ux/reportStore.ts).
  const view = useClientReport();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deadline = deadlineOf(agreement);
  const inWindow = canCancelWithoutPenalty(agreement, now);
  const starts = deadline ? firstWorkingDay(deadline) : null;
  const endRequested = Boolean(agreement.serviceEndRequestedAt);

  // The same next step Home shows, once the agreement is out of the way.
  const step = hydrated && view.ready ? nextAction(withReport(sessionJourneyState(view.items, flags, roundApproved, agreement), view), locale, { now }) : null;
  const next = fromOnboarding
    ? { href: "/onboarding?paso=monitoreo", label: es ? "Continuar: mi monitoreo de crédito" : "Continue: my credit monitoring" }
    : step && step.href !== "/acuerdo"
      ? { href: step.href, label: step.cta }
      : { href: "/dashboard", label: es ? "Ir al inicio" : "Go to Home" };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await cancel(inWindow ? undefined : reason);
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      window.scrollTo({ top: 0 });
    } else {
      setError(errorText(result.code, locale, profileName));
    }
  };

  return (
    <main className="animate-rise space-y-5" data-testid="agreement-signed">
      <header className="px-1 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-green-700">
          <Icon name="check" size={32} strokeWidth={2.5} />
        </span>
        <h1 className="mt-4 font-display text-[30px] font-bold leading-tight text-blue-700">
          {es ? "Tu acuerdo está firmado" : "Your agreement is signed"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-slate-600">
          {es ? "Firmado por " : "Signed by "}
          <span className="font-medium text-slate-900">{agreement.signerName}</span>
          {es ? " el " : " on "}
          {agreement.signedAt ? recordMoment(agreement.signedAt, locale) : ""}.
        </p>
      </header>
      {banner}

      {endRequested && (
        <section className="card px-5 py-5" data-testid="end-requested">
          <h2 className="text-[19px] font-semibold text-slate-900">
            {es ? "Recibimos tu solicitud para terminar el servicio" : "Your request to end the service was received"}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
            {es
              ? `La enviaste el ${recordMoment(agreement.serviceEndRequestedAt!, "es")}. No se envía nada más. Una persona del equipo te va a escribir para confirmarlo; no tienes que hacer nada.`
              : `You sent it on ${recordMoment(agreement.serviceEndRequestedAt!, "en")}. Nothing more is sent. A person on the team will write to you to confirm it; there is nothing you need to do.`}
          </p>
        </section>
      )}

      {inWindow && deadline && (
        <section className="card px-5 py-5" data-testid="cancel-window">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {es ? "Puedes cancelar sin costo hasta" : "You can cancel at no cost until"}
          </p>
          <p className="mt-1.5 text-[22px] font-semibold leading-snug text-slate-900" data-testid="deadline">
            {longDate(deadline, locale)}
          </p>
          <p className="text-[17px] text-slate-700" data-testid="deadline-time">
            {es ? `a las ${clockTime(deadline, "es")} (hora de Texas)` : `at ${clockTime(deadline, "en")} (Texas time)`}
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            {es
              ? "Son 3 días hábiles: no cuentan sábados, domingos ni días feriados. Si cancelas antes de esa hora no debes nada y no tienes que explicar por qué."
              : "That is 3 business days: Saturdays, Sundays and holidays do not count. If you cancel before that time you owe nothing and need not say why."}
          </p>
        </section>
      )}

      {!endRequested && (
        <section aria-labelledby="sigue">
          <h2 id="sigue" className={SECTION_LABEL}>
            {es ? "Qué sigue" : "What happens next"}
          </h2>
          <ol className="card overflow-hidden">
            <li className="flex gap-3.5 px-5 py-4">
              <StepNumber n={1} />
              <span className="min-w-0">
                <span className="block text-[17px] font-medium text-slate-900">{es ? "Tus documentos" : "Your documents"}</span>
                <span className="block text-[14px] leading-snug text-slate-500">
                  {es
                    ? "Una foto de tu identificación y de un comprobante de domicilio. Van dentro de cada carta."
                    : "A photo of your ID and of a proof of address. They go inside every letter."}
                </span>
              </span>
            </li>
            <li className="flex gap-3.5 border-t hairline px-5 py-4">
              <StepNumber n={2} />
              <span className="min-w-0">
                <span className="block text-[17px] font-medium text-slate-900">{es ? "Tu reporte y tu revisión" : "Your report and your review"}</span>
                <span className="block text-[14px] leading-snug text-slate-500">
                  {es
                    ? "Con tu monitoreo activo se importa tu reporte, y tú dices qué es inexacto."
                    : "With your monitoring active your report is imported, and you say what is inaccurate."}
                </span>
              </span>
            </li>
            <li className="flex gap-3.5 border-t hairline px-5 py-4">
              <StepNumber n={3} />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-medium text-slate-900" data-testid="team-starts">
                  {inWindow && starts
                    ? es
                      ? `Tu equipo empieza el ${longDate(starts, "es")}`
                      : `Your team starts on ${longDate(starts, "en")}`
                    : es
                      ? "Tu equipo ya puede trabajar"
                      : "Your team can now work"}
                </span>
                <span className="block text-[14px] leading-snug text-slate-500">
                  {inWindow
                    ? es
                      ? "Es el primer día hábil después de tu plazo para cancelar. La ley no permite empezar antes. Desde entonces prepara y envía tus cartas."
                      : "That is the first business day after your time to cancel. The law does not allow starting sooner. From then on it prepares and mails your letters."
                    : es
                      ? "Tu plazo para cancelar sin costo ya terminó. Tu equipo prepara y envía tus cartas sobre lo que tú confirmes."
                      : "Your time to cancel at no cost is over. Your team prepares and mails your letters about what you confirm."}
                </span>
              </span>
              {/* The mailing step: an envelope, no character (the team prepares, the letters are mailed). */}
              <span className="flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-full bg-blue-50 text-blue-700">
                <Icon name="mail" size={22} />
              </span>
            </li>
          </ol>
        </section>
      )}

      {!endRequested && <IdentityDocs />}

      <div className="space-y-3">
        <Link href={next.href} className={PRIMARY} data-testid="agreement-next">
          {next.label}
        </Link>
        <Link href="/acuerdo/copia" className={SECONDARY} data-testid="agreement-copy">
          <Icon name="doc" size={18} className="mr-2" />
          {es ? "Ver o imprimir mi copia" : "See or print my copy"}
        </Link>
      </div>

      {/* The way out. Always here, always the same two taps. */}
      {!endRequested && (
        <section className="card px-5 py-5" aria-labelledby="salir" data-testid="cancel-section">
          <h2 id="salir" className="text-[19px] font-semibold text-slate-900">
            {inWindow ? (es ? "Cancelar mi acuerdo" : "Cancel my agreement") : es ? "Terminar el servicio" : "End the service"}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
            {inWindow
              ? es
                ? "Se cancela en el momento. No se te cobra nada y no se envía ninguna carta."
                : "It is cancelled at once. Nothing is charged and no letter is sent."
              : es
                ? "Puedes terminar cuando quieras, sin costo por terminar. Tu equipo deja de enviar cartas y una persona te confirma por escrito."
                : "You can end it whenever you want, at no cost for ending. Your team stops sending letters and a person confirms it to you in writing."}
          </p>

          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} data-testid="cancel-open" className={`${SECONDARY} mt-4`}>
              {inWindow ? (es ? "Cancelar sin costo" : "Cancel at no cost") : es ? "Terminar el servicio" : "End the service"}
            </button>
          ) : (
            <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-4" data-testid="cancel-confirm">
              <p className="text-[16px] font-semibold text-slate-900">
                {inWindow
                  ? es
                    ? "¿Cancelar tu acuerdo ahora?"
                    : "Cancel your agreement now?"
                  : es
                    ? "¿Pedir que termine tu servicio?"
                    : "Ask for your service to end?"}
              </p>
              {!inWindow && (
                <>
                  <label htmlFor="end-reason" className="mt-3 block text-[14px] text-slate-600">
                    {es ? "Si quieres, cuéntanos por qué (opcional)" : "If you like, tell us why (optional)"}
                  </label>
                  <textarea
                    id="end-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                    rows={3}
                    className="mt-1.5 w-full rounded-2xl bg-white px-4 py-3 text-[16px] text-slate-900 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </>
              )}
              {error && (
                <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
                  {error}
                </p>
              )}
              <div className="mt-4 grid gap-2.5">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  data-testid="cancel-confirm-yes"
                  className="pressable flex h-12 w-full items-center justify-center rounded-full bg-blue-700 px-5 text-[16px] font-semibold text-white hover:bg-blue-800 disabled:bg-slate-300"
                >
                  {inWindow ? (es ? "Sí, cancelar mi acuerdo" : "Yes, cancel my agreement") : es ? "Sí, terminar el servicio" : "Yes, end the service"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                  className="pressable flex h-12 w-full items-center justify-center rounded-full bg-white px-5 text-[16px] font-medium text-slate-900"
                >
                  {es ? "No, volver" : "No, go back"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <p className="px-1 text-center text-xs leading-relaxed text-slate-500">
        {es ? "Versión del acuerdo: " : "Agreement version: "}
        {agreement.version ?? agreementVersionOf(agreement.terms ?? resolveTerms())}
        {agreement.documentHash && (
          <>
            {" · "}
            {es ? "huella " : "fingerprint "}
            <span className="font-mono">{agreement.documentHash.slice(0, 12)}</span>
          </>
        )}
      </p>
    </main>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[14px] font-semibold text-blue-700">
      {n}
    </span>
  );
}

// ── Cancelled ───────────────────────────────────────────────────────────

function Cancelled({ agreement, locale, onStartOver }: { agreement: AgreementState; locale: L; onStartOver: () => void }) {
  const es = locale === "es";
  return (
    <main className="animate-rise space-y-5" data-testid="agreement-cancelled">
      <PageTitle
        title={es ? "Cancelaste tu acuerdo" : "You cancelled your agreement"}
        lead={
          es
            ? `Quedó cancelado el ${agreement.cancelledAt ? recordMoment(agreement.cancelledAt, "es") : ""}${
                agreement.cancelledWithinWindow ? ", dentro de tu plazo de 3 días hábiles" : ""
              }.`
            : `It was cancelled on ${agreement.cancelledAt ? recordMoment(agreement.cancelledAt, "en") : ""}${
                agreement.cancelledWithinWindow ? ", inside your 3 business days" : ""
              }.`
        }
      />
      <section className="card overflow-hidden">
        {[
          es ? "No debes nada." : "You owe nothing.",
          es ? "No se prepara ni se envía ninguna carta." : "No letter is prepared or sent.",
          es ? "Tu copia del acuerdo y de la cancelación sigue disponible." : "Your copy of the agreement and of the cancellation stays available.",
        ].map((line, index) => (
          <p key={line} className={`flex items-start gap-3 px-5 py-4 text-[16px] text-slate-800 ${index > 0 ? "border-t hairline" : ""}`}>
            <Icon name="check" size={20} className="mt-0.5 shrink-0 text-green-600" strokeWidth={2.25} />
            {line}
          </p>
        ))}
      </section>
      <div className="space-y-3">
        <Link href="/acuerdo/copia" className={SECONDARY}>
          <Icon name="doc" size={18} className="mr-2" />
          {es ? "Ver o imprimir mi copia" : "See or print my copy"}
        </Link>
        <Link href="/dashboard" className={SECONDARY}>
          {es ? "Ir al inicio" : "Go to Home"}
        </Link>
      </div>
      <p className="px-1 text-center text-[14px] leading-relaxed text-slate-500">
        {es ? "Si más adelante quieres volver, puedes " : "If you want to come back later, you can "}
        <button type="button" onClick={onStartOver} data-testid="start-over" className="font-medium text-blue-700 underline-offset-2 hover:underline">
          {es ? "leer y firmar un acuerdo nuevo" : "read and sign a new agreement"}
        </button>
        .
      </p>
    </main>
  );
}

// ── Not ready (a real account, and the text is not approved yet) ────────

function NotReady({ locale, stateNeedsText = null }: { locale: L; stateNeedsText?: string | null }) {
  const es = locale === "es";
  const help = humanHelpHref(locale);
  const stateName = stateNeedsText ? (stateLaw(stateNeedsText)?.name ?? stateNeedsText) : null;
  return (
    <main className="animate-rise space-y-5" data-testid="agreement-not-ready">
      <PageTitle
        title={stateName ? (es ? `Tu acuerdo para ${stateName} se está preparando` : `Your agreement for ${stateName} is being prepared`) : es ? "Estamos terminando tu acuerdo" : "We are finishing your agreement"}
        lead={
          stateName
            ? es
              ? `Cada estado pide sus propios documentos. El abogado está escribiendo los de ${stateName}; en cuanto estén aprobados, una persona de nuestro equipo te escribe para que lo leas y lo firmes con calma.`
              : `Each state asks for its own documents. Our attorney is writing the ones for ${stateName}; once they are approved, a person on our team will write to you so you can read and sign it calmly.`
            : es
              ? "Tu acuerdo de servicio está en su última revisión. En cuanto esté listo, una persona de nuestro equipo te va a escribir para que lo leas y lo firmes con calma."
              : "Your service agreement is in its final review. As soon as it is ready, a person on our team will write to you so you can read and sign it calmly."
        }
      />
      <section className="card overflow-hidden">
        {[
          es ? "No tienes que hacer nada por ahora." : "There is nothing you need to do for now.",
          es ? "No se cobra nada hasta que firmes." : "Nothing is charged until you sign.",
          es ? "No se hace ningún trabajo ni se envía ninguna carta antes de tu firma." : "No work is done and no letter is sent before you sign.",
        ].map((line, index) => (
          <p key={line} className={`flex items-start gap-3 px-5 py-4 text-[16px] text-slate-800 ${index > 0 ? "border-t hairline" : ""}`}>
            <Icon name="check" size={20} className="mt-0.5 shrink-0 text-green-600" strokeWidth={2.25} />
            {line}
          </p>
        ))}
      </section>
      {help && (
        <a href={help} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
          <span className="-ml-2 mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
            <Icon name="person" size={16} strokeWidth={2.25} />
          </span>
          {es ? "Hablar con una persona" : "Talk to a person"}
        </a>
      )}
      <Link href="/dashboard" className={SECONDARY}>
        {es ? "Ir al inicio" : "Go to Home"}
      </Link>
    </main>
  );
}
