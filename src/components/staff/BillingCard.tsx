"use client";

import { useState } from "react";
import { PAUSE_REASON_MIN_CHARS } from "@/lib/billing/api";
import { chargeStanding, type ChargeStanding } from "@/lib/billing/dunning";
import { REFUND_REASON_MIN_CHARS } from "@/lib/billing/refunds";
import { invoiceNumber, invoiceStatus, INVOICE_STATUS_LABEL } from "@/lib/billing/invoices";
import { PLAN_TYPE_LABEL, planSummary } from "@/lib/billing/plans";
import { chargedTowardCap, feeToCents, formatCents } from "@/lib/billing/rules";
import { unitWork, upcomingCharges } from "@/lib/billing/schedule";
import { billingContextFor } from "@/lib/staff/billing";
import Link from "next/link";
import type { BillingCharge } from "@/lib/billing/types";
import { demoRunsBilling, type StaffData } from "@/lib/staff/data";
import { count, shortDay } from "@/lib/staff/format";
import { clientBillingOutlook } from "@/lib/staff/stage";
import { cardLabel } from "@/lib/staff/timeline";
import type { StaffClient } from "@/lib/staff/types";
import { staffAuthor } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { Chip, DeniedNote, SectionTitle, WAITING_TONE } from "@/components/staff/ui";
import { txFor, useStaffLocale, useTx } from "@/lib/staff/i18n/StaffLocale";
import { staffMessage } from "@/lib/staff/i18n/messages";
import type { StaffLocale } from "@/lib/staff/i18n/locale";

// Billing for one client, as the team reads it: the payment method on file,
// every charge with the work it paid for, and one sentence about what the
// system does next.
//
// Nobody charges from here. A charge is made by the system, only for a round
// that was mailed, at the fee in the client's signed agreement. What staff can
// do is return a charge in full (with a written reason) and pause automatic
// charges for this client (with a reason). There is no field for an amount.

const STANDING: Record<ChargeStanding, { label: { es: string; en: string }; tone: string }> = {
  paid: { label: { es: "Pagado", en: "Paid" }, tone: "bg-green-50 text-green-700" },
  refunded: { label: { es: "Reembolsado", en: "Refunded" }, tone: "bg-slate-100 text-slate-600" },
  processing: { label: { es: "En proceso", en: "Processing" }, tone: "bg-blue-50 text-blue-700" },
  retrying: { label: { es: "Se reintenta", en: "Retrying" }, tone: WAITING_TONE },
  exhausted: { label: { es: "No pasó", en: "Failed" }, tone: "bg-red-50 text-red-700" },
};

/** "the team"/"el equipo" when the teammate gave no name (staffAuthor signs those "equipo"). */
const who = (by: string, locale: StaffLocale) =>
  !by.trim() || by.trim().toLowerCase() === "equipo" ? (locale === "es" ? "el equipo" : "the team") : by.trim();

const FIELD =
  "mt-2 w-full resize-y rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const SMALL_BUTTON = "pressable inline-flex h-11 md:h-9 items-center justify-center rounded-full px-3.5 text-[13px] font-semibold";

/** What happened to a charge after it was created, in a line. */
function chargeDetail(charge: BillingCharge, locale: StaffLocale): string {
  const standing = chargeStanding(charge);
  const t = txFor(locale);
  const day = (iso: string) => shortDay(iso, locale);
  const tries = t(count(charge.attempts, "intento", "intentos"), count(charge.attempts, "try", "tries"));
  if (standing === "paid" || standing === "refunded") {
    return t(
      `Cobrado el ${day(charge.chargedAt!)}${charge.attempts > 1 ? ` · al ${charge.attempts}.º intento` : ""}`,
      `Charged ${day(charge.chargedAt!)}${charge.attempts > 1 ? ` · on try ${charge.attempts}` : ""}`,
    );
  }
  if (standing === "retrying") return t(`${tries} · el sistema lo intenta de nuevo el ${day(charge.nextAttemptAt!)}`, `${tries} · the system tries again ${day(charge.nextAttemptAt!)}`);
  if (standing === "exhausted") {
    return t(
      `${tries}, el último el ${day(charge.lastAttemptAt ?? charge.createdAt)} · el sistema ya no lo intenta`,
      `${tries}, the last on ${day(charge.lastAttemptAt ?? charge.createdAt)} · the system has stopped trying`,
    );
  }
  return t("Esperando la respuesta del procesador de pagos", "Waiting on the payment processor");
}

