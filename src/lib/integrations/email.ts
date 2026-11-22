import { BRAND } from "../brand";
import { assertClaimGuardrails } from "../compliance/guardrails";

// Email for automatic messages (src/lib/autopilot), through a transactional
// email API. No-ops when it is not configured, like the other integrations.
//
// The request is the shape Resend's /emails endpoint takes (from, to,
// subject, text, headers), which several providers accept; EMAIL_API_URL
// points it elsewhere. It has NOT been tried against a live account: send one
// to yourself before turning the channel on (docs/AUTOPILOT.md).
//
// CAN-SPAM: every automatic email carries a working unsubscribe link and the
// company's postal address, and a List-Unsubscribe header. Without either one
// the email is not sent (availabilityFromEnv keeps the channel off, and this
// refuses again).
//
// Never used for anything a person types to a client, and never SMS: text
// messages are only for login codes.

export interface EmailMessage {
  to: string;
  subject: string;
  /** The message's own words (already checked against the claim rules by the caller, and again here). */
  text: string;
  /** One-click unsubscribe link for this client. */
  unsubscribeUrl: string;
  /** The company's postal address (NEXT_PUBLIC_COMPANY_ADDRESS). */
  postalAddress: string;
  /** Idempotency key: the outbound message's dedupe key. */
  idempotencyKey: string;
}

export interface EmailResult {
  sent: boolean;
  providerRef: string | null;
  /** True when the provider says the address unsubscribed or bounced for good. */
  unsubscribed?: boolean;
}

/** The email's text with the footer the law requires. */
export function emailBody(message: Pick<EmailMessage, "text" | "unsubscribeUrl" | "postalAddress">, locale: "es" | "en" = "es"): string {
  const footer =
    locale === "es"
      ? `—\n${BRAND.name} · ${message.postalAddress}\nPara dejar de recibir estos correos: ${message.unsubscribeUrl}`
      : `—\n${BRAND.name} · ${message.postalAddress}\nTo stop receiving these emails: ${message.unsubscribeUrl}`;
  return `${message.text.trim()}\n\n${footer}\n`;
}

export async function sendEmail(message: EmailMessage, locale: "es" | "en" = "es", env: Record<string, string | undefined> = process.env): Promise<EmailResult> {
  assertClaimGuardrails(message.text, "email:autopilot");
  if (!message.unsubscribeUrl || !message.postalAddress.trim()) throw new Error("email: an automatic email needs an unsubscribe link and a postal address");
  const key = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  if (!key || !from) return { sent: false, providerRef: null };

  const res = await fetch(env.EMAIL_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey.slice(0, 200) },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: emailBody(message, locale),
      headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, providerRef: data.id ?? null };
}
