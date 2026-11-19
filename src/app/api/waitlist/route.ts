import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";

// Waitlist for non-Texas visitors. v1 is Texas-only (spec §8): out-of-state
// marketing pulls in other states' CSO laws, so expansion is a legal project.
// We capture demand instead of serving it.

const bodySchema = z.object({
  email: z.string().email(),
  state: z.string().length(2),
  locale: z.enum(["es", "en"]).default("es"),
});

export async function POST(req: Request) {
  // Public, unauthenticated form: cap submissions per caller.
  const limited = rateLimit(req, "waitlist", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ ok: false, stored: false });

  const { error } = await db.from("waitlist").insert(parsed.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, stored: true });
}
