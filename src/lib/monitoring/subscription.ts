import type { SupabaseClient } from "@supabase/supabase-js";

// Is this customer's monitoring subscription active?
//
// The letter builder requires it (the subscription is both the data source and
// the business model). With IdentityIQ there is no status call available to us
// yet, so the rule is evidence-based: a report dated within the last 45 days
// proves the customer has working access to their monitoring account. Monthly
// plans refresh every 30 days; 45 leaves room for a late refresh without
// letting a cancelled subscription ride for long.
//
// An explicit "canceled" or "past_due" from the provider always wins. If IDIQ
// later offers a status call, the adapter reports it and this rule becomes the
// fallback rather than the source.

export const FRESH_REPORT_DAYS = 45;

export type MonitoringReason = "fresh_report" | "no_report" | "stale_report" | "canceled" | "past_due";

export interface MonitoringState {
  active: boolean;
  reason: MonitoringReason;
  /** Days since the newest report, when there is one. */
  reportAgeDays: number | null;
}

export function monitoringState(input: {
  subscriptionStatus: string | null;
  lastPulledAt: string | null;
  now?: Date;
}): MonitoringState {
  const now = input.now ?? new Date();
  const age =
    input.lastPulledAt === null
      ? null
      : Math.floor((now.getTime() - new Date(input.lastPulledAt).getTime()) / (24 * 60 * 60 * 1000));

  if (input.subscriptionStatus === "canceled") return { active: false, reason: "canceled", reportAgeDays: age };
  if (input.subscriptionStatus === "past_due") return { active: false, reason: "past_due", reportAgeDays: age };
  if (age === null) return { active: false, reason: "no_report", reportAgeDays: null };
  if (age > FRESH_REPORT_DAYS) return { active: false, reason: "stale_report", reportAgeDays: age };
  return { active: true, reason: "fresh_report", reportAgeDays: age };
}

/** Customer-facing explanation, Spanish first. Passes the claim rules. */
export function monitoringMessageEs(state: MonitoringState): string {
  switch (state.reason) {
    case "fresh_report":
      return "Tu monitoreo está activo.";
    case "no_report":
      return "Todavía no tenemos tu reporte. Activa tu monitoreo de crédito e importa tu reporte para armar tu ataque.";
    case "stale_report":
      return `Tu último reporte tiene ${state.reportAgeDays} días. Actualízalo desde tu monitoreo de crédito para armar tu ataque con información al día.`;
    case "canceled":
      return "Tu suscripción de monitoreo aparece cancelada. Reactívala para armar tu ataque.";
    case "past_due":
      return "Tu suscripción de monitoreo tiene un pago pendiente. Ponla al corriente para armar tu ataque.";
  }
}

export async function loadMonitoringState(db: SupabaseClient, userId: string): Promise<MonitoringState> {
  const [{ data: sub }, { data: pull }] = await Promise.all([
    db.from("monitoring_subscriptions").select("status").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("report_pulls").select("pulled_at").eq("user_id", userId).order("pulled_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return monitoringState({
    subscriptionStatus: (sub?.status as string | undefined) ?? null,
    lastPulledAt: (pull?.pulled_at as string | undefined) ?? null,
  });
}

/**
 * Called after every successful report import: a report that just arrived is
 * proof of access, so the subscription record is created or marked active.
 */
export async function recordReportAsProof(db: SupabaseClient, userId: string, provider: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("monitoring_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    await db.from("monitoring_subscriptions").update({ status: "active", updated_at: now }).eq("id", existing.id);
  } else {
    await db.from("monitoring_subscriptions").insert({ user_id: userId, provider, status: "active" });
  }
}
