import Anthropic from "@anthropic-ai/sdk";
import { reportError } from "../observability/errors";
import { INTAKE_EFFORT, intakeModel, MAX_OUTPUT_TOKENS } from "./config";
import { logIntakeUsage, NO_USAGE, usageFrom, type ModelUsage } from "./cost";

// The one place intake calls Claude. Server only.
//
// Every call is the same shape: fixed instructions in `system` (marked for
// prompt caching, so repeat documents pay a tenth for them), the document
// itself, and a strict JSON schema the answer must follow (structured
// outputs, `output_config.format`). The answer is parsed here and handed back
// as `unknown`: the caller validates it again in code before using any of it.
//
// The installed SDK (0.56) predates `output_config`, adaptive-thinking-only
// models and server-side fallbacks, so the request body is typed loosely here
// and sent as is; the SDK passes body fields through untouched. Opus 5.5 always
// thinks (its depth is set with `output_config.effort`) and refuses a forced
// tool_choice, which is why the answer comes back as JSON text instead of a
// tool call. `fallbacks: "default"` lets the API re-run a request a safety
// classifier declined on Anthropic's recommended fallback model.
//
// Nothing here throws to the caller for a model problem: a failed call comes
// back with `output: null` and a `problem`, and the caller routes the document
// to a person.

export type IntakeTask = keyof typeof INTAKE_EFFORT;

export interface StructuredCall {
  task: IntakeTask;
  /** Fixed instructions. Identical on every call of a task, so the cache prefix matches. */
  system: string;
  /** The document blocks first, then a short text block with this request's specifics. */
  content: Anthropic.ContentBlockParam[];
  /** JSON schema of the answer (every object closed, every property required). */
  schema: Record<string, unknown>;
}

export interface ModelAnswer {
  /** The parsed JSON answer, unvalidated. Null when there is none. */
  output: unknown;
  /** Why there is no usable answer: "refusal", "max_tokens", "invalid_json", "api_error", "empty". Null when there is one. */
  problem: string | null;
  stopReason: string | null;
  model: string;
  usage: ModelUsage;
}

/** What the routes call. Tests pass their own, so no test ever reaches the network. */
export type ModelCaller = (call: StructuredCall) => Promise<ModelAnswer>;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const callClaude: ModelCaller = async (call) => {
  const model = intakeModel();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { output: null, problem: "not_configured", stopReason: null, model, usage: NO_USAGE };

  const started = Date.now();
  const body = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS[call.task],
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.content }],
    output_config: { effort: INTAKE_EFFORT[call.task], format: { type: "json_schema", schema: call.schema } },
    fallbacks: "default",
  };

  let message: Anthropic.Message;
  try {
    const client = new Anthropic({ apiKey });
    message = await client.messages
      .stream(body as unknown as Anthropic.MessageStreamParams, { headers: { "anthropic-beta": FALLBACK_BETA } })
      .finalMessage();
  } catch (error) {
    // Typed SDK errors carry the status; nothing from the document is in them.
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    await reportError(error, { where: `intake/${call.task}`, extra: { status: status ?? null } });
    logIntakeUsage({ task: call.task, model, usage: NO_USAGE, stopReason: null, ok: false, ms: Date.now() - started });
    return { output: null, problem: "api_error", stopReason: null, model, usage: NO_USAGE };
  }

  const usage = usageFrom(message.usage);
  const stopReason = (message.stop_reason as string | null) ?? null;
  const served = typeof message.model === "string" ? message.model : model;
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  let problem: string | null = null;
  let output: unknown = null;
  if (stopReason === "refusal") problem = "refusal";
  else if (stopReason === "max_tokens") problem = "max_tokens";
  else if (!text) problem = "empty";
  else {
    try {
      output = JSON.parse(text);
    } catch {
      problem = "invalid_json";
    }
  }
  logIntakeUsage({ task: call.task, model: served, usage, stopReason, ok: problem === null, ms: Date.now() - started });
  return { output: problem ? null : output, problem, stopReason, model: served, usage };
};

// ── Content blocks ──────────────────────────────────────────────────────

export function pdfBlock(bytes: Uint8Array, title: string): Anthropic.ContentBlockParam {
  return {
    type: "document",
    title,
    source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
  };
}

export function imageBlock(bytes: Uint8Array, mediaType: "image/jpeg" | "image/png"): Anthropic.ContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } };
}

export function textDocumentBlock(text: string, title: string): Anthropic.ContentBlockParam {
  return { type: "document", title, source: { type: "text", media_type: "text/plain", data: text } };
}
