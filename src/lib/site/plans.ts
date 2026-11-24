import { listPlans } from "../billing/planStore";
import { effectiveAmounts, mostYoullPay, paymentTermsLines, type PlanVersion } from "../billing/plans";
import type { Locale } from "../i18n/dictionaries";
import { getAdminClient } from "../supabase/admin";

// The plans /precios may show: only versions that are OFFERED (active) and
// carry the attorney's recorded approval, from the plan catalogue
// (src/lib/billing/plans.ts, /equipo/planes). Their terms are printed in the
// exact words the contract uses (paymentTermsLines), so the page never says
// anything about a price that the agreement does not. With no database (the
// demo), or no approved plan yet, the page shows none and says that plans are
// explained before signing. The demo's example catalogue is never shown: it
// is not approved by anyone.

export interface PublicPlan {
  id: string;
  name: string;
  terms: string[];
  most: string;
}

export function publicPlansFrom(all: readonly PlanVersion[], locale: Locale): PublicPlan[] {
  return all
    .filter((p) => p.status === "active" && p.attorney !== null && p.terms.type !== "pay_per_delete")
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.key.localeCompare(b.key))
    .map((p) => {
      const e = effectiveAmounts(p.terms, 0);
      // The last line is the "most you'll pay" sentence: shown on its own, larger.
      const lines = paymentTermsLines(p.terms, e, locale).slice(0, -1);
      return { id: p.id, name: p.name[locale], terms: lines, most: mostYoullPay({ effective: e }, locale) };
    });
}

/**
 * Pay per delete is left out on purpose even when approved: a price per item
 * "no longer reported" reads as a result, and the public site makes no
 * result claims. The team can still offer it in person, with the contract.
 */
export async function publicPlans(locale: Locale): Promise<PublicPlan[]> {
  const db = getAdminClient();
  if (!db) return [];
  try {
    return publicPlansFrom(await listPlans(db), locale);
  } catch {
    return [];
  }
}
