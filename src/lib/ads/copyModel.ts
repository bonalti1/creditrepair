import Anthropic from "@anthropic-ai/sdk";
import { assistModel } from "../content/assistModel";
import { reportError } from "../observability/errors";
import { AD_COPY_SCHEMA, type AdCopyCaller } from "./copy";

// The one place the ad copy assistant calls Claude. Server only, the same
// shape as the content assistant (src/lib/content/assistModel.ts) and the
// staff drafts: the fixed instructions in `system`, cached; the request in the
// user turn; JSON out through structured outputs; `effort: "low"`; the API's
// refusal fallback. The model is the content assistant's (CONTENT_MODEL, else
// Claude Opus 5.5). Without ANTHROPIC_API_KEY it returns null and the
// assistant writes from the pre-checked templates. Tests use a mock.

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function adCopyCaller(): AdCopyCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return async ({ system, user }) => {
    const body = {
      model: assistModel(),
      max_tokens: 6000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: AD_COPY_SCHEMA } },
      fallbacks: "default",
    };
    let message: Anthropic.Message;
    try {
      const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
      message = await client.messages.stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } }).finalMessage();
    } catch (error) {
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      await reportError(error, { where: "ads/copy", extra: { status: status ?? null } });
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
