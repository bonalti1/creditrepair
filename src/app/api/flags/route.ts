import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";
import { ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/lib/compliance/attestation";

// Persistence for the review store. Runs as the signed-in user through the
// cookie-bound client, so RLS enforces ownership. The client keeps localStorage
// as an offline cache and write-through mirrors changes here.

export async function GET() {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ authenticated: false, flags: {} });

  const { data, error } = await supabase
    .from("item_flags")
    .select("state, reason, attested_at, report_items!inner(fingerprint)")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flags: Record<string, { state: string; reason?: string; attestedAt?: string }> = {};
  for (const row of data ?? []) {
    const items = row.report_items as unknown as { fingerprint: string } | { fingerprint: string }[];
    const fingerprint = Array.isArray(items) ? items[0]?.fingerprint : items.fingerprint;
    if (!fingerprint) continue;
    flags[fingerprint] = {
      state: row.state,
      reason: row.reason || undefined,
      attestedAt: row.attested_at || undefined,
    };
  }
  return NextResponse.json({ authenticated: true, flags });
}

const putSchema = z.object({
  fingerprint: z.string().min(1),
  state: z.enum(["correct", "flagged", "attested"]).nullable(),
  reason: z.string().max(500).optional(),
  locale: z.enum(["es", "en"]).default("es"),
});

export async function PUT(req: Request) {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { fingerprint, state, reason, locale } = parsed.data;

  const { data: item } = await supabase
    .from("report_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Unknown item" }, { status: 404 });

  if (state === null) {
    await supabase.from("item_flags").delete().eq("user_id", user.id).eq("item_id", item.id);
    return NextResponse.json({ ok: true });
  }

  const attesting = state === "attested";
  const { error } = await supabase.from("item_flags").upsert(
    {
      user_id: user.id,
      item_id: item.id,
      state,
      reason: reason ?? "",
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
