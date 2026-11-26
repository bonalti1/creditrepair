import { formatCents } from "../billing/money";
import { effectiveAmounts, mostYoullPay, paymentTermsLines, periodTiming, planOption, type PlanTerms, type PlanVersion } from "../billing/plans";
import { MONITORING_OFFER } from "../monitoring/offer";
import { SERVICE_OPTIONS, type ServiceOption } from "../service/options";
import type { Locale } from "../i18n/dictionaries";
import { timelinePlan, type TimelinePlan } from "./payTimeline";

// The plans' public words, with no database: what /precios, the comparison of
// the two options (Credalti Complete and Credalti DIY) and the staff
// invitation print. src/lib/site/plans.ts reads the catalogue on the server and
// hands it to these; a client screen that already has the plans uses them directly.

export interface PublicPlan {
  id: string;
  /** Credalti Complete or Credalti DIY. */
  option: ServiceOption;
  name: string;
  terms: string[];
  most: string;
  /** The plan's own terms, for the "When would I pay?" timeline (payTimeline.ts). */
  timeline: TimelinePlan;
}

export function publicPlansFrom(all: readonly PlanVersion[], locale: Locale): PublicPlan[] {
  return all
    .filter((p) => p.status === "active" && p.attorney !== null && p.terms.type !== "pay_per_delete")
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.key.localeCompare(b.key))
    .map((p) => {
      const e = effectiveAmounts(p.terms, 0);
      // The last line is the "most you'll pay" sentence: shown on its own, larger.
      const lines = paymentTermsLines(p.terms, e, locale).slice(0, -1);
      return { id: p.id, option: planOption(p.terms), name: p.name[locale], terms: lines, most: mostYoullPay({ effective: e, terms: p.terms }, locale), timeline: timelinePlan(p.terms, e) };
    });
}

/** The comparison's price cell for one option: the offered plan's price, honestly, with monitoring beside it. */
export interface OptionPrice {
  /** "$39.00 a month" / "$89.00 per round mailed". */
  headline: string;
  /** When it is charged, and an optional extra (the mailing fee). */
  lines: string[];
}

function headlineOf(t: PlanTerms, locale: Locale): { headline: string; lines: string[] } {
  const e = effectiveAmounts(t, 0);
  const es = locale === "es";
  switch (t.type) {
    case "diy_subscription": {
      const mail = e.mailFeeCents ?? 0;
      return {
        headline: es ? `${formatCents(e.recurringCents)} al mes` : `${formatCents(e.recurringCents)} a month`,
        lines: [
          es ? "Desde el inicio, después de tus 3 días hábiles para cancelar." : "From the start, after your 3 business days to cancel.",
          ...(mail > 0 ? [es ? `Envío por ti, si lo pides: ${formatCents(mail)} por carta.` : `Mailing for you, if you ask: ${formatCents(mail)} per letter.`] : []),
        ],
      };
    }
    case "subscription":
      return {
        headline: es ? `${formatCents(e.recurringCents)} por mes con trabajo` : `${formatCents(e.recurringCents)} per month with work`,
        lines: [
          periodTiming(t) === "on_mailing"
            ? es
              ? "Se cobra después de enviar las cartas de ese mes. Sin cartas, sin cobro."
              : "Charged after that month's letters are mailed. No letters, no charge."
            : es
              ? "Se cobra cuando termina un mes en que se enviaron cartas. Sin cartas, sin cobro."
              : "Charged when a month with letters mailed has ended. No letters, no charge.",
        ],
      };
    case "per_round":
      return { headline: es ? `${formatCents(e.recurringCents)} por ronda enviada` : `${formatCents(e.recurringCents)} per round mailed`, lines: [es ? "Se cobra después de enviar cada ronda." : "Charged after each round is mailed."] };
    case "flat_fee":
      return {
        headline: es ? `${formatCents(e.flatTotalCents)} por ${t.flat!.rounds} rondas` : `${formatCents(e.flatTotalCents)} for ${t.flat!.rounds} rounds`,
        lines: [es ? "Cada pago, después de enviar la ronda que paga." : "Each payment after the round it pays for is mailed."],
      };
    default:
      return { headline: "", lines: [] };
  }
}

/**
 * The price of each option for the comparison: its default offered,
 * attorney-approved plan (else its first), or null (the demo, or nothing
 * offered yet: the comparison then says the price is set by the team).
 * Monitoring is not ours to price: monitoringNote() goes beside it.
 */
export function optionPricesFrom(all: readonly PlanVersion[], locale: Locale): Record<ServiceOption, OptionPrice | null> {
  const offered = all.filter((p) => p.status === "active" && p.attorney !== null && p.terms.type !== "pay_per_delete");
  const out = {} as Record<ServiceOption, OptionPrice | null>;
  for (const option of SERVICE_OPTIONS) {
    const plans = offered.filter((p) => planOption(p.terms) === option).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.key.localeCompare(b.key));
    out[option] = plans[0] ? headlineOf(plans[0].terms, locale) : null;
  }
  return out;
}

/** Shown under every price: the monitoring subscription is separate, with its own price, and we earn a commission. */
export function monitoringNote(locale: Locale): string {
  const who = MONITORING_OFFER.providerName ? ` (${MONITORING_OFFER.providerName})` : "";
  const price = MONITORING_OFFER.priceLabel.replace(/^[~≈]\s*/, "");
  return locale === "es"
    ? `Más el monitoreo de crédito${who}: una suscripción mensual aparte, de unos ${price} al mes, que le pagas a ellos. Credalti recibe una comisión cuando la contratas.`
    : `Plus credit monitoring${who}: a separate monthly subscription, about ${price} a month, paid to them. Credalti earns a commission when you subscribe.`;
}

