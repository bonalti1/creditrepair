import { NextResponse } from "next/server";
import { z } from "zod";
import { formatUsAddress, parseUsAddress } from "@/lib/mail/address";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// The signed-in client's mailing address: the return address on every letter
// (it is the client's letter; see integrations/lob.ts), and the address the
// bureaus match their file against. Only the client writes it, through their
// own connection (policy "own profile"). It must be a US address the mail
// service can read (mail/address.ts); it is stored the way it prints.
// Staff never type it: a round waits until the client has written it.

const bodySchema = z
  .object({
    line1: z.string().trim().min(3).max(64),
    line2: z.string().trim().max(64).optional().nullable(),
    city: z.string().trim().min(2).max(40),
    state: z.string().trim().min(2).max(20),
    zip: z.string().trim().regex(/^\d{5}(-?\d{4})?$/),
  })
  .strict();

export async function POST(req: Request) {
  const limited = rateLimit(req, "profile-address", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const supabase = await getServerSupabase();
  const user = await getSessionUser();
  if (!supabase || !user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error), code: "invalid" }, { status: 400 });
  const { line1, line2, city, state, zip } = parsed.data;

  const address = parseUsAddress([line1, ...(line2 ? [line2] : []), `${city}, ${state} ${zip}`]);
  if (!address.ok) return NextResponse.json({ error: address.message, code: address.problem }, { status: 422 });
  const addressLines = formatUsAddress(address.address);

  const { error } = await supabase.from("profiles").update({ address_lines: addressLines }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, addressLines });
}
