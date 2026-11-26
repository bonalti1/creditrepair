import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";
import { DRAFT_SCHEMA, type DraftCaller } from "./draft";

// The one place the SEO drafts call Claude. Server only; the same shape as the
// content assistant (src/lib/content/assistModel.ts): the fixed instructions
// in `system`, cached; the request in the user turn; JSON out through
// structured outputs; the API's refusal fallback. A guide is long, so the
// effort is medium and the token budget larger. Without ANTHROPIC_API_KEY it
// returns null and Alti makes the outline only. Tests use a mock: no live call.

export const DEFAULT_SEO_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function seoModel(): string {
  const configured = process.env.SEO_MODEL?.trim();
  return configured && /^[a-z0-9.-]{3,60}$/.test(configured) ? configured : DEFAULT_SEO_MODEL;
}

export function seoDraftCaller(): DraftCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return async ({ system, user }) => {
    const body = {
      model: seoModel(),
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      fallbacks: "default",
    };
    let message: Anthropic.Message;
    try {
      const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
      message = await client.messages.stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } }).finalMessage();
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      await reportError(error, { where: "seo/draft", extra: { status: status ?? null } });
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