export default function BillingCard({
  client,
  data,
  now,
  onChanged,
  refundDenied = null,
  pauseDenied = null,
}: {
  client: StaffClient;
  data: StaffData;
  now: Date;
  onChanged: () => Promise<void> | void;
  /** Set when the viewer's role may not return a charge: the reason, shown instead of the control. */
  refundDenied?: string | null;
  /** Set when the viewer's role may not pause or resume billing: the reason, shown instead of the controls. */
  pauseDenied?: string | null;
}) {
  const { locale } = useStaffLocale();
  const t = useTx();
  const [refunding, setRefunding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pausing, setPausing] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { paymentMethod, charges, pause } = client.billing;
  const outlook = clientBillingOutlook(client, now);
  const fee = feeToCents(client.agreementMonthlyFee);
  const rounds = new Map(client.rounds.map((round) => [round.number, round]));
  // Newest first, like the rounds beside it.
  const ordered = [...charges].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.roundNumber - a.roundNumber);
  const attention = outlook.kind === "paused_for_payment" || outlook.kind === "payment_method_missing" || outlook.kind === "needs_person";
  const plan = client.agreementPlan ?? null;
  const context = billingContextFor(client, {
    disclosureAcknowledgedAt: client.disclosureAcknowledgedAt ?? null,
    signedAt: client.agreementSignedAt,
    cancellationDeadline: client.cancellationDeadline ?? null,
    cancelledAt: client.agreementCancelledAt ?? null,
    serviceEndRequestedAt: client.serviceEndRequestedAt ?? null,
  });
  const upcoming = plan ? upcomingCharges(context, now, 3) : [];
  const charged = chargedTowardCap(charges);

  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string }>, done: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(staffMessage(result.message, locale));
      return;
    }
    done();
    await onChanged();
  };

  const refund = (charge: BillingCharge) =>
    act(
      () => data.refundCharge(client.id, charge.id, reason, staffAuthor()),
      () => {
        setRefunding(null);
        setReason("");
      },
    );
  const savePause = () =>
    act(
      () => data.pauseBilling(client.id, pauseReason, staffAuthor()),
      () => {
        setPausing(false);
        setPauseReason("");
      },
    );
  const resume = () => act(() => data.resumeBilling(client.id), () => undefined);
  const simulate = async (newMethod: boolean) => {
    await demoRunsBilling(client.id, { newMethod });
    await onChanged();
  };

  return (
    <section aria-labelledby="cobros" data-testid="billing-card">
      <SectionTitle>
        <span id="cobros">{t("Cobros", "Billing")}</span>
      </SectionTitle>
      <div className="card overflow-hidden">
        <div className="px-5 py-4">
          <p
            data-testid="billing-outlook"
            className={`text-[15px] font-medium leading-snug ${attention ? "rounded-2xl bg-amber-50 px-3.5 py-3 text-blue-900" : "text-slate-900"}`}
          >
            {t(outlook.staff, outlook.staffEn)}
          </p>

          <dl className="mt-3 space-y-2.5 border-t hairline pt-3 text-[14px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-slate-500">{t("Método de pago", "Payment method")}</dt>
              <dd className="min-w-0 text-right">
                {paymentMethod ? (
                  <span className="font-medium text-slate-900" data-testid="billing-method">
                    {cardLabel(paymentMethod.brand, paymentMethod.last4)}
                  </span>
                ) : (
                  <Chip tone={outlook.kind === "payment_method_missing" ? WAITING_TONE : "bg-slate-100 text-slate-600"}>{t("Sin método", "None")}</Chip>
                )}
              </dd>
            </div>
            {paymentMethod && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">{t("Autorización", "Authorization")}</dt>
                <dd className="text-right font-medium text-slate-900">
                  {t(`Aceptada el ${shortDay(paymentMethod.authorizedAt, "es")}`, `Accepted ${shortDay(paymentMethod.authorizedAt, "en")}`)}
                </dd>
              </div>
            )}
            {plan && (
              <>
                <div className="flex items-baseline justify-between gap-3" data-testid="billing-plan">
                  <dt className="shrink-0 text-slate-500">{t("Plan firmado", "Signed plan")}</dt>
                  <dd className="min-w-0 text-right font-medium text-slate-900">
                    {plan.name[locale]} <span className="font-normal text-slate-500">v{plan.version} · {PLAN_TYPE_LABEL[plan.terms.type][locale]}</span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-slate-500">{t("Lo máximo que pagará", "Most they'll pay")}</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900" data-testid="billing-cap">
                    {formatCents(charged)} {t("de", "of")} {formatCents(plan.effective.maxTotalCents)}
                  </dd>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div className="h-full rounded-full bg-blue-700" style={{ width: `${Math.min(100, (charged / Math.max(1, plan.effective.maxTotalCents)) * 100)}%` }} />
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-slate-500">{plan ? t("Monto", "Amount") : t("Cuota de su acuerdo", "Agreement fee")}</dt>
              <dd className="text-right font-medium text-slate-900">
                {plan
                  ? planSummary(plan, locale).split(" · ").slice(1).join(" · ")
                  : fee !== null
                  ? t(`${formatCents(fee)} por ronda enviada`, `${formatCents(fee)} per mailed round`)
                  : client.agreementSignedAt
                    ? t("Sin cuota en el acuerdo", "No fee in the agreement")
                    : t("Sin acuerdo firmado", "No signed agreement")}
              </dd>
            </div>
          </dl>
          {upcoming.length > 0 && (
            <div className="mt-3 border-t hairline pt-3" data-testid="billing-upcoming">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{t("Próximos cobros, por trabajo ya registrado", "Upcoming charges, for work already on record")}</p>
              <ul className="mt-1.5 space-y-1.5">
                {upcoming.map((u) => (
                  <li key={u.at + u.work.en} className="flex items-baseline justify-between gap-3 text-[13.5px]">
                    <span className="min-w-0 text-slate-700">
                      <span className="font-medium text-slate-900">{shortDay(u.at, locale)}</span> · {u.work[locale]}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatCents(u.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {pause && (
          <div className="border-t hairline bg-amber-50 px-5 py-3.5" data-testid="billing-paused">
            <p className="text-[14px] leading-snug text-blue-900">
              <span className="font-semibold">{t("Cobros en pausa", "Billing paused")}</span>{" "}
              {t(`desde el ${shortDay(pause.at, "es")}, por ${who(pause.by, "es")}`, `since ${shortDay(pause.at, "en")}, by ${who(pause.by, "en")}`)}: «{pause.reason}»
            </p>
            {!pauseDenied && (
            <button type="button" onClick={resume} disabled={busy} className={`${SMALL_BUTTON} mt-2.5 bg-white text-blue-900 hover:bg-slate-50`}>
              {t("Reanudar cobros", "Resume billing")}
            </button>
            )}
          </div>
        )}

        {ordered.length > 0 && (
          <ul>
            {ordered.map((charge) => {
              const standing = chargeStanding(charge);
              const round = rounds.get(charge.roundNumber);
              const open = refunding === charge.id;
              const longEnough = reason.replace(/\s+/g, " ").trim().length >= REFUND_REASON_MIN_CHARS;
              return (
                <li key={charge.id} className="border-t hairline px-5 py-3.5" data-testid="billing-charge">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium leading-snug text-slate-900">
                        {charge.unit && charge.unit !== "round"
                          ? unitWork(charge, locale)
                          : t(`Ronda ${charge.roundNumber} · enviada el ${shortDay(charge.workDate, "es")}`, `Round ${charge.roundNumber} · mailed ${shortDay(charge.workDate, "en")}`)}
                      </p>
                      <p className="text-[12px] text-slate-500">
                        <Link href={`/equipo/cobros/${encodeURIComponent(charge.id)}`} className="font-mono underline-offset-2 hover:underline">
                          {invoiceNumber(charge)}
                        </Link>
                        {" · "}
                        {INVOICE_STATUS_LABEL[invoiceStatus(charge)][locale]}
                        {charge.methodKind === "ach" ? " · ACH" : ""}
                        {charge.chargeback ? ` · ${t("contracargo", "chargeback")} ${charge.chargeback.status}` : ""}
                      </p>
                      <p className="text-[13px] leading-snug text-slate-500">
                        {formatCents(charge.amountCents)}
                        {round ? ` · ${t(count(round.letters.length, "carta", "cartas"), count(round.letters.length, "letter", "letters"))}` : ""}
                      </p>
                    </div>
                    <Chip tone={STANDING[standing].tone}>{STANDING[standing].label[locale]}</Chip>
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-slate-600">{chargeDetail(charge, locale)}</p>
                  {charge.refund && (
                    <p className="mt-1.5 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-[13px] leading-snug text-slate-700" data-testid="billing-refund">
                      {t(
                        `Devuelto completo (${formatCents(charge.refund.amountCents)}) el ${shortDay(charge.refund.at, "es")} por ${who(charge.refund.by, "es")}`,
                        `Refunded in full (${formatCents(charge.refund.amountCents)}) on ${shortDay(charge.refund.at, "en")} by ${who(charge.refund.by, "en")}`,
                      )}
                      : «{charge.refund.reason}»
                    </p>
                  )}

                  {standing === "paid" && !open && !refundDenied && (
                    <button
                      type="button"
                      onClick={() => {
                        setRefunding(charge.id);
                        setReason("");
                        setError(null);
                      }}
                      data-testid="refund-open"
                      className="mt-1.5 text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
                    >
                      {t("Reembolsar este cobro", "Refund this charge")}
                    </button>
                  )}
                  {open && (
                    <div className="mt-2.5 rounded-2xl bg-slate-100 px-3.5 py-3" data-testid="refund-form">
                      <label htmlFor={`refund-${charge.id}`} className="block text-[13px] font-medium text-slate-900">
                        {t("Motivo del reembolso (obligatorio)", "Reason for the refund (required)")}
                      </label>
                      <textarea
                        id={`refund-${charge.id}`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                        rows={2}
                        placeholder={t("Qué pasó. Queda en el registro y no se puede borrar.", "What happened. It goes on the record and can't be deleted.")}
                        className={`${FIELD} bg-white`}
                      />
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        {t(
                          `Se devuelve el cobro completo: ${formatCents(charge.amountCents)}. El cobro queda en el registro como reembolsado y esa ronda no se vuelve a cobrar.`,
                          `The full charge is returned: ${formatCents(charge.amountCents)}. The charge stays on record as refunded and that round isn't charged again.`,
                        )}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => refund(charge)}
                          disabled={!longEnough || busy}
                          data-testid="refund-confirm"
                          className={`${SMALL_BUTTON} bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300`}
                        >
                          {t(`Reembolsar ${formatCents(charge.amountCents)}`, `Refund ${formatCents(charge.amountCents)}`)}
                        </button>
                        <button type="button" onClick={() => setRefunding(null)} className={`${SMALL_BUTTON} bg-white text-slate-900`}>
                          {t("Cancelar", "Cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p role="alert" className="border-t hairline bg-red-50 px-5 py-3 text-[13px] leading-snug text-red-700">
            {error}
          </p>
        )}

        {(refundDenied || pauseDenied) && (
          <div className="border-t hairline px-5 py-3" data-testid="billing-denied">
            <DeniedNote>{[refundDenied, pauseDenied].filter(Boolean).join(" ")}</DeniedNote>
          </div>
        )}

        {!pause && !pauseDenied && client.agreementSignedAt && !client.agreementCancelledAt && (
          <div className="border-t hairline px-5 py-3.5">
            {!pausing ? (
              <button
                type="button"
                onClick={() => {
                  setPausing(true);
                  setError(null);
                }}
                data-testid="pause-open"
                className="inline-flex min-h-11 items-center text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                {t("Pausar los cobros de este cliente", "Pause billing for this client")}
              </button>
            ) : (
              <div data-testid="pause-form">
                <label htmlFor="pause-reason" className="block text-[13px] font-medium text-slate-900">
                  {t("Motivo de la pausa (obligatorio)", "Reason for the pause (required)")}
                </label>
                <textarea
                  id="pause-reason"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value.slice(0, 1000))}
                  rows={2}
                  placeholder={t("Por qué no se le cobra por ahora.", "Why they aren't being charged for now.")}
                  className={FIELD}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {t(
                    "Mientras dure la pausa el sistema no crea ni reintenta ningún cobro. Las cartas siguen su curso.",
                    "While the pause lasts, the system doesn't create or retry any charge. The letters keep going.",
                  )}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={savePause}
                    disabled={pauseReason.replace(/\s+/g, " ").trim().length < PAUSE_REASON_MIN_CHARS || busy}
                    data-testid="pause-confirm"
                    className={`${SMALL_BUTTON} bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300`}
                  >
                    {t("Pausar cobros", "Pause billing")}
                  </button>
                  <button type="button" onClick={() => setPausing(false)} className={`${SMALL_BUTTON} bg-slate-100 text-slate-900`}>
                    {t("Cancelar", "Cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="flex gap-2 px-1 pt-2 text-xs leading-relaxed text-slate-500">
        <Icon name="check" size={14} className="mt-0.5 shrink-0" />
        <span>
          {t(
            "Los cobros los hace el sistema, solo por trabajo ya registrado y con los montos del plan firmado. El equipo no puede crear un cobro ni cambiar un monto: solo reembolsar o pausar.",
            "The system makes the charges, only for work already on record and at the signed plan's amounts. The team can't create a charge or change an amount: only refund or pause.",
          )}
        </span>
      </p>

      {data.demo && (outlook.kind === "paused_for_payment" || outlook.kind === "payment_method_missing" || outlook.kind === "retry_scheduled") && (
        <p className="px-1 pt-1.5 text-xs leading-relaxed text-slate-500">
          {t("El método de pago lo pone el cliente en su app. Demo:", "The client enters their payment method in their app. Demo:")}{" "}
          <button
            type="button"
            data-testid="demo-new-method"
            onClick={() => simulate(true)}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            {t("simular que el cliente puso un método de pago que sí pasa", "pretend the client added a payment method that works")}
          </button>
          .
        </p>
      )}
      {data.demo && outlook.kind === "charge_scheduled" && outlook.at !== null && new Date(outlook.at).getTime() <= now.getTime() && (
        <p className="px-1 pt-1.5 text-xs leading-relaxed text-slate-500">
          {t("Demo:", "Demo:")}{" "}
          <button
            type="button"
            data-testid="demo-run-billing"
            onClick={() => simulate(false)}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            {t("simular la corrida de cobros del sistema", "simulate the system's billing run")}
          </button>
          {t(". No se mueve dinero.", ". No money moves.")}
        </p>
      )}
    </section>
  );
}
