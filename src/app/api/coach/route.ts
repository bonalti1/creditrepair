import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_SYSTEM_PROMPT } from "@/lib/coach/systemPrompt";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";
import { storeMessage } from "@/lib/chat/history";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { getAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/server";

// AI Credit Coach (spec §4.3). Spanish-first. The system prompt hard-codes the
// claim guardrails; as defense in depth, output is also linted post-hoc and
// replaced with a safe fallback if it would violate them.
//
// When the caller is signed in, the question and the reply are stored
// server-side (chat_messages, source "coach") so there is a record of what the
// AI said that the browser cannot alter.

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

const SAFE_FALLBACK =
  "Puedo ayudarte a entender tu reporte y el proceso de disputa, pero no puedo prometer resultados: cada caso es distinto y los resultados varían. ¿Qué elemento de tu reporte quieres entender mejor?";

export async function POST(req: Request) {
  // Each call spends model tokens: cap it per caller.
  const limited = rateLimit(req, "coach", { limit: 20, windowMs: 5 * 60_000 });
  if (limited) return limited;

  // 40 messages of 4,000 characters is ~160 KB; anything past 256 KB is not a conversation.
  const body = await readJsonBody(req, 256_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const messages = parsed.data.messages;
  const question = messages[messages.length - 1]!;
  if (question.role !== "user" || messages[0]!.role !== "user") {
    return NextResponse.json({ error: "Conversation must start and end with a user message" }, { status: 400 });
  }

  // No key means the coach is switched off here (the demo), which is a normal
  // state and not a failure: answer 200 with no reply and let the client show
  // its own fallback. A 5xx is kept for a model call that actually failed, so
  // an outage is not hidden behind the demo's noise.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ reply: null, configured: false });

  const user = await getSessionUser().catch(() => null);

  let reply: string;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: COACH_SYSTEM_PROMPT,
      messages,
    });
    reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (error) {
    await reportError(error, { where: "api/coach", userId: user?.id });
    return NextResponse.json({ error: "Coach temporarily unavailable" }, { status: 502 });
  }

  const violations = checkClaimGuardrails(reply);
  if (violations.length > 0 || !reply) {
    console.warn("Coach guardrail violation, replacing reply:", violations.map((v) => v.rule));
    reply = SAFE_FALLBACK;
  }

  let stored = false;
  const db = user ? getAdminClient() : null;
  if (user && db) {
    const base = { userId: user.id, channel: "app" as const, source: "coach" as const };
    const savedQuestion = await storeMessage(db, { ...base, role: "user", text: question.content });
    const savedReply = await storeMessage(db, { ...base, role: "assistant", text: reply });
    stored = savedQuestion && savedReply;
  }

  return NextResponse.json({ reply, stored });
}
