import { listPlans } from "../billing/planStore";
import type { Locale } from "../i18n/dictionaries";
import type { ServiceOption } from "../service/options";
import { getAdminClient } from "../supabase/admin";
import { optionPricesFrom, publicPlansFrom, type OptionPrice, type PublicPlan } from "./planText";

export { monitoringNote, optionPricesFrom, publicPlansFrom, type OptionPrice, type PublicPlan } from "./planText";

// The plans /precios may show: only versions that are OFFERED (active) and
// carry the attorney's recorded approval, from the plan catalogue
// (src/lib/billing/plans.ts, /equipo/planes). Their terms are printed in the
// exact words the contract uses (paymentTermsLines), so the page never says
// anything about a price that the agreement does not. With no database (the
// demo), or no approved plan yet, the page shows none and says that plans are
// explained before signing. The demo's example catalogue is never shown: it
// is not approved by anyone.

export async function optionPrices(locale: Locale): Promise<Record<ServiceOption, OptionPrice | null>> {
  const db = getAdminClient();
  if (!db) return { full_service: null, diy: null };
  try {
    return optionPricesFrom(await listPlans(db), locale);
  } catch {
    return { full_service: null, diy: null };
  }
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
