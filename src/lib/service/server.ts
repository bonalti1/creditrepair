import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveOption, optionOfTerms, parseServiceOption, type ServiceOption } from "./options";

// A client's service option on the server (migration 0042). The signed
// agreement in force decides; before signing, the option they chose
// (client_service_options); with neither, full service. Every write is the
// server's, with the service role, and leaves a line in service_option_changes.

type Row = Record<string, unknown>;

export type ChosenVia = "signup_chat" | "invitation" | "onboarding" | "app" | "switch" | "staff_invite";

export interface ClientOptionState {
  /** What applies now. */
  option: ServiceOption;
  /** What they chose, if they did. */
  chosen: ServiceOption | null;
  /** The option of the agreement in force (signed, not cancelled, not superseded), if any. */
  signed: ServiceOption | null;
  /** The agreement in force, if any. */
  agreementId: string | null;
  /** True when they chose the other option after signing: a new agreement for it waits for their signature. */
  switchPending: boolean;
}

/** The newest signed agreement still in force, or null. A database without 0042 has no superseded column: then the newest signed, not cancelled. */
async function agreementInForce(db: SupabaseClient, userId: string): Promise<Row | null> {
  const { data } = await db
    .from("service_agreements")
    .select("*")
    .eq("user_id", userId)
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data as Row[] | null) ?? [];
  return rows.find((r) => r.signed_at && !r.superseded_at) ?? null;
}

export async function loadClientOption(db: SupabaseClient, userId: string): Promise<ClientOptionState> {
  const [{ data: choice }, agreement] = await Promise.all([
    db.from("client_service_options").select("service_option").eq("user_id", userId).maybeSingle(),
    agreementInForce(db, userId).catch(() => null),
  ]);
  const chosen = parseServiceOption((choice as Row | null)?.service_option);
  const signed = agreement ? optionOfTerms(agreement.terms) : null;
  return {
    option: effectiveOption({ signedOption: signed, chosenOption: chosen }),
    chosen,
    signed,
    agreementId: agreement ? String(agreement.id) : null,
    switchPending: signed !== null && chosen !== null && chosen !== signed,
  };
}

/** The option that applies to a client, in one call. Full service when nothing can be read. */
export async function clientOption(db: SupabaseClient, userId: string): Promise<ServiceOption> {
  try {
    return (await loadClientOption(db, userId)).option;
  } catch {
    return "full_service";
  }
}

/**
 * Record the client's choice. Before signing it is simply their option; after
 * signing, choosing the other one starts a switch: they sign the agreement for
 * it (/acuerdo), and signing supersedes the old one (trigger
 * service_agreements_supersede). Open "Mail them for me" requests are
 * cancelled when a DIY client moves to Complete: the team mails everything
 * from then on.
 */
export async function recordOptionChoice(
  db: SupabaseClient,
  userId: string,
  option: ServiceOption,
  via: ChosenVia,
  now: Date = new Date(),
): Promise<{ ok: true; state: ClientOptionState } | { ok: false; error: string }> {
  const before = await loadClientOption(db, userId);
  if (before.chosen === option && (before.signed === null || before.signed === option || before.switchPending)) {
    return { ok: true, state: before };
  }
  const switching = before.signed !== null && before.signed !== option;
  const { error } = await db
    .from("client_service_options")
    .upsert({ user_id: userId, service_option: option, chosen_via: switching ? "switch" : via, chosen_at: now.toISOString(), updated_at: now.toISOString() });
  if (error) return { ok: false, error: error.message };
  await db.from("service_option_changes").insert({
    user_id: userId,
    from_option: before.chosen ?? before.signed,
    to_option: option,
    chosen_via: switching ? "switch" : via,
    from_agreement_id: switching ? before.agreementId : null,
  });
  await db.from("events").insert({
    user_id: userId,
    kind: switching ? "service_option_switch_requested" : "service_option_chosen",
    payload: { from: before.option, to: option, via: switching ? "switch" : via },
  });
  return { ok: true, state: await loadClientOption(db, userId) };
}

/**
 * The upgrades (Credalti DIY → Credalti Complete) completed between two
 * dates: a signed Complete agreement that superseded a DIY one. For the
 * campaign scorecard (docs/SERVICE-OPTIONS.md, "Counting upgrades"). Each row
 * is also an `events` row of kind "service_option_upgraded", written when the
 * new agreement is signed (api/agreement/sign).
 */
export async function countUpgrades(db: SupabaseClient, from: Date, to: Date): Promise<{ upgrades: number; downgrades: number; userIds: string[] }> {
  const { data } = await db
    .from("events")
    .select("user_id, kind")
    .in("kind", ["service_option_upgraded", "service_option_downgraded"])
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  const rows = (data as Row[] | null) ?? [];
  const up = rows.filter((r) => r.kind === "service_option_upgraded");
  return {
    upgrades: up.length,
    downgrades: rows.length - up.length,
    userIds: [...new Set(up.map((r) => String(r.user_id)))],
  };
}

/**
 * Each DIY → Complete upgrade of these clients (the `service_option_upgraded`
 * events, written at signature), oldest first, for the campaign scorecard's
 * value per client (src/lib/webinars/packages.ts upgradesOf).
 */
export async function listUpgrades(db: SupabaseClient, userIds: readonly string[]): Promise<Array<{ userId: string; at: string }>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const out: Array<{ userId: string; at: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("events")
      .select("user_id, created_at")
      .eq("kind", "service_option_upgraded")
      .in("user_id", ids.slice(i, i + 200))
      .order("created_at", { ascending: true });
    if (error) throw new Error(`events: ${error.message}`);
    for (const r of (data as Row[] | null) ?? []) {
      const at = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? "");
      if (!Number.isNaN(Date.parse(at))) out.push({ userId: String(r.user_id), at: new Date(at).toISOString() });
    }
  }
  return out;
}
