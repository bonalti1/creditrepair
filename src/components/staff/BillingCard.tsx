"use client";

import { useState } from "react";
import { PAUSE_REASON_MIN_CHARS } from "@/lib/billing/api";
import { chargeStanding, type ChargeStanding } from "@/lib/billing/dunning";
import { REFUND_REASON_MIN_CHARS } from "@/lib/billing/refunds";
import { feeToCents, formatCents } from "@/lib/billing/rules";
import type { BillingCharge } from "@/lib/billing/types";
import { demoRunsBilling, type StaffData } from "@/lib/staff/data";
import { count, shortDay } from "@/lib/staff/format";
import { clientBillingOutlook } from "@/lib/staff/stage";
import { cardLabel } from "@/lib/staff/timeline";
import type { StaffClient } from "@/lib/staff/types";
import { staffAuthor } from "@/lib/staff/useStaff";
import Icon from "@/components/Icon";
import { Chip, DeniedNote, SectionTitle, WAITING_TONE } from "@/components/staff/ui";

// Billing for one client, as the team reads it: the payment method on file,
// every charge with the work it paid for, and one sentence about what the
// system does next.
//
// Nobody charges from here. A charge is made by the system, only for a round
// that was mailed, at the fee in the client's signed agreement. What staff can
// do is return a charge in full (with a written reason) and pause automatic
// charges for this client (with a reason). There is no field for an amount.

const STANDING: Record<ChargeStanding, { label: string; tone: string }> = {
  paid: { label: "Pagado", tone: "bg-green-50 text-green-700" },
  refunded: { label: "Reembolsado", tone: "bg-slate-100 text-slate-600" },
  processing: { label: "En proceso", tone: "bg-blue-50 text-blue-700" },
  retrying: { label: "Se reintenta", tone: WAITING_TONE },
  exhausted: { label: "No pasó", tone: "bg-red-50 text-red-700" },
};

/** "el equipo" when the teammate gave no name (staffAuthor signs those "equipo"). */
const who = (by: string) => (!by.trim() || by.trim().toLowerCase() === "equipo" ? "el equipo" : by.trim());

const FIELD =
  "mt-2 w-full resize-y rounded-2xl bg-slate-50 px-3.5 py-2.5 text-[14px] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-300";
const SMALL_BUTTON = "pressable inline-flex h-9 items-center justify-center rounded-full px-3.5 text-[13px] font-semibold";

