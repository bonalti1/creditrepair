"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import {
  authorizationFee,
  paymentAuthorization,
  paymentAuthorizationHash,
  type PaymentAuthorization,
} from "@/lib/billing/authorization";
import { chargeStanding, type ChargeStanding } from "@/lib/billing/dunning";
import { achAuthorization } from "@/lib/billing/achAuthorization";
import { DEMO_BANK_TOKEN_OK, DEMO_BANK_TOKEN_RETURNS, DEMO_TOKEN_OK } from "@/lib/billing/gateway";
import { collectedCents, invoiceNumber, invoiceStatus, statementMonths, type InvoiceStatus } from "@/lib/billing/invoices";
import { mostYoullPay, periodTiming, planSummary, PLAN_TYPE_LABEL } from "@/lib/billing/plans";
import { chargedTowardCap } from "@/lib/billing/rules";
import { unitWork } from "@/lib/billing/schedule";
import HostedFields from "@/components/billing/HostedFields";
import { acceptedCardsLine, brandFromIin, cardBrandMessage, CARD_BRAND_NAME, normalizeBrand } from "@/lib/billing/cardBrands";
import { TEST_CARDS, testCardBrand, testCardLine } from "@/lib/ux/testCards";
import { PLAN_COPY } from "@/lib/ux/billingPlanCopy";
import { useServiceOption } from "@/lib/service/useServiceOption";
import { billingOutlook } from "@/lib/billing/outlook";
import { receiptFor, workLine, workLineWithoutLetters, type Receipt } from "@/lib/billing/receipts";
import { billingDate, billingDay, formatCents } from "@/lib/billing/rules";
import type { BillingCharge } from "@/lib/billing/types";
import { PLACEHOLDER_PATTERN } from "@/lib/agreement/terms";
import { BRAND } from "@/lib/brand";
import { useLocale } from "@/lib/i18n";
import { BILLING_COPY } from "@/lib/ux/billingCopy";
import { DEMO_SCENARIO_LABEL, DEMO_SCENARIOS } from "@/lib/ux/billingDemo";
import { useBilling, type BillingActionResult } from "@/lib/ux/billingStore";
import { humanHelpHref } from "@/lib/ux/humanHelp";

// "Mis pagos": what was charged and for which work, the receipts, what will be
// charged next and when, the payment method on file, the recurring
// authorization, and the way out.
//
// The screen decides nothing. Every sentence about money comes from the same
// rules that charge (src/lib/billing): what is shown as "next" is what the
// system would do. Card numbers are never typed into this app: the form has a
// marked place for the payment processor's own secure fields, and in the demo
// it offers two labelled test cards instead.

type L = "es" | "en";

const PRIMARY =
  "pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY =
  "pressable flex h-12 w-full items-center justify-center rounded-full bg-slate-100 px-5 text-[16px] font-semibold text-slate-900 hover:bg-slate-200";
const SECTION_LABEL = "px-1 pb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500";
const TEXT_LINK = "text-[15px] font-medium text-blue-700 underline-offset-2 hover:underline";

const STATUS_TONE: Record<ChargeStanding, string> = {
  paid: "bg-green-50 text-green-700",
  refunded: "bg-slate-100 text-slate-600",
  processing: "bg-blue-50 text-blue-700",
  retrying: "bg-amber-100 text-blue-900",
  exhausted: "bg-amber-100 text-blue-900",
};

