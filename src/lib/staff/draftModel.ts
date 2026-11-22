import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";
import type { DraftCaller } from "./drafts";

// The one place a staff draft calls Claude. Server only.
//
// The same shape as AI intake (src/lib/intake/claude.ts): fixed instructions
// in `system`, marked for prompt caching (identical on every draft); the
// case's facts and the question in the user turn; the answer as JSON through
// structured outputs (`output_config.format`). The installed SDK (0.56)
// predates `output_config` and `fallbacks`, so the body is typed loosely and
// sent as is, as intake does. Opus 5.5 always thinks; `effort: "low"` keeps a
// short reply quick and cheap. `fallbacks: "default"` lets the API re-run a
// request a safety classifier declined on its recommended fallback model.
//
// Without ANTHROPIC_API_KEY nothing is sent anywhere: the caller gets
// "not_configured" and the screen says there is no draft, and why.
// Every answer is checked again by the caller (drafts.ts) before anyone sees it.

/** DRAFT_MODEL overrides it (for example to try a cheaper one). */
export const DEFAULT_DRAFT_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function draftModel(): string {
  const configured = process.env.DRAFT_MODEL?.trim();
  return configured && /^[a-z0-9.-]{3,60}$/.test(configured) ? configured : DEFAULT_DRAFT_MODEL;
}

const SCHEMA = {
  type: "object",
  properties: { reply: { type: "string", description: "The drafted reply to the client, ready to send." } },
  required: ["reply"],
  additionalProperties: false,
};

export const callDraftModel: DraftCaller = async (call) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { reply: null, problem: "not_configured" };
  const body = {
    model: draftModel(),
    max_tokens: 8000,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
  };
  let message: Anthropic.Message;
  try {
    const client = new Anthropic({ apiKey });
    message = await client.messages
      .stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } })
      .finalMessage();
  } catch (error) {
    // Typed SDK errors carry the status; the client's words are not in them.
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    await reportError(error, { where: "staff/draft", extra: { status: status ?? null } });
    return { reply: null, problem: "api_error" };
  }
  if ((message.stop_reason as string | null) === "refusal") return { reply: null, problem: "refusal" };
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) return { reply: null, problem: "empty" };
  try {
    const parsed = JSON.parse(text) as { reply?: unknown };
    return typeof parsed.reply === "string" && parsed.reply.trim() ? { reply: parsed.reply, problem: null } : { reply: null, problem: "empty" };
  } catch {
    return { reply: null, problem: "invalid_json" };
  }
};
