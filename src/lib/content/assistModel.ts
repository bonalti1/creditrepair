import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";
import { ASSIST_SCHEMA, type AssistCaller } from "./assist";

// The one place the content assistant calls Claude. Server only; the same
// shape as the staff drafts (src/lib/staff/draftModel.ts): the fixed
// instructions in `system`, cached; the request in the user turn; JSON out
// through structured outputs; `effort: "low"`; the API's refusal fallback.
// Without ANTHROPIC_API_KEY it returns null and the assistant writes from the
// templates. Tests replace it with a mock: no live call.

export const DEFAULT_ASSIST_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function assistModel(): string {
  const configured = process.env.CONTENT_MODEL?.trim();
  return configured && /^[a-z0-9.-]{3,60}$/.test(configured) ? configured : DEFAULT_ASSIST_MODEL;
}

/**
 * The caller, or null when the server has no key. `schema` is the JSON the
 * answer must follow: the content assistant's by default; the Video Studio's
 * script-and-shots draft passes its own (src/lib/video/assist.ts).
 */
export function contentAssistCaller(schema: object = ASSIST_SCHEMA): AssistCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return async ({ system, user }) => {
    const body = {
      model: assistModel(),
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      fallbacks: "default",
    };
    let message: Anthropic.Message;
    try {
      const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
      message = await client.messages.stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } }).finalMessage();
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      await reportError(error, { where: "content/assist", extra: { status: status ?? null } });
      return { output: null, problem: "api_error" };
    }
    if ((message.stop_reason as string | null) === "refusal") return { output: null, problem: "refusal" };
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) return { output: null, problem: "empty" };
    try {
      return { output: JSON.parse(text) as unknown, problem: null };
    } catch {
      return { output: null, problem: "invalid_json" };
    }
  };
}
