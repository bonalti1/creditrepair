// Error reporting. Every unexpected failure is written to the server log as one
// JSON line (searchable in the host's log viewer) and, when ERROR_WEBHOOK_URL
// is set, posted to that webhook. The payload is `{ text }`, which Slack,
// Discord-compatible and n8n webhooks all accept, so alerts can land in a
// channel or be forwarded to WhatsApp without another vendor.
//
// No personal data goes in an alert: messages are truncated, and callers pass
// identifiers (route, user id), never report contents.

import { BRAND } from "../brand";

const lastSent = new Map<string, number>();
const THROTTLE_MS = 5 * 60 * 1000;
const MAX_KEYS = 500;

export interface ErrorContext {
  /** Where it happened, e.g. "api/attacks/approve" or "lob". */
  where: string;
  userId?: string | null;
  extra?: Record<string, string | number | boolean | null | undefined>;
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 500), stack: error.stack?.split("\n").slice(0, 6).join("\n") };
  }
  return { name: "NonError", message: String(error).slice(0, 500) };
}

/** Returns true when this alert should be sent now (same alert at most once per window). */
export function shouldAlert(key: string, now: number = Date.now()): boolean {
  const previous = lastSent.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) return false;
  if (lastSent.size >= MAX_KEYS) lastSent.clear();
  lastSent.set(key, now);
  return true;
}

export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  const info = describe(error);
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      where: context.where,
      userId: context.userId ?? undefined,
      ...context.extra,
      error: info,
    }),
  );

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  if (!shouldAlert(`${context.where}|${info.name}|${info.message}`)) return;

  const lines = [
    `${BRAND.name} error in ${context.where}`,
    `${info.name}: ${info.message}`,
    context.userId ? `user: ${context.userId}` : null,
    process.env.NEXT_PUBLIC_APP_URL ? `app: ${process.env.NEXT_PUBLIC_APP_URL}` : null,
  ].filter(Boolean);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Alerting must never take the request down with it.
  }
}

/** Test hook. */
export function resetAlertThrottle() {
  lastSent.clear();
}
