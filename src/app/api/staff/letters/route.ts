import { NextResponse } from "next/server";
import { z } from "zod";
import { discardDraft, lettersBodySchema, listLetterVersions, recordDecision, saveDraft, sendToAttorney } from "@/lib/letters/versions/server";
import { unapprovedLettersAllowed } from "@/lib/letters/versions/versions";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { getServerSupabase } from "@/lib/supabase/server";

// The letter editor (/equipo/cartas), for administrators only
// (requireCapability("letters.edit")):
//
//   GET    every version of every letter, read through the member's own
//          connection ("admin read letter versions", migration 0019).
//   POST   save_draft | discard_draft | send_to_attorney | record_decision.
//          Written with the service role; the text is validated again here
//          (validateLetterSource) whatever the screen showed, and the table's
//          trigger freezes a version once it is sent to the attorney.

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-letters-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const allowed = await requireCapability("letters.edit");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    return NextResponse.json({ versions: await listLetterVersions(reader), allowUnapproved: unapprovedLettersAllowed() });
  } catch (error) {
    await reportError(error, { where: "api/staff/letters", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not read the letter versions." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-letters", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 40_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = lettersBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const allowed = await requireCapability("letters.edit");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const actor = { userId: member.userId, name: member.name };
  const input = parsed.data;

  try {
    const result =
      input.action === "save_draft"
        ? await saveDraft(db, input, actor)
        : input.action === "discard_draft"
          ? await discardDraft(db, input.id)
          : input.action === "send_to_attorney"
            ? await sendToAttorney(db, input.templateKeys, actor)
            : await recordDecision(db, input.id, input, actor);
    if (!result.ok) return NextResponse.json({ ok: false, problems: result.problems }, { status: result.status });
    return NextResponse.json({ ok: true, result: result.value });
  } catch (error) {
    await reportError(error, { where: "api/staff/letters", userId: member.userId, extra: { action: input.action } });
    return NextResponse.json({ error: "Could not save. Nothing was changed." }, { status: 500 });
  }
}
