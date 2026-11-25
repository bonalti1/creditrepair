import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { consentHash, homeReadyAllowed, partnerDisplay, SHARING_CONSENT_VERSION, type ShareHow } from "@/lib/partners/sharing";
import { loadClientConsents, loadClientSharing, loadClientViews, loadPreviewCounts, partnerByCode } from "@/lib/partners/sharingServer";
import { loadClientShareRequests } from "@/lib/partners/portalServer";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getServerSupabase, getSessionUser } from "@/lib/supabase/server";

// "Quién puede ver tu progreso": the signed-in client's partners, their
// choice for each, who looked and when, and the change of a choice.
//
// GET   through the client's OWN connection: client_sharing() (the partner who
//       referred them and any they added: public facts only), their own view
//       log and consent history, the two counts for the preview, and the
//       requests a partner made to follow their progress (migration 0033).
// POST  {action: "lookup", code}: a partner's public face, to add them by code.
//       {action: "set", partnerId | code, level, locale, version, textHash}: a
//       new consent record. A grant or change must carry the hash of the text
//       the client saw, recomputed here from the partner's name in the
//       database; a revocation ("none") always goes through (the server words
//       it), so stopping is never blocked by a stale screen. Written with the
//       service role; the database fills in the previous level and the kind
//       of change, refuses a "referred" record for a partner who did not refer
//       this client, and refuses a grant to a partner who is not approved.
//       {action: "dismiss_request", id}: "Not now" on a partner's request to
//       follow their progress: the card goes away; nothing is shared.

type Row = Record<string, unknown>;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss_request"), id: z.string().uuid() }),
  z.object({ action: z.literal("lookup"), code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/) }),
  z.object({
    action: z.literal("set"),
    partnerId: z.string().uuid().optional(),
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/).optional(),
    level: z.enum(["none", "progress", "summary"]),
    locale: z.enum(["es", "en"]),
    version: z.string().max(40),
    textHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    // Also share the home-ready milestones (migration 0030): real estate agents and loan officers only.
    homeReady: z.boolean().optional(),
  }),
]);

export async function GET(req: Request) {
  const limited = rateLimit(req, "sharing-read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const [partners, views, history, counts, profile, requests] = await Promise.all([
      loadClientSharing(reader),
      loadClientViews(reader, user.id),
      loadClientConsents(reader, user.id),
      loadPreviewCounts(reader, user.id),
      reader.from("profiles").select("full_name, goal").eq("id", user.id).maybeSingle(),
      loadClientShareRequests(reader, user.id),
    ]);
    const p = (profile.data as Row | null) ?? {};
    return NextResponse.json({
      partners,
      views,
      history,
      counts,
      requests,
      me: { name: String(p.full_name ?? "").trim(), goal: typeof p.goal === "string" ? p.goal : null },
      version: SHARING_CONSENT_VERSION,
    });
  } catch (error) {
    await reportError(error, { where: "api/sharing:read", userId: user.id });
    return NextResponse.json({ error: "Could not read your sharing." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "sharing", { limit: 20, windowMs: 60_000 });
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
    if (input.action === "dismiss_request") {
      // Only the client's own request (their own connection finds it), and only once.
      const { data: mine } = await reader.from("partner_share_requests").select("id, dismissed_at").eq("id", input.id).maybeSingle();
      if (!mine) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!(mine as Row).dismissed_at) {
        const { error } = await db.from("partner_share_requests").update({ dismissed_at: new Date().toISOString() }).eq("id", input.id).eq("user_id", user.id).is("dismissed_at", null);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }

    if (input.action === "lookup") {
      const partner = await partnerByCode(reader, input.code);
      // The same answer for a code that does not exist and one that is not approved.
      if (!partner) return NextResponse.json({ error: "Not found", code: "partner_not_found" }, { status: 404 });
      return NextResponse.json({ partner: { id: partner.id, name: partner.name, company: partner.company, kind: partner.kind, logo: partner.logo } });
    }

    const linked = await loadClientSharing(reader);
    let partner: { id: string; name: string; company: string | null; kind: string } | null = null;
    let how: ShareHow;
    const known = input.partnerId ? linked.find((p) => p.id === input.partnerId) : undefined;
    if (known) {
      partner = known;
      how = known.referred ? "referred" : (known.how ?? "added_by_code");
    } else if (input.code) {
      const found = await partnerByCode(reader, input.code);
      if (!found) return NextResponse.json({ error: "Not found", code: "partner_not_found" }, { status: 404 });
      const already = linked.find((p) => p.id === found.id);
      partner = found;
      how = already?.referred ? "referred" : "added_by_code";
    } else {
      return NextResponse.json({ error: "Not found", code: "partner_not_found" }, { status: 404 });
    }

    const current = linked.find((p) => p.id === partner!.id)?.level ?? "none";
    // The home-ready choice is part of the same record: the newest one says it.
    const history = await loadClientConsents(reader, user.id);
    const currentHome = current !== "none" && (history.find((h) => h.partnerId === partner!.id)?.homeReady ?? false);
    // The record says what the client saw: a screen that did not show the home-ready line records it off.
    const homeReady = input.level !== "none" && input.homeReady === true;
    if (homeReady && !homeReadyAllowed(partner.kind as Parameters<typeof homeReadyAllowed>[0])) {
      return NextResponse.json({ error: "Home-ready milestones go only to a real estate agent or a loan officer.", code: "home_ready_not_allowed" }, { status: 409 });
    }
    // The same level from a screen without the home-ready line changes nothing.
    if (current === input.level && (input.homeReady === undefined || currentHome === homeReady)) {
      return NextResponse.json({ ok: true, unchanged: true, level: current, homeReady: currentHome });
    }

    let textHash: string;
    if (input.level === "none") {
      textHash = consentHash("none", partner, input.locale);
    } else {
      if (input.version !== SHARING_CONSENT_VERSION) return NextResponse.json({ error: "The text changed. Reload the page.", code: "version_changed" }, { status: 409 });
      textHash = consentHash(input.level, partner, input.locale, SHARING_CONSENT_VERSION, { homeReady });
      if (input.textHash !== textHash) return NextResponse.json({ error: "The text changed. Reload the page.", code: "text_changed" }, { status: 409 });
    }

    const { data, error } = await db
      .from("partner_share_consents")
      .insert({
        user_id: user.id,
        partner_id: partner.id,
        level: input.level,
        how,
        text_version: SHARING_CONSENT_VERSION,
        locale: input.locale,
        text_hash: textHash,
        partner_name_shown: partnerDisplay(partner).slice(0, 210),
        home_ready: homeReady,
      })
      .select("level, previous_level, action, home_ready, created_at")
      .single();
    if (error) {
      if (/approved partner/.test(error.message)) return NextResponse.json({ error: "This partner cannot receive it now.", code: "partner_unavailable" }, { status: 409 });
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, record: data });
  } catch (error) {
    await reportError(error, { where: "api/sharing", userId: user.id });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
