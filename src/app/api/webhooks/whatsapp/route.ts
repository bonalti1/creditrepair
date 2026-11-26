import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { optReply, parseOptKeyword } from "@/lib/autopilot/optout";
import { recordOptChange } from "@/lib/autopilot/store";
import { BRAND } from "@/lib/brand";
import { replyLanguage } from "@/lib/coach/language";
import { coachSystemPrompt, replyLanguageLine } from "@/lib/coach/systemPrompt";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { clientOption } from "@/lib/service/server";
import { loadWhatsAppThread, storeMessage, toE164, toModelMessages } from "@/lib/chat/history";
import { CLIENT_FALLBACK_REPLIES, LEAD_GREETINGS, sendWhatsAppText } from "@/lib/integrations/whatsapp";
import { reportError } from "@/lib/observability/errors";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { safeEqual, verifyMetaSignature } from "@/lib/security/signatures";
import { getAdminClient } from "@/lib/supabase/admin";

// Inbound WhatsApp (Cloud API webhook). Closes the loop on the WhatsApp layer:
// users can reply to our notifications and reach the coach without opening the
// app. Same guardrailed coach brain as /api/coach, with the last day of the
// thread as context.
//
// Trust: Meta signs each delivery with the app secret. Without a valid
// signature anyone who knows this URL could make the AI message arbitrary
// phone numbers on our account, so once WhatsApp is configured the endpoint
// refuses unsigned or wrongly signed requests.

// AI disclosure: every automated reply is visibly marked as AI (the client
// always knows). A human teammate takes over threads without the 🤖 prefix.
// The two fixed texts (the reply when the coach is unavailable, and the lead
// greeting) live with the rest of the WhatsApp copy in integrations/whatsapp.ts.
const AI_PREFIX = "🤖 ";

// Sales comes first. Someone writing in who is not yet a customer (no profile
// with that phone number) is a lead, and leads are handled by a person. The assistant
// introduces itself once, says a teammate will write, and then stays quiet so
// it never talks over the salesperson. Customers get the assistant as before.
// Set WHATSAPP_LEAD_REPLIES=ai to let the assistant answer leads too; it is then told
// that the person is not a client yet, so it explains the service and leaves
// prices and everything else to the team.
const LEAD_GREETING_WINDOW_MS = 24 * 60 * 60_000;

// Per-sender cap on AI replies: 12 in 5 minutes is far above a real
// conversation and stops a loop or a script from running up the model bill.
const SENDER_LIMIT = 12;
const SENDER_WINDOW_MS = 5 * 60_000;

// Meta redelivers on slow responses. The database enforces "once" through the
// unique external_id; this in-memory set covers the no-database case.
const seenIds = new Set<string>();
function firstTimeSeen(id: string): boolean {
  if (seenIds.has(id)) return false;
  if (seenIds.size > 5000) seenIds.clear();
  seenIds.add(id);
  return true;
}

