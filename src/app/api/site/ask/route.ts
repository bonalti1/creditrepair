import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { replyLanguage } from "@/lib/coach/language";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import {
  answerBeforeModel,
  answerWithoutModel,
  ASK_LIMITS,
  ASK_MODEL,
  askSystemPrompt,
  containsPersonalData,
  countAsk,
  offTopicReply,
  replyProblem,
  suggestionsAfter,
  type AskReply,
} from "@/lib/site/askAlti";

// "Ask Alti" on the public website (docs/WEBSITE.md). Anyone can call it, so:
// per-IP rate limit, a small body limit, a strict schema, personal data and
// off-topic questions answered before any model, every model reply checked
// (askAlti.ts: replyProblem) and replaced when it fails. Nothing is stored:
// no question, no reply, only counts.
//
// The key is read and the route degrades the way /api/coach does: without
// ANTHROPIC_API_KEY the answer comes from the site's own library (the FAQ and
// live.ts), which is a normal state, not an error. With a key, a model error
// also falls back to the library, so a visitor always gets an answer.

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(ASK_LIMITS.maxChars) }))
    .min(1)
    .max(ASK_LIMITS.maxMessages),
  /** The page's language: the fallback when a question doesn't say. */
  locale: z.enum(["es", "en"]).optional(),
});

/** The system prompt: the same for everyone, so it is built once and cached by the API. */
let SYSTEM: string | null = null;

export async function POST(req: Request) {
  const limited = rateLimit(req, "site-ask", { limit: ASK_LIMITS.perIp, windowMs: ASK_LIMITS.windowMs });
  if (limited) {
    countAsk("limited");
    return limited;
  }

  const body = await readJsonBody(req, ASK_LIMITS.maxBodyBytes);
  if (!body.ok) {
    countAsk("invalid");
    return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  }
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) {
    countAsk("invalid");
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const messages = parsed.data.messages;
  const question = messages[messages.length - 1]!;
  if (question.role !== "user") return NextResponse.json({ error: "The last message must be the visitor's" }, { status: 400 });
  const locale = replyLanguage(question.content, parsed.data.locale ?? "en");

  const answer = (reply: AskReply) => {
    countAsk(reply.source);
    return NextResponse.json({ ...reply, locale, suggestions: suggestionsAfter(question.content, locale) });
  };

  // Personal data, greetings and off-topic questions never reach a model.
  const early = answerBeforeModel(question.content, locale);
  if (early) return answer(early);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return answer(answerWithoutModel(question.content, locale));

  // Earlier turns that carried personal data are dropped, never forwarded.
  // (Earlier "assistant" turns come from the browser and could be forged; the
  // reply is checked all the same, so they can't get past the rules.)
  const history = messages.slice(0, -1).filter((m) => !containsPersonalData(m.content));
  const turns: Anthropic.MessageParam[] = [...history, question].map((m) => ({ role: m.role, content: m.content }));
  // The API wants the first turn to be the visitor's.
  while (turns.length > 1 && turns[0]!.role !== "user") turns.shift();

  let text = "";
  try {
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
    SYSTEM ??= askSystemPrompt();
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: ASK_MODEL,
      max_tokens: 2_000,
      // The prompt and the library are identical for every visitor: cached.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: turns,
    };
    // Effort: a short, factual chat answer needs little thinking. The installed
    // SDK (0.56) does not type output_config yet, so it is added untyped.
    const response = await client.messages.create({ ...params, output_config: { effort: "low" } } as Anthropic.MessageCreateParamsNonStreaming);
    if ((response.stop_reason as string) === "refusal") return answer(answerWithoutModel(question.content, locale, "rejected"));
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (error) {
    await reportError(error, { where: "api/site/ask" });
    return answer(answerWithoutModel(question.content, locale, "rejected"));
  }

  const problem = replyProblem(text);
  if (problem === "off_topic") return answer(offTopicReply(locale));
  if (problem) {
    console.warn("Ask Alti reply replaced:", problem);
    return answer(answerWithoutModel(question.content, locale, "rejected"));
  }
  return answer({ reply: text, source: "model" });
}
