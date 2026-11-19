import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_SYSTEM_PROMPT } from "@/lib/coach/systemPrompt";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { loadWhatsAppThread, storeMessage, toE164, toModelMessages } from "@/lib/chat/history";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";
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
const AI_PREFIX = "🤖 ";
const FALLBACK =
  "¡Gracias por tu mensaje! Soy Capi, el asistente de IA de CreditCapi. Para revisar tu reporte y armar tu ataque, entra a la app. Si tienes una pregunta sobre tu crédito, escríbela y te respondo aquí mismo. Si prefieres hablar con una persona del equipo, dilo y te conectamos. 🙂";

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
}

export async function POST(req: Request) {
  const rawBody = await req.text();

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
    if (db) {
      const { data: profile } = await db.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
      userId = (profile?.id as string | undefined) ?? null;

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

    if (!checkRateLimit(`whatsapp:${phone}`, SENDER_LIMIT, SENDER_WINDOW_MS).allowed) continue;

    let reply = FALLBACK;
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
            COACH_SYSTEM_PROMPT +
            "\n\nContexto: estás respondiendo por WhatsApp. Sé breve (máximo ~4 oraciones) y cálido.",
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
