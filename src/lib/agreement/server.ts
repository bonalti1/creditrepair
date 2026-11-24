import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOpenStates } from "../compliance/stateOpenings";
import { isStateOpen } from "../compliance/states";
import { agreementFromRow, type AgreementState } from "./record";

// Reading a client's agreement on the server. Rows are written only by the
// agreement endpoints, with the service role (migration 0010).

export const AGREEMENT_TABLE = "service_agreements";

/**
 * The client's current agreement row: the newest one. (A client who cancelled
 * and later came back has an older, cancelled row and a newer one.)
 */
export async function loadAgreementRow(db: SupabaseClient, userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from(AGREEMENT_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`service_agreements: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

export async function loadAgreement(db: SupabaseClient, userId: string): Promise<AgreementState | null> {
  const row = await loadAgreementRow(db, userId);
  return row ? agreementFromRow(row) : null;
}

/**
 * Tell the team something a person has to know about (a cancellation, a
 * request to end the service). Optional: needs TEAM_WEBHOOK_URL, or
 * SALES_WEBHOOK_URL as a fallback; both take {"text": ...} like the other
 * alerts. No personal data: the account id only.
 */
export async function notifyTeam(text: string): Promise<void> {
  const url = process.env.TEAM_WEBHOOK_URL || process.env.SALES_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // The record is already saved and shows in the staff console; a missed ping must not fail the request.
  }
}

/**
 * The client's state for the agreement (profiles.state; none on record reads
 * as the launch state) and whether Credalti has opened it (/equipo/estados,
 * migration 0030). A state not opened cannot acknowledge or sign.
 */
export async function loadSigningState(db: SupabaseClient, userId: string): Promise<{ state: string | null; open: boolean }> {
  const { data } = await db.from("profiles").select("state").eq("id", userId).maybeSingle();
  const state = typeof (data as Record<string, unknown> | null)?.state === "string" ? String((data as Record<string, unknown>).state) : null;
  return { state, open: isStateOpen(state ?? "TX", await loadOpenStates(db)) };
}
