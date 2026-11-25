import { normalizeCues } from "./timeline";
import type { CaptionCue } from "./types";

// Automatic captions: a small adapter, OFF by default. It turns on only when
// the server has TRANSCRIBE_API_KEY (and, optionally, TRANSCRIBE_PROVIDER;
// "openai" is the one written so far, its Whisper endpoint). Until then the
// editor shows «Auto captions · not connected» and captions are typed or
// pasted.
//
// When it is on, the editor sends ONLY the clips' own sound (16 kHz mono WAV,
// made in the browser: render.ts buildSpeechArgs) to the server, which passes
// it to the provider and returns timed captions. Nothing else of the video
// leaves the browser. The captions come back as a draft: a person reads them,
// fixes them, and they go through the same check as every word.
//
// Every call goes through an injected fetch, so tests mock the provider.

export type TranscribeProviderId = "openai";

export interface TranscribeStatus {
  configured: boolean;
  provider: TranscribeProviderId | null;
}

export const TRANSCRIBE_LIMITS = { maxBytes: 24 * 1024 * 1024, perMemberPerHour: 20 } as const;

export function transcribeStatus(env: Record<string, string | undefined> = process.env): TranscribeStatus {
  const key = env.TRANSCRIBE_API_KEY?.trim();
  if (!key) return { configured: false, provider: null };
  const provider = (env.TRANSCRIBE_PROVIDER?.trim().toLowerCase() || "openai") as string;
  return provider === "openai" ? { configured: true, provider: "openai" } : { configured: false, provider: null };
}

export type TranscribeResult = { ok: true; cues: CaptionCue[] } | { ok: false; code: "not_configured" | "too_large" | "provider_error" | "empty" };

type Fetch = typeof fetch;

/** The provider's answer as captions: its timed segments, cleaned like any captions. */
export function cuesFromSegments(segments: unknown, duration: number, makeId: () => string): CaptionCue[] {
  if (!Array.isArray(segments)) return [];
  const cues = segments.flatMap((s) => {
    const o = s as Record<string, unknown>;
    const start = Number(o?.start);
    const end = Number(o?.end);
    const text = typeof o?.text === "string" ? o.text : "";
    return Number.isFinite(start) && Number.isFinite(end) && text.trim() ? [{ id: makeId(), start, end, text }] : [];
  });
  return normalizeCues(cues, duration);
}

/** Send the speech to the provider; timed captions back. */
export async function transcribe(
  audio: Uint8Array,
  options: { language: "en" | "es"; duration: number; makeId: () => string },
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetch = fetch,
): Promise<TranscribeResult> {
  const status = transcribeStatus(env);
  if (!status.configured) return { ok: false, code: "not_configured" };
  if (audio.byteLength === 0) return { ok: false, code: "empty" };
  if (audio.byteLength > TRANSCRIBE_LIMITS.maxBytes) return { ok: false, code: "too_large" };
  const form = new FormData();
  form.set("file", new Blob([audio as BlobPart], { type: "audio/wav" }), "speech.wav");
  form.set("model", env.TRANSCRIBE_MODEL?.trim() || "whisper-1");
  form.set("response_format", "verbose_json");
  form.set("language", options.language);
  try {
    const res = await fetcher(env.TRANSCRIBE_API_URL?.trim() || "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.TRANSCRIBE_API_KEY!.trim()}` },
      body: form,
    });
    if (!res.ok) return { ok: false, code: "provider_error" };
    const body = (await res.json()) as { segments?: unknown };
    const cues = cuesFromSegments(body.segments, options.duration, options.makeId);
    return cues.length > 0 ? { ok: true, cues } : { ok: false, code: "empty" };
  } catch {
    return { ok: false, code: "provider_error" };
  }
}
