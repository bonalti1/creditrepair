import { NextResponse } from "next/server";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/lib/compliance/attestation";
import { reasonApplies } from "@/lib/ux/disputeReason";
import { flagPutSchema, storedReasonCode } from "@/lib/ux/flagsApi";

// Persistence for the review store. Runs as the signed-in user through the
// cookie-bound client, so RLS enforces ownership. The client keeps localStorage
// as an offline cache and write-through mirrors changes here.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, flags: {} });

  const { data, error } = await supabase
    .from("item_flags")
    .select("state, reason, reason_code, attested_at, report_items!inner(fingerprint)")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flags: Record<string, { state: string; reason?: string; reasonCode?: string; attestedAt?: string }> = {};
  for (const row of data ?? []) {
    const items = row.report_items as unknown as { fingerprint: string } | { fingerprint: string }[];
    const fingerprint = Array.isArray(items) ? items[0]?.fingerprint : items.fingerprint;
    if (!fingerprint) continue;
    flags[fingerprint] = {
      state: row.state,
      reason: row.reason || undefined,
      // Null on answers confirmed before reasons existed (migration 0008).
      reasonCode: row.reason_code || undefined,
      attestedAt: row.attested_at || undefined,
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

  const attesting = state === "attested";
  const { error } = await supabase.from("item_flags").upsert(
    {
      user_id: user.id,
      item_id: item.id,
      state,
      reason: reason ?? "",
      reason_code: reasonCode,
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