/** "Visa ···· 4242". */
function cardLabel(brand: string, last4: string): string {
  const name = brand.replace(/_/g, " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ···· ${last4}`;
}

function errorText(code: string, locale: L): string {
  const e = BILLING_COPY[locale].errors;
  switch (code) {
    case "payment_method_refused":
      return e.refused;
    case "card_brand_not_accepted":
      return e.brand;
    case "authorization_changed":
      return e.changed;
    case "agreement_required":
      return e.agreement;
    case "gateway_not_configured":
    case "authorization_not_ready":
      return e.unavailable;
    default:
      return e.generic;
  }
}

/** A business fact the owner has not filled in yet shows as a gold placeholder, as in the agreement. */
function withPlaceholders(text: string) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <mark key={at} className="rounded bg-amber-100 px-0.5 font-medium text-blue-900">
        {match[0]}
      </mark>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The authorization, set for reading: a lead-in, then each point with its heading. */
function AuthorizationText({ authorization }: { authorization: PaymentAuthorization }) {
  return (
    <div data-testid="authorization-text">
      <p className="text-[15px] leading-relaxed text-slate-800">{authorization.intro}</p>
      <dl className="mt-3 space-y-3">
        {authorization.points.map((point) => (
          <div key={point.heading}>
            <dt className="text-[15px] font-semibold text-slate-900">{point.heading}</dt>
            <dd className="break-words text-[15px] leading-relaxed text-slate-700">{withPlaceholders(point.text)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const INVOICE_TONE: Record<InvoiceStatus, string> = {
  paid: "bg-green-50 text-green-700",
  processing: "bg-blue-50 text-blue-700",
  failed: "bg-amber-100 text-blue-900",
  refunded: "bg-slate-100 text-slate-600",
  voided: "bg-slate-100 text-slate-600",
  disputed: "bg-slate-100 text-slate-700",
};

/** The receipt as an invoice: its number, the date, the amount, exactly which work it paid for, and its status. */
function ReceiptView({ receipt, charge, locale, showAmount, company, planName }: { receipt: Receipt; charge: BillingCharge; locale: L; showAmount: boolean; company: string; planName: string | null }) {
  const c = BILLING_COPY[locale];
  const p = PLAN_COPY[locale];
  const status = invoiceStatus(charge);
  const credit = charge.creditCents ?? 0;
  const work = charge.unit && charge.unit !== "round" ? unitWork(charge, locale) : receipt.work[locale];
  const rows: Array<[string, string]> = [
    [c.receiptDate, receipt.date[locale]],
    ...(showAmount ? ([[c.receiptAmount, formatCents(charge.amountCents)]] as Array<[string, string]>) : []),
    ...(showAmount && credit > 0 ? ([[p.invoiceCredit, `−${formatCents(credit)}`], [p.invoiceTotal, formatCents(collectedCents(charge))]] as Array<[string, string]>) : []),
    [c.receiptWork, work],
    ...(planName ? ([[p.invoicePlan, planName]] as Array<[string, string]>) : []),
    [c.receiptFrom, company],
  ];
  return (
    <div data-testid="receipt">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-semibold text-slate-900">
          {p.invoice} <span className="font-mono">{invoiceNumber(charge)}</span>
        </p>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${INVOICE_TONE[status]}`}>{p.status[status]}</span>
      </div>
      <dl className="mt-1.5 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-slate-500">{label}</dt>
            <dd className="break-words text-[15px] leading-snug text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {receipt.refundedAt && <p className="mt-2 text-[14px] font-medium text-slate-700">{c.refundedOn(billingDate(receipt.refundedAt, locale))}</p>}
    </div>
  );
}

export default function PagosPage() {
  const { locale } = useLocale();
  const c = BILLING_COPY[locale];
  const { view, hydrated, addMethod, removeMethod, setScenario } = useBilling();
  // The client's option (docs/SERVICE-OPTIONS.md): Credalti DIY is a subscription, not paid per round of work.
  const { option } = useServiceOption();
  const [now, setNow] = useState<Date | null>(null);
  const [adding, setAdding] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [token, setToken] = useState(DEMO_TOKEN_OK);
  /** Card or bank account (ACH): the authorization shown and the processor's fields follow it. */
  const [kind, setKind] = useState<"card" | "ach">("card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A card brand the business does not take, said before the card is sent (billing/cardBrands.ts). */
  const [hostedBrand, setHostedBrand] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);
  /** What the browser's print dialog gets: one receipt, or the authorization. */
  const [printing, setPrinting] = useState<{ kind: "receipt"; id: string } | { kind: "authorization" } | null>(null);
  const methodRef = useRef<HTMLElement | null>(null);

  useEffect(() => setNow(new Date()), [view]);
  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => window.print(), 60);
    return () => window.clearTimeout(timer);
  }, [printing]);

  const authorization = useMemo(
    () => (view ? paymentAuthorization(locale, view.authorizationTerms) : null),
    [locale, view],
  );
  const ach = useMemo(() => (view ? achAuthorization(locale, view.authorizationTerms) : null), [locale, view]);

  if (!hydrated || !now || !view || !authorization) return null;

  const { context, showAmounts } = view;
  const { account } = context;
  const outlook = billingOutlook(context, now, { amounts: showAmounts });
  const rounds = new Map(context.rounds.map((round) => [round.number, round]));
  const charges = [...account.charges].sort((a, b) => b.workDate.localeCompare(a.workDate));
  const fee = showAmounts ? authorizationFee({ ...view.authorizationTerms, monthlyFee: context.signedMonthlyFee ?? view.authorizationTerms.monthlyFee }) : null;
  const failed = outlook.kind === "paused_for_payment" || outlook.kind === "retry_scheduled" || outlook.kind === "payment_method_missing";
  const company = view.authorizationTerms.companyLegalName ?? BRAND.name;
  const helpHref = humanHelpHref(locale);
  // A real processor's own hosted fields are mounted in the marked place below by its adapter
  // (docs/BILLING.md). Until one exists, only the demo processor's test cards can be put on file.
  const canAdd = view.canAddMethod && (view.simulated || view.hostedFields !== null);
  const plan = context.plan ?? null;
  const p = PLAN_COPY[locale];
  // Credalti DIY (docs/SERVICE-OPTIONS.md): a subscription from the end of the window; mailings are separate from its cap.
  const isDiyPlan = plan ? plan.terms.type === "diy_subscription" : option === "diy";
  const towardCap = isDiyPlan ? account.charges.filter((ch) => ch.unit === "diy_period") : account.charges;
  const statements = statementMonths(context, now, locale);
  const shownAuthorization = kind === "ach" && ach ? ach : authorization;
  const amountOf = (charge: BillingCharge) => (showAmounts ? formatCents(charge.amountCents) : c.feeOfAgreement);
  const work = (charge: BillingCharge) => {
    if (charge.unit && charge.unit !== "round") return unitWork(charge, locale);
    const round = rounds.get(charge.roundNumber);
    return (round ? workLine(round, charge.workDate) : workLineWithoutLetters(charge.roundNumber, charge.workDate))[locale];
  };
  const receiptOf = (charge: BillingCharge) => receiptFor(charge, rounds.get(charge.roundNumber));
  const printedReceipt = printing?.kind === "receipt" ? charges.map(receiptOf).find((r) => r?.chargeId === printing.id) ?? null : null;

  const openForm = () => {
    setAdding(true);
    setAccepted(false);
    setError(null);
    setNotice(null);
    setRemoving(false);
    window.setTimeout(() => methodRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  // The brand of the card about to be sent: the test card's IIN in the demo, or what the
  // processor's hosted fields reported with the token. A brand that is off is said now, before sending.
  const selectedTestCard = TEST_CARDS.find((card) => card.token === token) ?? null;
  const pendingBrand = kind !== "card" ? null : view.simulated ? (selectedTestCard ? testCardBrand(selectedTestCard) : null) : hostedBrand;
  const brandWarning = cardBrandMessage(pendingBrand, view.acceptedCards, locale);

  const save = async () => {
    if (!accepted || busy || brandWarning) return;
    setBusy(true);
    setError(null);
    const result: BillingActionResult = await addMethod(token, locale, kind);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.code, locale));
      return;
    }
    setAdding(false);
    setNotice(result.settled > 0 ? c.formSettled : result.declined > 0 ? c.formStillDeclined : c.formSaved);
  };

  const remove = async () => {
    setBusy(true);
    const result = await removeMethod();
    setBusy(false);
    setRemoving(false);
    if (!result.ok) setError(errorText(result.code, locale));
  };

  const detail = (charge: BillingCharge): string => {
    const standing = chargeStanding(charge);
    if (standing === "refunded") return c.refundedOn(billingDay(charge.refund?.completedAt ?? charge.refund?.at ?? charge.chargedAt!, locale));
    if (standing === "paid") return c.paidOn(billingDay(charge.chargedAt!, locale));
    if (standing === "retrying") return c.retryOn(billingDay(charge.nextAttemptAt!, locale));
    if (standing === "exhausted") return c.noMoreRetries;
    return c.status.processing;
  };

  return (
    <main className="animate-rise space-y-5" data-testid="pagos">
      {/* Printing puts one receipt, or the authorization, on the paper and nothing else. */}
      <style>{`
        .print-only { display: none; }
        @media print {
          header, nav, .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-only { display: block !important; }
        }
      `}</style>

      <div className="no-print space-y-5">
        <Link href="/mas" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
          <Icon name="chevron" size={16} className="rotate-180" />
          {locale === "es" ? "Más" : "More"}
        </Link>

        <header className="px-1">
          <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
          <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{isDiyPlan ? p.diyLead : c.lead}</p>
        </header>

        {(view.demo || view.simulated) && (
          <p role="note" data-testid="demo-banner" className="rounded-2xl bg-amber-100 px-4 py-3 text-[14px] leading-snug text-blue-900">
            {c.demoBanner}
          </p>
        )}
        {view.demo && view.scenario !== "live" && (
          <p role="note" data-testid="example-banner" className="rounded-2xl bg-slate-100 px-4 py-3 text-[14px] leading-snug text-slate-700">
            {c.exampleBanner}
          </p>
        )}

        {/* A payment that did not go through: said calmly, with the way to fix it. */}
        {failed && (
          <section className="card px-5 py-5" data-testid="payment-notice" aria-labelledby="aviso-pago">
            <h2 id="aviso-pago" className="text-[19px] font-semibold text-slate-900">
              {outlook.kind === "payment_method_missing" && !account.charges.some((ch) => ch.status === "failed") ? c.methodTitle : c.failedTitle}
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-slate-700">{outlook.client[locale]}</p>
            {canAdd && view.agreementSigned && (
              <button type="button" onClick={openForm} data-testid="fix-payment" className={`${PRIMARY} mt-4`}>
                {account.paymentMethod ? c.failedFix : c.methodAdd}
              </button>
            )}
          </section>
        )}

        <section aria-labelledby="sigue">
          <h2 id="sigue" className={SECTION_LABEL}>
            {c.nextTitle}
          </h2>
          <div className="card px-5 py-5">
            {!failed && (
              <p className="text-[17px] font-medium leading-snug text-slate-900" data-testid="outlook">
                {outlook.client[locale]}
              </p>
            )}
            {plan || isDiyPlan ? (
              <p className={`text-[15px] leading-relaxed text-slate-600 ${failed ? "" : "mt-2"}`} data-testid="fee-line">
                {isDiyPlan
                  ? p.diyOnly
                  : plan && plan.terms.type === "subscription" && periodTiming(plan.terms) === "on_mailing"
                    ? `${p.onlyAfterWork} ${p.onMailing}`
                    : p.onlyAfterWork}
              </p>
            ) : (
              <>
                <p className={`text-[15px] leading-relaxed text-slate-600 ${failed ? "" : "mt-2"}`} data-testid="fee-line">
                  {fee ? c.feeLine(fee) : c.feeUnknown}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{c.whenLine}</p>
              </>
            )}
          </div>
        </section>

        {plan && (
          <section aria-labelledby="plan" data-testid="plan-card">
            <h2 id="plan" className={SECTION_LABEL}>
              {p.planTitle}
            </h2>
            <div className="card px-5 py-5">
              <p className="text-[15px] leading-snug text-slate-700">{planSummary(plan, locale)}</p>
              <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{p.mostLabel}</p>
              <p className="text-[32px] font-semibold leading-tight tabular-nums text-blue-700" data-testid="most-youll-pay" aria-label={mostYoullPay(plan, locale)}>
                {formatCents(plan.effective.maxTotalCents)}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (chargedTowardCap(towardCap) / Math.max(1, plan.effective.maxTotalCents)) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-[14px] text-slate-600">{p.chargedSoFar(formatCents(chargedTowardCap(towardCap)), formatCents(plan.effective.maxTotalCents))}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{isDiyPlan ? p.diyMostNote : p.mostNote}</p>
              {plan.terms.type === "pay_per_delete" && <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{p.perDelete}</p>}
              <p className="mt-2 text-xs text-slate-500">
                {PLAN_TYPE_LABEL[plan.terms.type][locale]} · v{plan.version}
              </p>
            </div>
          </section>
        )}

        <section aria-labelledby="cobrado">
          <h2 id="cobrado" className={SECTION_LABEL}>
            {c.chargesTitle}
          </h2>
          {charges.length === 0 ? (
            <div className="card px-5 py-5 text-[15px] leading-relaxed text-slate-600" data-testid="charges-empty">
              {c.chargesEmpty}
            </div>
          ) : (
            <ul className="card overflow-hidden">
              {charges.map((charge, index) => {
                const standing = chargeStanding(charge);
                const receipt = receiptOf(charge);
                const open = openReceipt === charge.id;
                return (
                  <li key={charge.id} className={`px-5 py-4 ${index > 0 ? "border-t hairline" : ""}`} data-testid="charge">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-[16px] font-medium leading-snug text-slate-900">{work(charge)}</p>
                      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[standing]}`}>
                        {c.status[standing]}
                      </span>
                    </div>
                    <p className="mt-1 text-[14px] leading-snug text-slate-600">
                      <span className="font-medium tabular-nums text-slate-900">{amountOf(charge)}</span> · {detail(charge)}
                    </p>
                    {receipt && (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenReceipt(open ? null : charge.id)}
                          data-testid="receipt-toggle"
                          aria-expanded={open}
                          className={`mt-1.5 inline-flex h-9 items-center gap-1 ${TEXT_LINK}`}
                        >
                          <Icon name="doc" size={16} />
                          {open ? p.hideInvoice : p.seeInvoice}
                        </button>
                        {open && (
                          <div className="mt-1 rounded-2xl bg-slate-100 px-4 py-4">
                            <ReceiptView receipt={receipt} charge={charge} locale={locale} showAmount={showAmounts} company={company} planName={plan ? plan.name[locale] : null} />
                            <button
                              type="button"
                              onClick={() => setPrinting({ kind: "receipt", id: charge.id })}
                              className="pressable mt-3 flex h-11 items-center justify-center rounded-full bg-white px-4 text-[14px] font-semibold text-slate-900"
                            >
                              {c.print}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="px-1 pt-2 text-[13px] leading-relaxed text-slate-500">{c.retryPolicy}</p>
        </section>

        <section aria-labelledby="estados" data-testid="statements">
          <h2 id="estados" className={SECTION_LABEL}>
            {p.statementsTitle}
          </h2>
          {statements.length === 0 ? (
            <div className="card px-5 py-5 text-[15px] leading-relaxed text-slate-600">{p.statementsEmpty}</div>
          ) : (
            <div className="card overflow-hidden">
              {statements.map((month, i) => (
                <details key={month.key} className={`group px-5 py-3.5 ${i > 0 ? "border-t hairline" : ""}`} open={i === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                    <span className="text-[16px] font-medium text-slate-900 first-letter:uppercase">{month.label}</span>
                    <span className="text-[15px] font-semibold tabular-nums text-slate-900">{showAmounts ? formatCents(month.chargedCents - month.refundedCents) : ""}</span>
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {month.lines.map((line, k) => (
                      <li key={k} className="flex items-baseline justify-between gap-3 text-[14px]" data-testid={line.kind === "no_work" ? "no-work-line" : undefined}>
                        <span className={`min-w-0 ${line.kind === "no_work" ? "text-slate-500" : "text-slate-700"}`}>
                          {line.invoice ? <span className="mr-1 font-mono text-[12.5px] text-slate-500">{line.invoice}</span> : null}
                          {line.text}
                        </span>
                        {line.cents !== null && showAmounts && <span className="shrink-0 tabular-nums text-slate-900">{formatCents(line.cents)}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="metodo" ref={methodRef} className="scroll-mt-24">
          <h2 id="metodo" className={SECTION_LABEL}>
            {c.methodTitle}
          </h2>
          <div className="card px-5 py-5">
            {notice && (
              <p role="status" data-testid="method-notice" className="mb-4 flex items-start gap-2.5 rounded-2xl bg-green-50 px-4 py-3 text-[14px] leading-snug text-green-700">
                <Icon name="check" size={18} className="mt-px shrink-0" />
                <span>{notice}</span>
              </p>
            )}

            {account.paymentMethod ? (
              <div data-testid="method-on-file">
                <p className="text-[19px] font-semibold tabular-nums text-slate-900">
                  {account.paymentMethod.kind === "ach"
                    ? p.bankLabel(account.paymentMethod.brand, account.paymentMethod.last4)
                    : cardLabel(account.paymentMethod.brand, account.paymentMethod.last4)}
                </p>
                <p className="text-[14px] text-slate-500">{c.methodSince(billingDate(account.paymentMethod.addedAt, locale))}</p>
              </div>
            ) : (
              <p className="text-[16px] leading-relaxed text-slate-700" data-testid="method-none">
                {c.methodNone}
              </p>
            )}

            {!adding && !removing && (
              <>
                {!view.agreementSigned ? (
                  <>
                    <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{c.methodNeedsAgreement}</p>
                    <Link href="/acuerdo" className={`${SECONDARY} mt-4`}>
                      {c.methodGoAgreement}
                    </Link>
                  </>
                ) : !canAdd ? (
                  <p className="mt-3 text-[15px] leading-relaxed text-slate-600" data-testid="method-unavailable">
                    {c.methodNotAvailable}
                  </p>
                ) : (
                  <>
                    {!account.paymentMethod && <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{c.methodNoCharge}</p>}
                    <button type="button" onClick={openForm} data-testid="method-open" className={`${account.paymentMethod ? SECONDARY : PRIMARY} mt-4`}>
                      {account.paymentMethod ? c.methodReplace : c.methodAdd}
                    </button>
                  </>
                )}
                {account.paymentMethod && (
                  <button type="button" onClick={() => setRemoving(true)} data-testid="method-remove" className={`mt-1 block min-h-11 w-full text-center ${TEXT_LINK}`}>
                    {c.methodRemove}
                  </button>
                )}
              </>
            )}

            {removing && (
              <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-4" data-testid="method-remove-confirm">
                <p className="text-[15px] leading-relaxed text-slate-800">{c.methodRemoveConfirm}</p>
                <div className="mt-4 grid gap-2.5">
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="pressable flex h-12 w-full items-center justify-center rounded-full bg-blue-700 px-5 text-[16px] font-semibold text-white hover:bg-blue-800 disabled:bg-slate-300"
                  >
                    {c.methodRemoveYes}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(false)}
                    className="pressable flex h-12 w-full items-center justify-center rounded-full bg-white px-5 text-[16px] font-medium text-slate-900"
                  >
                    {c.methodRemoveNo}
                  </button>
                </div>
              </div>
            )}

            {adding && (
              <div className="mt-5 border-t hairline pt-5" data-testid="method-form">
                <h3 className="text-[19px] font-semibold text-slate-900">{c.formTitle}</h3>

                {view.canAddBank && (
                  <div className="mt-4 flex gap-1 rounded-2xl bg-slate-100 p-1" role="group" data-testid="method-kind">
                    {(["card", "ach"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={kind === k}
                        onClick={() => {
                          setKind(k);
                          setAccepted(false);
                          setToken(k === "ach" ? DEMO_BANK_TOKEN_OK : DEMO_TOKEN_OK);
                        }}
                        className={`h-10 flex-1 rounded-xl text-[14px] font-semibold ${kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
                        data-testid={`method-kind-${k}`}
                      >
                        {k === "ach" ? p.methodBank : p.methodCard}
                      </button>
                    ))}
                  </div>
                )}
                {kind === "ach" && <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{p.methodBankWhy}</p>}
                <p className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.formStepAuthorization}</p>
                {view.draft && (
                  <p role="note" className="mt-2 rounded-2xl bg-amber-100 px-4 py-2.5 text-[13px] leading-snug text-blue-900" data-testid="authorization-draft">
                    {c.draftBanner}
                  </p>
                )}
                <div className="mt-2 rounded-2xl bg-slate-50 px-4 py-4" data-testid={kind === "ach" ? "ach-authorization" : "card-authorization"}>
                  <p className="text-[16px] font-semibold text-slate-900">{shownAuthorization.title}</p>
                  <div className="mt-2">
                    <AuthorizationText authorization={shownAuthorization} />
                  </div>
                </div>
                <label className="mt-3 flex cursor-pointer items-start gap-3 py-1">
                  <input
                    type="checkbox"
                    data-testid="authorization-consent"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700"
                  />
                  <span className="min-w-0 text-[15px] leading-snug text-slate-800">{shownAuthorization.consent}</span>
                </label>

                <p className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-slate-500">{kind === "ach" ? p.bankStep : c.formStepCard}</p>
                {/* The marked place for the processor's own hosted fields. This app never renders a card-number input. */}
                <div className="mt-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-4" data-testid="secure-fields">
                  <p className="text-[15px] font-semibold text-slate-900">{kind === "ach" ? p.bankSecureTitle : c.secureFieldsTitle}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-600">{kind === "ach" ? p.bankSecureBody : c.secureFieldsBody}</p>
                  {!view.simulated && view.hostedFields && (
                    <div className="mt-3">
                      <HostedFields
                        config={view.hostedFields}
                        kind={kind}
                        label={kind === "ach" ? p.methodBank : c.formSave}
                        onToken={(t, card) => {
                          const brand = normalizeBrand(card?.brand) ?? brandFromIin(card?.bin ?? "");
                          setHostedBrand(brand);
                          // A brand that is off is never sent on: the client is told and picks another card.
                          if (kind === "card" && cardBrandMessage(brand, view.acceptedCards, locale)) return;
                          setToken(t);
                        }}
                        onError={() => setError(c.errors.generic)}
                      />
                    </div>
                  )}
                  {view.simulated && (
                    <fieldset className="mt-3">
                      <legend className="text-[14px] font-medium text-blue-900">{kind === "ach" ? p.bankDemo : c.secureFieldsDemo}</legend>
                      {(kind === "ach"
                        ? [
                            { value: DEMO_BANK_TOKEN_OK, label: p.bankDemoOk, card: p.bankLabel("checking", "6789") },
                            { value: DEMO_BANK_TOKEN_RETURNS, label: p.bankDemoReturns, card: p.bankLabel("checking", "0002") },
                          ]
                        : TEST_CARDS.map((card) => ({
                            value: card.token,
                            label: card.testId === "ok" ? c.demoCardOk : card.testId === "declined" ? c.demoCardDeclined : c.demoCardBrand(CARD_BRAND_NAME[testCardBrand(card)!]),
                            card: testCardLine(card),
                            testId: card.testId,
                          }))
                      ).map((option) => (
                        <label key={option.value} className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl bg-slate-50 px-3.5 py-3">
                          <input
                            type="radio"
                            name="demo-card"
                            data-testid={`demo-card-${"testId" in option ? option.testId : option.value === DEMO_BANK_TOKEN_OK ? "ok" : "declined"}`}
                            checked={token === option.value}
                            onChange={() => setToken(option.value)}
                            className="h-5 w-5 shrink-0 accent-blue-700"
                          />
                          <span className="min-w-0">
                            <span className="block text-[15px] font-medium text-slate-900">{option.label}</span>
                            <span className="block text-[13px] tabular-nums text-slate-500">{option.card}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {kind === "card" && (
                    <p className="mt-3 text-[13px] leading-snug text-slate-500" data-testid="accepted-cards">
                      {c.acceptedCards(acceptedCardsLine(view.acceptedCards, locale))}
                    </p>
                  )}
                </div>

                {brandWarning && (
                  <p role="alert" className="mt-3 rounded-2xl bg-amber-100 px-4 py-3 text-[15px] font-medium leading-snug text-blue-900" data-testid="card-brand-warning">
                    {brandWarning}
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
                    {error}
                  </p>
                )}
                <button type="button" onClick={save} disabled={!accepted || busy || Boolean(brandWarning)} data-testid="method-save" className={`${PRIMARY} mt-4`}>
                  {c.formSave}
                </button>
                <button type="button" onClick={() => setAdding(false)} className={`${SECONDARY} mt-2.5`}>
                  {c.formCancel}
                </button>
                <p className="mt-3 text-center text-[13px] leading-snug text-slate-500">{c.methodNoCharge}</p>
              </div>
            )}
            {!adding && error && (
              <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
                {error}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="autorizacion">
          <h2 id="autorizacion" className={SECTION_LABEL}>
            {c.authorizationTitle}
          </h2>
          <div className="card px-5 py-5">
            {account.paymentMethod && (
              <p className="text-[15px] leading-relaxed text-slate-700" data-testid="authorization-accepted">
                {c.authorizationAccepted(billingDate(account.paymentMethod.authorizedAt, locale))}
              </p>
            )}
            <details className="group">
              <summary className={`flex h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden ${TEXT_LINK}`} data-testid="authorization-open">
                <Icon name="doc" size={16} />
                {c.authorizationOpen}
              </summary>
              {view.draft && (
                <p role="note" className="mt-1 rounded-2xl bg-amber-100 px-4 py-2.5 text-[13px] leading-snug text-blue-900">
                  {c.draftBanner}
                </p>
              )}
              <div className="mt-3">
                <AuthorizationText authorization={authorization} />
              </div>
              <button
                type="button"
                onClick={() => setPrinting({ kind: "authorization" })}
                className="pressable mt-4 flex h-11 items-center justify-center rounded-full bg-slate-100 px-4 text-[14px] font-semibold text-slate-900"
              >
                {c.print}
              </button>
            </details>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {c.authorizationVersion}: {account.paymentMethod?.authorizationVersion ?? authorization.version}
              {" · "}
              <span className="font-mono">{paymentAuthorizationHash(authorization.version, locale, view.authorizationTerms).slice(0, 12)}</span>
            </p>
          </div>
        </section>

        <section className="card px-5 py-5" aria-labelledby="monitoreo">
          <h2 id="monitoreo" className="text-[17px] font-semibold text-slate-900">
            {c.monitoringTitle}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{c.monitoringBody}</p>
        </section>

        <section className="card px-5 py-5" aria-labelledby="salir" data-testid="end-service">
          <h2 id="salir" className="text-[17px] font-semibold text-slate-900">
            {c.endTitle}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">{c.endBody}</p>
          <Link href="/acuerdo" className={`mt-2 inline-flex h-11 items-center ${TEXT_LINK}`} data-testid="end-link">
            {c.endLink}
          </Link>
        </section>

        {helpHref && (
          <a href={helpHref} target="_blank" rel="noopener noreferrer" className={`block px-1 text-center ${TEXT_LINK}`}>
            {c.helpLink}
          </a>
        )}

        {view.demo && (
          <section aria-labelledby="demo-situaciones" data-testid="scenarios">
            <h2 id="demo-situaciones" className={SECTION_LABEL}>
              {c.scenarioTitle}
            </h2>
            <div className="card px-5 py-4">
              <p className="text-[14px] leading-relaxed text-slate-600">{c.scenarioBody}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {DEMO_SCENARIOS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`scenario-${key}`}
                    aria-pressed={view.scenario === key}
                    onClick={() => {
                      setScenario(key);
                      setAdding(false);
                      setNotice(null);
                      setError(null);
                      setOpenReceipt(null);
                      window.scrollTo({ top: 0 });
                    }}
                    className={`pressable inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold ${
                      view.scenario === key ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"
                    }`}
                  >
                    {DEMO_SCENARIO_LABEL[key][locale]}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* On paper only. */}
      <div className="print-only" aria-hidden="true">
        {printing?.kind === "authorization" && (
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900">{authorization.title}</h1>
            <p className="mt-1 text-[13px] text-slate-600">
              {company} · {c.authorizationVersion}: {authorization.version}
              {account.paymentMethod ? ` · ${c.authorizationAccepted(billingDate(account.paymentMethod.authorizedAt, locale))}` : ""}
            </p>
            <div className="mt-4">
              <AuthorizationText authorization={authorization} />
            </div>
          </div>
        )}
        {printedReceipt && (
          <ReceiptView
            receipt={printedReceipt}
            charge={charges.find((ch) => ch.id === printedReceipt.chargeId)!}
            locale={locale}
            showAmount={showAmounts}
            company={company}
            planName={plan ? plan.name[locale] : null}
          />
        )}
      </div>
    </main>
  );
}