/** Tell the sales channel a new lead wrote in. Optional: needs SALES_WEBHOOK_URL. */
async function notifySales(phoneE164: string): Promise<void> {
  const url = process.env.SALES_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Nuevo prospecto por WhatsApp: ${phoneE164}. ${BRAND.assistant} ya lo saludó; falta que le escriba una persona.` }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // The lead is still in the WhatsApp inbox; a missed ping must not fail the webhook.
  }
}

export async function GET(req: Request) {
  // Meta webhook verification handshake.
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && safeEqual(token, expected)) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

interface InboundMessage {
  id?: string;
  from: string;
  text?: { body: string };
  type: string;
  /** A click-to-WhatsApp ad's referral on the first message: source_id is the Meta ad's id. */
  referral?: { source_type?: string; source_id?: string };
}

/**
 * A new number that wrote from a click-to-WhatsApp ad: its lead starts with
 * the ad in its first touch (docs/ADS.md), before the message's own trigger
 * creates it. First touch wins: a lead that already exists is left as it is.
 * Only the ad's id is kept, never the referral's other fields.
 */
async function leadFromAd(db: NonNullable<ReturnType<typeof getAdminClient>>, phone: string, msg: InboundMessage): Promise<void> {
  const adId = msg.referral?.source_type === "ad" ? String(msg.referral.source_id ?? "").trim() : "";
  if (!/^\d{3,25}$/.test(adId)) return;
  const at = new Date().toISOString();
  await db
    .from("leads")
    .upsert({ phone_e164: phone, source: "whatsapp", first_touch: { channel: "whatsapp", at, ad: { adId, via: "ctwa" } }, created_at: at }, { onConflict: "phone_e164", ignoreDuplicates: true })
    .then(() => undefined, () => undefined);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  // Real deliveries are a few kilobytes.
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const whatsappConfigured = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (appSecret) {
    if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (whatsappConfigured) {
    // Live credentials but no way to authenticate the caller: fail closed.
    await reportError(new Error("WHATSAPP_APP_SECRET is not set; inbound WhatsApp webhook is refusing requests"), {
      where: "api/webhooks/whatsapp",
    });
    return NextResponse.json({ error: "Webhook signature verification is not configured" }, { status: 503 });
  }

  let payload: { entry?: Array<{ changes?: Array<{ value?: { messages?: InboundMessage[] } }> }> } | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  const messages =
    payload?.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];

  const db = getAdminClient();
  let handled = 0;

  for (const msg of messages) {
    if (msg.type !== "text" || !msg.text?.body) continue;
    if (msg.id && !firstTimeSeen(msg.id)) continue;

    const question = msg.text.body.slice(0, 2000);
    const phone = toE164(msg.from);
    if (!phone) continue;

    let userId: string | null = null;
    /** The client's saved language (profiles.locale); null for a lead. */
    let savedLocale: string | null = null;
    if (db) {
      const { data: profile } = await db.from("profiles").select("id, locale").eq("phone_e164", phone).maybeSingle();
      userId = (profile?.id as string | undefined) ?? null;
      savedLocale = (profile?.locale as string | undefined) ?? null;
      if (!userId) await leadFromAd(db, phone, msg);

      const fresh = await storeMessage(db, {
        userId,
        phoneE164: phone,
        channel: "whatsapp",
        role: "user",
        source: "journey",
        text: question,
        externalId: msg.id ?? null,
      });
      // A failed insert with an id is a redelivery we already answered.
      if (!fresh && msg.id) continue;

      await db
        .from("events")
        .insert({ user_id: userId, kind: "whatsapp_inbound", payload: { from: msg.from } })
        .then(() => undefined, () => undefined);
    }

    // "BAJA" / "STOP" (or "ALTA" / "START"): recorded and answered once, and
    // nothing else is done with the message (autopilot/optout.ts). Honored by
    // every automatic message from the next run on.
    const opt = parseOptKeyword(question);
    if (opt) {
      try {
        if (db) {
          await recordOptChange(db, { userId, phone, kind: opt.kind, channel: "whatsapp", keyword: opt.keyword });
        }
        const locale = opt.keyword === "STOP" || opt.keyword === "START" || opt.keyword === "UNSUBSCRIBE" ? "en" : "es";
        await sendWhatsAppText(phone.slice(1), optReply(opt.kind, locale), "whatsapp:opt-keyword");
        handled += 1;
      } catch (error) {
        await reportError(error, { where: "api/webhooks/whatsapp:opt", userId });
      }
      continue;
    }

    if (!checkRateLimit(`whatsapp:${phone}`, SENDER_LIMIT, SENDER_WINDOW_MS).allowed) continue;

    // Answer in the language of the message; when it does not say, the client's saved language (English otherwise).
    const language = replyLanguage(question, savedLocale === "es" ? "es" : "en");

    const isLead = userId === null;
    if (isLead && process.env.WHATSAPP_LEAD_REPLIES !== "ai") {
      // One greeting per lead per day; after that the thread belongs to sales.
      const firstToday = checkRateLimit(`whatsapp-lead:${phone}`, 1, LEAD_GREETING_WINDOW_MS).allowed;
      const alreadyGreeted = db
        ? (await loadWhatsAppThread(db, phone, { limit: 20 })).some((turn) => turn.role === "assistant")
        : false;
      if (firstToday && !alreadyGreeted) {
        try {
          await sendWhatsAppText(phone.slice(1), AI_PREFIX + LEAD_GREETINGS[language], "whatsapp:lead-greeting");
          if (db) {
            await storeMessage(db, {
              phoneE164: phone,
              channel: "whatsapp",
              role: "assistant",
              source: "journey",
              text: LEAD_GREETINGS[language],
            });
            await db
              .from("events")
              .insert({ kind: "whatsapp_lead", payload: { from: msg.from } })
              .then(() => undefined, () => undefined);
          }
          await notifySales(phone);
          handled += 1;
        } catch (error) {
          await reportError(error, { where: "api/webhooks/whatsapp:lead" });
        }
      }
      continue;
    }

    let reply = CLIENT_FALLBACK_REPLIES[language];
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const thread = db ? await loadWhatsAppThread(db, phone) : [];
        const context = toModelMessages(
          thread.length > 0 ? thread : [{ role: "user", text: question }],
        );
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 600,
          system:
            coachSystemPrompt(db && userId ? await clientOption(db, userId) : undefined, savedLocale === "es" ? "es" : "en") +
            `\n\n${replyLanguageLine(language)}` +
            "\n\nContexto: estás respondiendo por WhatsApp. Sé breve (máximo ~4 oraciones) y cálido." +
            (isLead
              ? " Esta persona todavía no es cliente: explícale cómo funciona el servicio, no des precios y dile que una persona del equipo le responde aquí mismo."
              : ""),
          messages: context.length > 0 ? context : [{ role: "user", content: question }],
        });
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        if (text && checkClaimGuardrails(text).length === 0) reply = text;
      } catch (error) {
        await reportError(error, { where: "api/webhooks/whatsapp:coach", userId });
      }
    }

    try {
      await sendWhatsAppText(phone.slice(1), AI_PREFIX + reply, "whatsapp:coach-reply");
      if (db) {
        await storeMessage(db, {
          userId,
          phoneE164: phone,
          channel: "whatsapp",
          role: "assistant",
          source: "coach",
          text: reply,
        });
      }
      handled += 1;
    } catch (error) {
      await reportError(error, { where: "api/webhooks/whatsapp:send", userId });
    }
  }

  // Always 200 fast once authenticated — Meta retries aggressively on non-200.
  return NextResponse.json({ received: messages.length, handled });
}