/** What happened to a charge after it was created, in a line. */
function chargeDetail(charge: BillingCharge): string {
  const standing = chargeStanding(charge);
  const tries = count(charge.attempts, "intento", "intentos");
  if (standing === "paid" || standing === "refunded") {
    return `Cobrado el ${shortDay(charge.chargedAt!)}${charge.attempts > 1 ? ` · al ${charge.attempts}.º intento` : ""}`;
  }
  if (standing === "retrying") return `${tries} · el sistema lo intenta de nuevo el ${shortDay(charge.nextAttemptAt!)}`;
  if (standing === "exhausted") return `${tries}, el último el ${shortDay(charge.lastAttemptAt ?? charge.createdAt)} · el sistema ya no lo intenta`;
  return "Esperando la respuesta del procesador de pagos";
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
  const ordered = [...charges].sort((a, b) => b.roundNumber - a.roundNumber);
  const attention = outlook.kind === "paused_for_payment" || outlook.kind === "payment_method_missing" || outlook.kind === "needs_person";

  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string }>, done: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
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
        <span id="cobros">Cobros</span>
      </SectionTitle>
      <div className="card overflow-hidden">
        <div className="px-5 py-4">
          <p
            data-testid="billing-outlook"
            className={`text-[15px] font-medium leading-snug ${attention ? "rounded-2xl bg-amber-50 px-3.5 py-3 text-blue-900" : "text-slate-900"}`}
          >
            {outlook.staff}
          </p>

          <dl className="mt-3 space-y-2.5 border-t hairline pt-3 text-[14px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-slate-500">Método de pago</dt>
              <dd className="min-w-0 text-right">
                {paymentMethod ? (
                  <span className="font-medium text-slate-900" data-testid="billing-method">
                    {cardLabel(paymentMethod.brand, paymentMethod.last4)}
                  </span>
                ) : (
                  <Chip tone={outlook.kind === "payment_method_missing" ? WAITING_TONE : "bg-slate-100 text-slate-600"}>Sin método</Chip>
                )}
              </dd>
            </div>
            {paymentMethod && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-slate-500">Autorización</dt>
                <dd className="text-right font-medium text-slate-900">Aceptada el {shortDay(paymentMethod.authorizedAt)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-slate-500">Cuota de su acuerdo</dt>
              <dd className="text-right font-medium text-slate-900">
                {fee !== null ? `${formatCents(fee)} por ronda enviada` : client.agreementSignedAt ? "Sin cuota en el acuerdo" : "Sin acuerdo firmado"}
              </dd>
            </div>
          </dl>
        </div>

        {pause && (
          <div className="border-t hairline bg-amber-50 px-5 py-3.5" data-testid="billing-paused">
            <p className="text-[14px] leading-snug text-blue-900">
              <span className="font-semibold">Cobros en pausa</span> desde el {shortDay(pause.at)}, por {who(pause.by)}: «{pause.reason}»
            </p>
            {!pauseDenied && (
            <button type="button" onClick={resume} disabled={busy} className={`${SMALL_BUTTON} mt-2.5 bg-white text-blue-900 hover:bg-slate-50`}>
              Reanudar cobros
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
                        Ronda {charge.roundNumber} · enviada el {shortDay(charge.workDate)}
                      </p>
                      <p className="text-[13px] leading-snug text-slate-500">
                        {formatCents(charge.amountCents)}
                        {round ? ` · ${count(round.letters.length, "carta", "cartas")}` : ""}
                      </p>
                    </div>
                    <Chip tone={STANDING[standing].tone}>{STANDING[standing].label}</Chip>
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-slate-600">{chargeDetail(charge)}</p>
                  {charge.refund && (
                    <p className="mt-1.5 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-[13px] leading-snug text-slate-700" data-testid="billing-refund">
                      Devuelto completo ({formatCents(charge.refund.amountCents)}) el {shortDay(charge.refund.at)} por {who(charge.refund.by)}: «
                      {charge.refund.reason}»
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
                      Reembolsar este cobro
                    </button>
                  )}
                  {open && (
                    <div className="mt-2.5 rounded-2xl bg-slate-100 px-3.5 py-3" data-testid="refund-form">
                      <label htmlFor={`refund-${charge.id}`} className="block text-[13px] font-medium text-slate-900">
                        Motivo del reembolso (obligatorio)
                      </label>
                      <textarea
                        id={`refund-${charge.id}`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                        rows={2}
                        placeholder="Qué pasó. Queda en el registro y no se puede borrar."
                        className={`${FIELD} bg-white`}
                      />
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        Se devuelve el cobro completo: {formatCents(charge.amountCents)}. El cobro queda en el registro como reembolsado y
                        esa ronda no se vuelve a cobrar.
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => refund(charge)}
                          disabled={!longEnough || busy}
                          data-testid="refund-confirm"
                          className={`${SMALL_BUTTON} bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300`}
                        >
                          Reembolsar {formatCents(charge.amountCents)}
                        </button>
                        <button type="button" onClick={() => setRefunding(null)} className={`${SMALL_BUTTON} bg-white text-slate-900`}>
                          Cancelar
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
                className="text-[13px] font-medium text-blue-700 underline-offset-2 hover:underline"
              >
                Pausar los cobros de este cliente
              </button>
            ) : (
              <div data-testid="pause-form">
                <label htmlFor="pause-reason" className="block text-[13px] font-medium text-slate-900">
                  Motivo de la pausa (obligatorio)
                </label>
                <textarea
                  id="pause-reason"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value.slice(0, 1000))}
                  rows={2}
                  placeholder="Por qué no se le cobra por ahora."
                  className={FIELD}
                />
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Mientras dure la pausa el sistema no crea ni reintenta ningún cobro. Las cartas siguen su curso.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={savePause}
                    disabled={pauseReason.replace(/\s+/g, " ").trim().length < PAUSE_REASON_MIN_CHARS || busy}
                    data-testid="pause-confirm"
                    className={`${SMALL_BUTTON} bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300`}
                  >
                    Pausar cobros
                  </button>
                  <button type="button" onClick={() => setPausing(false)} className={`${SMALL_BUTTON} bg-slate-100 text-slate-900`}>
                    Cancelar
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
          Los cobros los hace el sistema, solo por rondas ya enviadas y por la cuota del acuerdo firmado. El equipo no puede crear un cobro ni
          cambiar un monto: solo reembolsar o pausar.
        </span>
      </p>

      {data.demo && (outlook.kind === "paused_for_payment" || outlook.kind === "payment_method_missing" || outlook.kind === "retry_scheduled") && (
        <p className="px-1 pt-1.5 text-xs leading-relaxed text-slate-500">
          El método de pago lo pone el cliente en su app. Demo:{" "}
          <button
            type="button"
            data-testid="demo-new-method"
            onClick={() => simulate(true)}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            simular que el cliente puso un método de pago que sí pasa
          </button>
          .
        </p>
      )}
      {data.demo && outlook.kind === "charge_scheduled" && outlook.at !== null && new Date(outlook.at).getTime() <= now.getTime() && (
        <p className="px-1 pt-1.5 text-xs leading-relaxed text-slate-500">
          Demo:{" "}
          <button
            type="button"
            data-testid="demo-run-billing"
            onClick={() => simulate(false)}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            simular la corrida de cobros del sistema
          </button>
          . No se mueve dinero.
        </p>
      )}
    </section>
  );
}
