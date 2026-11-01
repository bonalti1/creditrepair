import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { COACH_SYSTEM_PROMPT } from "@/lib/coach/systemPrompt";
import { checkClaimGuardrails } from "@/lib/compliance/guardrails";

// AI Credit Coach (spec §4.3). Spanish-first. The system prompt hard-codes the
// claim guardrails; as defense in depth, output is also linted post-hoc and
// replaced with a safe fallback if it would violate them.

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

const SAFE_FALLBACK =
  "Puedo ayudarte a entender tu reporte y el proceso de disputa, pero no puedo prometer resultados: cada caso es distinto y los resultados varían. ¿Qué elemento de tu reporte quieres entender mejor?";

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Coach not configured (ANTHROPIC_API_KEY missing)" }, { status: 503 });

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: COACH_SYSTEM_PROMPT,
    messages: parsed.data.messages,
  });

  let reply = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const violations = checkClaimGuardrails(reply);
  if (violations.length > 0) {
    console.warn("Coach guardrail violation, replacing reply:", violations);
    reply = SAFE_FALLBACK;
  }

  return NextResponse.json({ reply });
}
