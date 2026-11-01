import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_SYSTEM_PROMPT } from "@/lib/coach/systemPrompt";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { sendWhatsAppText } from "@/lib/integrations/whatsapp";
import { getAdminClient } from "@/lib/supabase/admin";

// Inbound WhatsApp (Cloud API webhook). Closes the loop on the WhatsApp layer:
// users can reply to our notifications and reach the coach without opening the
// app. Same guardrailed coach brain as /api/coach.
// TODO: thread conversation history per phone number (stateless single-turn now).

const FALLBACK =
  "¡Gracias por tu mensaje! Para revisar tu reporte y armar tu ataque, entra a la app. Si tienes una pregunta sobre tu crédito, escríbela y tu coach te responde aquí mismo. 🙂";

export async function GET(req: Request) {
  // Meta webhook verification handshake.
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

interface InboundMessage {
  from: string;
  text?: { body: string };
  type: string;
}

export async function POST(req: Request) {
  const payload = (await req.json().catch(() => null)) as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: InboundMessage[] } }> }>;
  } | null;

  const messages =
    payload?.entry?.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? []) ?? [];

  const db = getAdminClient();

  for (const msg of messages) {
    if (msg.type !== "text" || !msg.text?.body) continue;
    const question = msg.text.body.slice(0, 2000);

    if (db) {
      await db
        .from("events")
        .insert({ kind: "whatsapp_inbound", payload: { from: msg.from, body: question } })
        .then(() => undefined, () => undefined);
    }

    let reply = FALLBACK;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 600,
          system:
            COACH_SYSTEM_PROMPT +
            "\n\nContexto: estás respondiendo por WhatsApp. Sé breve (máximo ~4 oraciones) y cálido.",
          messages: [{ role: "user", content: question }],
        });
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        if (text && checkClaimGuardrails(text).length === 0) reply = text;
      } catch {
        // keep fallback
      }
    }

    await sendWhatsAppText(msg.from, reply, "whatsapp:coach-reply").catch(() => undefined);
  }

  // Always 200 fast — Meta retries aggressively on non-200.
  return NextResponse.json({ received: messages.length });
}
