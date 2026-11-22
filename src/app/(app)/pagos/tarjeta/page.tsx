"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { paymentAuthorization } from "@/lib/billing/authorization";
import { DEMO_TOKEN_DECLINED, DEMO_TOKEN_OK } from "@/lib/billing/gateway";
import { billingOutlook } from "@/lib/billing/outlook";
import { formatCents } from "@/lib/billing/rules";
import { useLocale } from "@/lib/i18n";
import { BILLING_COPY } from "@/lib/ux/billingCopy";
import { useBilling } from "@/lib/ux/billingStore";

// "Actualizar mi tarjeta": the page the automatic payment messages link to
// (a declined charge, or a round mailed with no payment method on file). One
// screen: what is owed and for which work, the recurring authorization, the
// payment processor's own hosted fields (in the demo, the two labelled test
// cards, as on «Mis pagos»), one button.
//
// Saving the card retries the charge that is waiting, right away, through the
// same server run that bills every hour (POST /api/billing/payment-method, the
// one route that does it): no charge before the work, one charge per round, never
// more often than every 30 days. A card number never touches this app.

const COPY = {
  es: {
    title: "Actualizar mi tarjeta",
    lead: "Tu tarjeta va directo al procesador de pagos. Al guardarla, el cobro pendiente se intenta enseguida, una sola vez.",
    owed: "Lo pendiente",
    card: "Tu tarjeta",
    nothing: "No hay ningún cobro pendiente. Puedes cambiar tu tarjeta cuando quieras en «Mis pagos».",
    consent: "Acepto la autorización de pagos",
    readAuthorization: "Leer la autorización completa",
    save: "Guardar tarjeta e intentar el cobro",
    saveOnly: "Guardar tarjeta",
    back: "Mis pagos",
    example: "Ver un ejemplo de cobro que no pasó",
  },
  en: {
    title: "Update my card",
    lead: "Your card goes straight to the payment processor. When you save it, the pending charge is tried right away, once.",
    owed: "What is pending",
    card: "Your card",
    nothing: "There is no pending charge. You can change your card anytime under \"My payments\".",
    consent: "I accept the payment authorization",
    readAuthorization: "Read the full authorization",
    save: "Save card and try the charge",
    saveOnly: "Save card",
    back: "My payments",
    example: "See an example of a declined charge",
  },
} as const;

const PRIMARY =
  "pressable flex h-14 w-full items-center justify-center rounded-full bg-amber-400 px-6 text-[17px] font-semibold text-blue-900 hover:bg-amber-500 disabled:bg-slate-200 disabled:text-slate-500";

