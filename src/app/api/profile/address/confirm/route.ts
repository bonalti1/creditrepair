import { NextResponse } from "next/server";
import { z } from "zod";
import { recordResolution } from "@/lib/autopilot/resolutions";
import { formatUsAddress, parseUsAddress } from "@/lib/mail/address";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/config";
import { getSessionUser } from "@/lib/supabase/server";

// "Confirmar dirección": the signed-in client confirms their own mailing
// address after the post office's data could not confirm it (before a round
// was mailed, or when a letter came back; mail/verifyServer.ts). One tap
// accepts what the post office suggests; or they correct it. Only the client
// answers: the team never types a client's address.
//
// GET   the open request, if any: the address on file and the suggestion.
// POST  { use: "suggestion" } or { use: "current" } or { use: "corrected", line1, line2, city, state, zip }.
//       The address is saved on the profile and the request is answered. The
//       next mailing checks it again (and a second failure goes to a person).

type Row = Record<string, unknown>;
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

const bodySchema = z.discriminatedUnion("use", [
  z.object({ use: z.literal("suggestion") }).strict(),
  z.object({ use: z.literal("current") }).strict(),
  z
    .object({
      use: z.literal("corrected"),
      line1: z.string().trim().min(3).max(64),
      line2: z.string().trim().max(64).optional().nullable(),
      city: z.string().trim().min(2).max(40),
      state: z.string().trim().min(2).max(20),
      zip: z.string().trim().regex(/^\d{5}(-?\d{4})?$/),
    })
    .strict(),
]);

/** DEMO: an invented request, so the screen can be seen. Nobody's address. */
const DEMO_REQUEST = {
  id: "demo-address",
  finding: "ambiguous" as const,
  reason: "verification" as const,
  inputLines: ["4410 Calle Ejemplo Interior", "Houston, TX 77002"],
  suggestionLines: ["4410 Calle Ejemplo", "Apt 1", "Houston, TX 77002-4410"],
  requestedAt: "2026-11-21T15:00:00.000Z",
};

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ demo: true, request: DEMO_REQUEST });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const { data } = await db.from("address_confirmations").select("*").eq("user_id", user.id).is("confirmed_at", null).is("closed_at", null).limit(1);
  const row = ((data as Row[] | null) ?? [])[0];
  if (!row) return NextResponse.json({ demo: false, request: null });
  return NextResponse.json({
    demo: false,
    request: {
      id: String(row.id),
      finding: row.finding,
      reason: row.reason,
      inputLines: lines(row.input_lines),
      suggestionLines: lines(row.suggestion_lines),
      requestedAt: row.requested_at,
    },
  });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "profile-address-confirm", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error), code: "invalid" }, { status: 400 });

  const choose = (request: { inputLines: string[]; suggestionLines: string[] }): string[] | { error: string } => {
    const input = parsed.data;
    const raw =
      input.use === "suggestion"
        ? request.suggestionLines
        : input.use === "current"
          ? request.inputLines
          : [input.line1, ...(input.line2 ? [input.line2] : []), `${input.city}, ${input.state} ${input.zip}`];
    if (raw.length === 0) return { error: "no_suggestion" };
    const address = parseUsAddress(raw);
    return address.ok ? formatUsAddress(address.address) : { error: address.problem };
  };

  if (isDemoMode()) {
    const chosen = choose(DEMO_REQUEST);
    if (!Array.isArray(chosen)) return NextResponse.json({ error: "We could not read that address.", code: chosen.error }, { status: 422 });
    return NextResponse.json({ ok: true, demo: true, addressLines: chosen });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const { data } = await db.from("address_confirmations").select("*").eq("user_id", user.id).is("confirmed_at", null).is("closed_at", null).limit(1);
    const row = ((data as Row[] | null) ?? [])[0];
    if (!row) return NextResponse.json({ error: "Nothing to confirm.", code: "no_request" }, { status: 404 });
    const chosen = choose({ inputLines: lines(row.input_lines), suggestionLines: lines(row.suggestion_lines) });
    if (!Array.isArray(chosen)) return NextResponse.json({ error: "We could not read that address.", code: chosen.error }, { status: 422 });

    const now = new Date();
    const { error: profileError } = await db.from("profiles").update({ address_lines: chosen }).eq("id", user.id);
    if (profileError) throw new Error(profileError.message);
    const { error } = await db
      .from("address_confirmations")
      .update({ confirmed_at: now.toISOString(), confirmed_lines: chosen })
      .eq("id", String(row.id))
      .is("confirmed_at", null);
    if (error) throw new Error(error.message);
    await db.from("events").insert({ user_id: user.id, kind: "address_confirmed", payload: { requestId: String(row.id), use: parsed.data.use } });
    await recordResolution(db, { userId: user.id, kind: "address_confirmed", detail: { requestId: String(row.id), use: parsed.data.use }, dedupeKey: `address_confirmed:${String(row.id)}`, at: now });
    return NextResponse.json({ ok: true, addressLines: chosen });
  } catch (error) {
    await reportError(error, { where: "api/profile/address/confirm", userId: user.id });
    return NextResponse.json({ error: "Could not save your address. Please try again." }, { status: 500 });
  }
}
