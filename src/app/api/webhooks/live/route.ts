import { NextResponse } from "next/server";
import { z } from "zod";
import { loadOpenStates } from "@/lib/compliance/stateOpenings";
import { stateStatus } from "@/lib/compliance/states";
import { cleanCampaign, FUNNEL_PLATFORMS, FUNNEL_TAGS, plainWord, type FunnelPlatform, type FunnelTag } from "@/lib/live/keywords";
import { ensureFunnelLead } from "@/lib/live/server";
import { reportError } from "@/lib/observability/errors";
import { rateLimit } from "@/lib/security/rateLimit";
import { safeEqual } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// A lead from a social comment, handed over by HighLevel or ManyChat
// (docs/LIVE-FUNNEL.md, "Instagram and Facebook comments"): someone commented
// the keyword under a post or a live, the tool sent them the /live link in a
// private message and, when it asked for their WhatsApp number, hands the lead
// here so it shows in the Lead Manager with where it came from.
//
// Trust: the same as the HighLevel webhook. The tool's request carries a
// shared secret, checked in constant time, in either header:
//   x-credalti-secret: <LIVE_FUNNEL_WEBHOOK_SECRET>
//   Authorization: Bearer <LIVE_FUNNEL_WEBHOOK_SECRET>
// Without the secret set, every delivery is refused (fails closed).
//
// Body (JSON): phone (required, a US number), and optionally firstName, email,
// state (two letters), locale ("en" | "es"), platform (instagram, facebook,
// tiktok, youtube…), source (comment, bio, ad, webinar), keyword, campaign,
// consentText (what the person agreed to in the conversation). Any field that
// looks like a Social Security number or a date of birth is dropped unread
// (its name is logged, its value never). Nothing is sent to the person from
// here: the tool already sent the link.

const SECRET_HEADER = "x-credalti-secret";
const MAX_BYTES = 16_000;

const bodySchema = z.object({
  phone: z.string().min(7).max(30),
  firstName: z.string().max(80).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  state: z.string().length(2).optional().nullable(),
  locale: z.enum(["en", "es"]).optional().nullable(),
  platform: z.string().max(40).optional().nullable(),
  source: z.string().max(40).optional().nullable(),
  keyword: z.string().max(40).optional().nullable(),
  campaign: z.string().max(80).optional().nullable(),
  consentText: z.string().min(10).max(800).optional().nullable(),
});

const NEVER = /^(ssn|social|social_?security|dob|date_?of_?birth|birth|birthdate|fecha_?de_?nacimiento|seguro_?social|card|card_?number)/i;

function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get(SECRET_HEADER);
  if (header !== null && safeEqual(header, secret)) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") && safeEqual(auth.slice(7), secret);
}

function usPhone(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+${digits}`;
  if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  return null;
}

const cleanName = (v: string | null | undefined) => (v ? v.replace(/[^\p{L}\s'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40) || null : null);

export async function POST(req: Request) {
  const limited = rateLimit(req, "webhook-live", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const secret = process.env.LIVE_FUNNEL_WEBHOOK_SECRET;
  if (!secret) {
    await reportError(new Error("LIVE_FUNNEL_WEBHOOK_SECRET is not set; the live funnel webhook refuses every delivery"), { where: "api/webhooks/live" });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!authorized(req, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await req.text().catch(() => null);
  if (raw === null || raw.length > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return NextResponse.json({ error: "Invalid lead" }, { status: 422 });
  const dropped = Object.keys(json).filter((k) => NEVER.test(k));
  const kept = Object.fromEntries(Object.entries(json as Record<string, unknown>).filter(([k]) => !NEVER.test(k) && k in bodySchema.shape));
  if (dropped.length) await reportError(new Error(`The live funnel webhook got fields that are never stored and were dropped: ${dropped.join(", ")}`), { where: "api/webhooks/live:dropped-fields" });
  const parsed = bodySchema.safeParse(kept);
  if (!parsed.success) return NextResponse.json({ error: "Invalid lead", problems: z.flattenError(parsed.error).fieldErrors, dropped }, { status: 422 });
  const lead = parsed.data;
  const phone = usPhone(lead.phone);
  if (!phone) return NextResponse.json({ error: "Invalid lead", problems: { phone: ["A US phone number is needed."] }, dropped }, { status: 422 });

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const state = lead.state?.toUpperCase() ?? null;
    if (state) {
      const status = stateStatus(state, await loadOpenStates(db));
      if (status === "blocked") return NextResponse.json({ ok: true, outcome: "state_blocked", dropped });
      if (status !== "open") {
        await db.from("waitlist").insert({ email: lead.email ?? null, phone_e164: phone, state, locale: lead.locale ?? "en", source: "highlevel" });
        return NextResponse.json({ ok: true, outcome: "waitlisted", dropped });
      }
    }
    const { data: profile } = await db.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
    if (profile) return NextResponse.json({ ok: true, outcome: "existing_client", dropped });
    const source = cleanCampaign(lead.source);
    const platform = cleanCampaign(lead.platform);
    const tag: FunnelTag = source && (FUNNEL_TAGS as readonly string[]).includes(source) ? (source as FunnelTag) : "comment";
    const keyword = plainWord(lead.keyword ?? "").replace(/[\s#\-_]/g, "");
    const now = new Date();
    const { leadId, created } = await ensureFunnelLead(db, {
      phone,
      channel: "comment",
      origin: {
        tag,
        platform: platform && (FUNNEL_PLATFORMS as readonly string[]).includes(platform) ? (platform as FunnelPlatform) : null,
        keyword: /^[A-Z0-9]{2,20}$/.test(keyword) ? keyword : null,
        campaign: cleanCampaign(lead.campaign),
        src: source ?? "comment",
      },
      name: cleanName(lead.firstName),
      locale: lead.locale ?? null,
      now,
    });
    const at = now.toISOString();
    await db
      .from("live_leads")
      .update({
        ...(cleanName(lead.firstName) ? { first_name: cleanName(lead.firstName) } : {}),
        ...(lead.email ? { email: lead.email.toLowerCase() } : {}),
        ...(state ? { state } : {}),
        ...(lead.locale ? { locale: lead.locale } : {}),
        ...(lead.consentText ? { consent_messages_at: at, consent_messages_text: lead.consentText } : {}),
      })
      .eq("lead_id", leadId);
    return NextResponse.json({ ok: true, outcome: created ? "created" : "updated", leadId, dropped });
  } catch (error) {
    await reportError(error, { where: "api/webhooks/live" });
    return NextResponse.json({ error: "Could not save the lead. Please retry." }, { status: 500 });
  }
}
