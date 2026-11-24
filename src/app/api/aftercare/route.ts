import { NextResponse } from "next/server";
import { z } from "zod";
import { introHash, INTRO_CONSENT_VERSION } from "@/lib/aftercare/connect";
import { graduationStatus } from "@/lib/aftercare/graduation";
import { AFTERCARE_MARK_KEYS } from "@/lib/aftercare/plan";
import { loadAftercare, recordGraduation } from "@/lib/aftercare/server";
import { notifyTeam } from "@/lib/agreement/server";
import { BRAND } from "@/lib/brand";
import { loadClientCaseFacts } from "@/lib/case/server";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// After-care for the signed-in client (docs/AFTERCARE.md, migration 0030).
//
// GET   through the client's OWN connection: the kind of number they have
//       (never the number), their "Mark as done" marks, their graduation, the
//       partner offers (only while the marketplace is on, cheapest first), who
//       "Connect me with a loan officer" goes to, and any open request.
// POST  {action: "id_type", idType}: saved on their own profile (RLS).
//       {action: "mark", key, done}: one append-only mark.
//       {action: "graduate", keepTips, locale}: finishing the program. The
//         server decides the reason from the case ("disputes_done" or
//         "client_chose"); the database ends the service on the agreement in
//         the same transaction, so no letter and no charge follows.
//       {action: "tips", keepTips}: the free after-care tips, on or off.
//       {action: "intro", partnerId, locale, version, textHash}: the
//         introduction, with the hash of the text the client saw.
//       {action: "withdraw_intro"}: withdraws the open request.

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("id_type"), idType: z.enum(["ssn", "itin"]) }).strict(),
  z.object({ action: z.literal("mark"), key: z.enum(AFTERCARE_MARK_KEYS), done: z.boolean() }).strict(),
  z.object({ action: z.literal("graduate"), keepTips: z.boolean(), locale: z.enum(["es", "en"]), markedStillReported: z.number().int().min(0).max(10_000).optional() }).strict(),
  z.object({ action: z.literal("tips"), keepTips: z.boolean() }).strict(),
  z.object({ action: z.literal("intro"), partnerId: z.string().uuid(), locale: z.enum(["es", "en"]), version: z.string().max(40), textHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  z.object({ action: z.literal("withdraw_intro") }).strict(),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "aftercare-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const reader = await getServerSupabase();
  const user = await getSessionUser();
  if (!reader || !user) return NextResponse.json({ authenticated: false });
  try {
    return NextResponse.json({ authenticated: true, ...(await loadAftercare(reader, user.id)) });
  } catch (error) {
    await reportError(error, { where: "api/aftercare:read", userId: user.id });
    return NextResponse.json({ error: "Could not read your plan." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "aftercare", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const reader = await getServerSupabase();
  const db = getAdminClient();
  if (!reader || !db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await readJsonBody(req, 2_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  try {
    switch (input.action) {
      case "id_type": {
        // Their own profile, under row level security. Only the kind is stored.
        const { error } = await reader.from("profiles").update({ id_type: input.idType }).eq("id", user.id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, idType: input.idType });
      }
      case "mark": {
        const { error } = await db.from("aftercare_marks").insert({ user_id: user.id, item_key: input.key, done: input.done });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case "graduate": {
        const state = await loadAftercare(reader, user.id);
        if (state.graduation) return NextResponse.json({ ok: true, graduation: state.graduation, unchanged: true });
        const facts = await loadClientCaseFacts(reader, user.id);
        const status = graduationStatus({ facts, markedStillReported: input.markedStillReported ?? 0, graduation: null, now: new Date() });
        if (status.kind === "not_available") {
          return NextResponse.json({ error: "Finishing is available once your team can work on your case.", code: "not_available" }, { status: 409 });
        }
        const reason = status.kind === "ready" ? "disputes_done" : "client_chose";
        const graduation = await recordGraduation(db, user.id, reason, input.keepTips, input.locale);
        await notifyTeam(`${BRAND.name}: un cliente terminó su programa (${reason === "disputes_done" ? "disputas terminadas" : "eligió terminar"}). No se envían más cartas ni se crean cobros. Cuenta: ${user.id}`).catch(() => undefined);
        return NextResponse.json({ ok: true, graduation });
      }
      case "tips": {
        const { data, error } = await db.from("program_completions").update({ keep_tips: input.keepTips }).eq("user_id", user.id).select("user_id");
        if (error) throw new Error(error.message);
        if (((data as unknown[] | null) ?? []).length === 0) return NextResponse.json({ error: "Not finished yet", code: "not_graduated" }, { status: 409 });
        return NextResponse.json({ ok: true });
      }
      case "intro": {
        const state = await loadAftercare(reader, user.id);
        const partner = state.intro.partners.find((p) => p.id === input.partnerId);
        if (!partner) return NextResponse.json({ error: "Not found", code: "partner_not_found" }, { status: 404 });
        if (state.introRequest) return NextResponse.json({ error: "You already have a request open.", code: "already_open" }, { status: 409 });
        if (input.version !== INTRO_CONSENT_VERSION || input.textHash !== introHash(partner, input.locale)) {
          return NextResponse.json({ error: "The text changed. Reload the page.", code: "text_changed" }, { status: 409 });
        }
        const { data, error } = await db
          .from("loan_officer_requests")
          .insert({
            user_id: user.id,
            partner_id: partner.id,
            how: state.intro.how,
            text_version: INTRO_CONSENT_VERSION,
            locale: input.locale,
            text_hash: input.textHash,
            partner_name_shown: (partner.company ? `${partner.name}, ${partner.company}` : partner.name).slice(0, 210),
          })
          .select("id, created_at")
          .single();
        if (error) {
          if (/not approved|not accepting|did not refer/.test(error.message)) return NextResponse.json({ error: "This loan officer cannot take it now.", code: "partner_unavailable" }, { status: 409 });
          throw new Error(error.message);
        }
        await notifyTeam(`${BRAND.name}: un cliente pidió que lo presentemos con ${partner.name}. Cuenta: ${user.id}`).catch(() => undefined);
        return NextResponse.json({ ok: true, request: data });
      }
      case "withdraw_intro": {
        const { error } = await db.from("loan_officer_requests").update({ withdrawn_at: new Date().toISOString() }).eq("user_id", user.id).is("withdrawn_at", null);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    await reportError(error, { where: `api/aftercare:${input.action}`, userId: user.id });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
