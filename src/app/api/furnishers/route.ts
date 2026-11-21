import { NextResponse } from "next/server";
import { checkFurnisherInput, normalizeCompanyName } from "@/lib/mail/furnishers";
import { furnisherFromRow } from "@/lib/mail/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getStaffAccess, requireCapability } from "@/lib/staff/access";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// Staff only: add or change one company in the furnisher address book.
//
// The same check the form runs (checkFurnisherInput) runs here against the
// book as it is in the database: a readable US address, a source and a date
// for a verified one, one company per name. Written with the service role;
// the database writes the history line itself (trigger furnishers_history,
// migration 0013), with the teammate's name, so no save goes unrecorded.

export async function POST(req: Request) {
  const limited = rateLimit(req, "furnishers", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const access = await getStaffAccess();
  if (access === "demo") return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  if (access !== "allowed") return NextResponse.json({ error: "Staff only" }, { status: 403 });
  // The role decides, here on the server: the people who send letters keep the address book (src/lib/staff/permissions.ts).
  const role = await requireCapability("rounds.send");
  if (!role.ok) return role.response;
  const staff = await getSessionUser();
  const db = getAdminClient();
  if (!db || !staff) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const { by, ...input } = (body.data ?? {}) as Record<string, unknown> & { by?: unknown };
  const author = (typeof by === "string" ? by : "").replace(/\s+/g, " ").trim().slice(0, 80) || "equipo";

  try {
    const { data: rows, error } = await db.from("furnishers").select("*");
    if (error) throw new Error(error.message);
    const book = (rows ?? []).map((row) => furnisherFromRow(row as Record<string, unknown>));
    const check = checkFurnisherInput(input as never, book, new Date());
    if (!check.ok) return NextResponse.json({ error: check.problems.join(" "), problems: check.problems }, { status: 422 });

    const { id, ...fields } = check.value;
    const row = {
      name: fields.name,
      normalized_name: normalizeCompanyName(fields.name),
      aliases: fields.aliases,
      address_lines: fields.addressLines,
      phone: fields.phone,
      notes: fields.notes,
      source: fields.source,
      verified_on: fields.verifiedOn,
      updated_by: staff.id,
      updated_by_name: author,
    };
    const result = id
      ? await db.from("furnishers").update(row).eq("id", id).select("*").maybeSingle()
      : await db.from("furnishers").insert(row).select("*").single();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, entry: furnisherFromRow(result.data as Record<string, unknown>) });
  } catch (error) {
    await reportError(error, { where: "api/furnishers", userId: staff.id });
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
