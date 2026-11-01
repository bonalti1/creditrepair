import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// ABA disclosure acknowledgment log (spec §5). The warm intro to the mortgage
// entity may only happen AFTER a row exists here for the current disclosure
// version. RESPA §8: no per-referral compensation is stored anywhere because
// none exists by design.

const bodySchema = z.object({
  disclosureVersion: z.string().min(1),
  locale: z.enum(["es", "en"]),
});

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { error } = await supabase.from("aba_acknowledgments").insert({
    user_id: user.id,
    disclosure_version: parsed.data.disclosureVersion,
    locale: parsed.data.locale,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
