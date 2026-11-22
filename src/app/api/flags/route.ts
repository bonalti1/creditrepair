import { NextResponse } from "next/server";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/lib/compliance/attestation";
import { reasonApplies } from "@/lib/ux/disputeReason";
import { flagPutSchema, storedCheckIds, storedReasonCode } from "@/lib/ux/flagsApi";
import { checksForItem, dataChecks } from "@/lib/domain/checks";
import { loadClientReport } from "@/lib/clientCase/server";

// Persistence for the review store. Runs as the signed-in user through the
// cookie-bound client, so RLS enforces ownership. The client keeps localStorage
// as an offline cache and write-through mirrors changes here.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, flags: {} });

  // Two plain reads (the answers, then their items' fingerprints), both under the client's own row level security.
  const { data, error } = await supabase
    .from("item_flags")
    .select("state, reason, reason_code, attested_at, item_id, check_ids")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const itemIds = [...new Set((data ?? []).map((row) => row.item_id as string))];
  const { data: items, error: itemsError } =
    itemIds.length > 0 ? await supabase.from("report_items").select("id, fingerprint").in("id", itemIds) : { data: [], error: null };
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
  const fingerprintOf = new Map((items ?? []).map((item) => [item.id as string, item.fingerprint as string]));

  const flags: Record<string, { state: string; reason?: string; reasonCode?: string; attestedAt?: string; checkIds?: string[] }> = {};
  for (const row of data ?? []) {
    const fingerprint = fingerprintOf.get(row.item_id as string);
    if (!fingerprint) continue;
    flags[fingerprint] = {
      state: row.state,
      reason: row.reason || undefined,
      // Null on answers confirmed before reasons existed (migration 0008).
      reasonCode: row.reason_code || undefined,
      attestedAt: row.attested_at || undefined,
      // Empty on answers saved before migration 0021, and when the client did not tick "include".
      checkIds: Array.isArray(row.check_ids) && row.check_ids.length > 0 ? (row.check_ids as string[]) : undefined,
    };
  }
  return NextResponse.json({ authenticated: true, flags });
}

export async function PUT(req: Request) {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // The reason code is validated against the catalogue here (see flagsApi.ts).
  const parsed = flagPutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { fingerprint, state, reason, locale } = parsed.data;
  const reasonCode = storedReasonCode(parsed.data);

  const { data: item } = await supabase
    .from("report_items")
    .select("id, category")
    .eq("user_id", user.id)
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Unknown item" }, { status: 404 });

  if (state === null) {
    await supabase.from("item_flags").delete().eq("user_id", user.id).eq("item_id", item.id);
    return NextResponse.json({ ok: true });
  }

  // A reason is only valid for the kinds of item it is offered for.
  if (reasonCode && !reasonApplies(reasonCode, item.category)) {
    return NextResponse.json({ error: "This reason does not apply to this kind of item." }, { status: 400 });
  }

  // The facts to include: worked out again from the client's own report rows,
  // and kept only for checks on this item that relate to the reason picked.
  let checkIds: string[] = [];
  if (state === "attested" && parsed.data.checkIds && parsed.data.checkIds.length > 0) {
    const { report } = await loadClientReport(supabase, user.id);
    if (report) checkIds = storedCheckIds(parsed.data, checksForItem(dataChecks(report.items, report.pulledAt), fingerprint));
  }

  const attesting = state === "attested";
  const { error } = await supabase.from("item_flags").upsert(
    {
      user_id: user.id,
      item_id: item.id,
      state,
      reason: reason ?? "",
      reason_code: reasonCode,
      check_ids: checkIds,
      attested: attesting,
      // The attestation record stores the exact text the user checked (Armor #2).
      attestation_text: attesting ? ATTESTATION_TEXT[locale] : null,
      attestation_version: attesting ? ATTESTATION_VERSION : null,
      attested_at: attesting ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,item_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