export default function ActualizarTarjetaPage() {
  const { locale } = useLocale();
  const l = locale === "en" ? "en" : "es";
  const c = COPY[l];
  const b = BILLING_COPY[l];
  const { view, hydrated, addMethod, setScenario } = useBilling();
  const [now, setNow] = useState<Date | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [token, setToken] = useState(DEMO_TOKEN_OK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setNow(new Date()), [view]);
  // Demo: "?ejemplo=1" shows the example of a declined charge, so the page has something to fix.
  useEffect(() => {
    if (!view?.demo || view.scenario !== "live") return;
    if (new URLSearchParams(window.location.search).get("ejemplo") === "1") setScenario("paused");
  }, [view, setScenario]);

  const authorization = useMemo(() => (view ? paymentAuthorization(l, view.authorizationTerms) : null), [l, view]);
  if (!hydrated || !now || !view || !authorization) return null;

  const outlook = billingOutlook(view.context, now, { amounts: view.showAmounts });
  const failed = view.context.account.charges.find((ch) => ch.status === "failed") ?? null;
  const pending = failed !== null || outlook.kind === "payment_method_missing";
  const canAdd = view.canAddMethod && view.simulated && view.agreementSigned;

  const save = async () => {
    if (!accepted || busy) return;
    setBusy(true);
    setError(null);
    const result = await addMethod(token, l);
    setBusy(false);
    if (!result.ok) {
      setError(result.code === "payment_method_refused" ? b.errors.refused : b.errors.generic);
      return;
    }
    setNotice(result.settled > 0 ? { ok: true, text: b.formSettled } : result.declined > 0 ? { ok: false, text: b.formStillDeclined } : { ok: true, text: b.formSaved });
  };

  return (
    <main className="animate-rise space-y-5" data-testid="actualizar-tarjeta">
      <Link href="/pagos" className="inline-flex h-11 items-center gap-1 px-1 text-[15px] font-medium text-blue-700">
        <Icon name="chevron" size={16} className="rotate-180" />
        {c.back}
      </Link>
      <header className="px-1">
        <h1 className="font-display text-[30px] font-bold leading-tight text-blue-700">{c.title}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-slate-600">{c.lead}</p>
      </header>
      {(view.demo || view.simulated) && (
        <p role="note" className="rounded-2xl bg-amber-100 px-4 py-3 text-[14px] leading-snug text-blue-900">
          {b.demoBanner}
        </p>
      )}

      <section className="card px-5 py-5" aria-labelledby="pendiente" data-testid="card-owed">
        <h2 id="pendiente" className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          {c.owed}
        </h2>
        {pending ? (
          <>
            {failed && view.showAmounts && <p className="mt-1 text-[24px] font-semibold tabular-nums text-slate-900">{formatCents(failed.amountCents)}</p>}
            <p className="mt-1.5 text-[16px] leading-relaxed text-slate-800">{outlook.client[l]}</p>
          </>
        ) : (
          <p className="mt-1.5 text-[16px] leading-relaxed text-slate-700">{c.nothing}</p>
        )}
        {view.demo && !pending && (
          <button type="button" onClick={() => setScenario("paused")} className="mt-2 min-h-11 text-[15px] font-medium text-blue-700">
            {c.example}
          </button>
        )}
      </section>

      {notice ? (
        <section className={`card flex items-start gap-2.5 px-5 py-5 text-[16px] leading-relaxed ${notice.ok ? "text-green-700" : "text-blue-900"}`} role="status" data-testid="card-result">
          <Icon name={notice.ok ? "check" : "doc"} size={20} className="mt-0.5 shrink-0" />
          <span>{notice.text}</span>
        </section>
      ) : canAdd ? (
        <section className="card px-5 py-5" data-testid="card-form">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{c.card}</p>
          {/* The marked place for the processor's own hosted fields. This app never renders a card-number input. */}
          <div className="mt-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-4" data-testid="secure-fields">
            <p className="text-[15px] font-semibold text-slate-900">{b.secureFieldsTitle}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-slate-600">{b.secureFieldsBody}</p>
            <fieldset className="mt-3">
              <legend className="text-[14px] font-medium text-blue-900">{b.secureFieldsDemo}</legend>
              {[
                { value: DEMO_TOKEN_OK, label: b.demoCardOk, card: "Visa ···· 4242" },
                { value: DEMO_TOKEN_DECLINED, label: b.demoCardDeclined, card: "Visa ···· 0002" },
              ].map((option) => (
                <label key={option.value} className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl bg-slate-50 px-3.5 py-3">
                  <input type="radio" name="demo-card" checked={token === option.value} onChange={() => setToken(option.value)} className="h-5 w-5 shrink-0 accent-blue-700" />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium text-slate-900">{option.label}</span>
                    <span className="block text-[13px] tabular-nums text-slate-500">{option.card}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 py-1">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-blue-700" data-testid="card-consent" />
            <span className="min-w-0 text-[15px] leading-snug text-slate-800">{authorization.consent}</span>
          </label>
          <details className="mt-1">
            <summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 text-[15px] font-medium text-blue-700 [&::-webkit-details-marker]:hidden">
              <Icon name="doc" size={16} />
              {c.readAuthorization}
            </summary>
            {view.draft && <p className="mt-1 rounded-2xl bg-amber-100 px-4 py-2.5 text-[13px] leading-snug text-blue-900">{b.draftBanner}</p>}
            <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{authorization.intro}</p>
            <ul className="mt-2 space-y-2">
              {authorization.points.map((p) => (
                <li key={p.heading} className="text-[14px] leading-relaxed text-slate-700">
                  <span className="font-semibold text-slate-900">{p.heading}.</span> {p.text}
                </li>
              ))}
            </ul>
          </details>
          {error && (
            <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[14px] leading-snug text-red-700">
              {error}
            </p>
          )}
          <button type="button" onClick={save} disabled={!accepted || busy} className={`${PRIMARY} mt-4`} data-testid="card-save">
            {pending ? c.save : c.saveOnly}
          </button>
          <p className="mt-3 text-center text-[13px] leading-snug text-slate-500">{b.methodNoCharge}</p>
        </section>
      ) : (
        <section className="card px-5 py-5 text-[15px] leading-relaxed text-slate-600">{view.agreementSigned ? b.methodNotAvailable : b.methodNeedsAgreement}</section>
      )}
    </main>
  );
}
