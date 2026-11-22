import type { Channel, ChannelAvailability } from "./types";

// Which channel an automatic message goes on, decided before anything is sent.
//
//   1. WhatsApp, the client's channel. Inside 24 hours of the client's last
//      WhatsApp message the words may go as plain text; outside it, only as a
//      template Meta approved (templates.ts). An unapproved template never
//      goes on WhatsApp outside the window.
//   2. Email, when WhatsApp cannot carry it and the client gave an email.
//      Every automatic email carries an unsubscribe link and the company's
//      postal address (CAN-SPAM), so email counts as available only when both
//      can be written (availabilityFromEnv).
//   3. Otherwise nothing goes, and the item stays a person's (the console says why).
//
// Never SMS. Carriers reject credit-repair text campaigns, so text messages
// are used only for login codes (Supabase Auth), never by the autopilot.

export const WHATSAPP_WINDOW_HOURS = 24;

export type ChannelChoice =
  | { channel: "whatsapp"; mode: "text" | "template" }
  | { channel: "email" }
  | { channel: null; reason: "no_channel" | "template_not_approved" };

export interface ClientContact {
  phone: string | null | undefined;
  email: string | null | undefined;
  lastInboundAt: string | null | undefined;
}

export function insideWhatsAppWindow(lastInboundAt: string | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  const age = now.getTime() - new Date(lastInboundAt).getTime();
  return age >= 0 && age < WHATSAPP_WINDOW_HOURS * 60 * 60 * 1000;
}

export function templateApproved(name: string, channels: ChannelAvailability): boolean {
  return channels.approvedTemplates === "all" || channels.approvedTemplates.includes(name);
}

const looksLikeEmail = (v: string | null | undefined): v is string => typeof v === "string" && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(v.trim());
const looksLikePhone = (v: string | null | undefined): v is string => typeof v === "string" && /^\+?[1-9]\d{7,14}$/.test(v.replace(/[\s()-]/g, ""));

export function chooseChannel(contact: ClientContact, template: string, channels: ChannelAvailability, now: Date): ChannelChoice {
  let blockedByTemplate = false;
  if (channels.whatsapp && looksLikePhone(contact.phone)) {
    if (insideWhatsAppWindow(contact.lastInboundAt, now)) return { channel: "whatsapp", mode: "text" };
    if (templateApproved(template, channels)) return { channel: "whatsapp", mode: "template" };
    blockedByTemplate = true;
  }
  if (channels.email && looksLikeEmail(contact.email)) return { channel: "email" };
  return { channel: null, reason: blockedByTemplate ? "template_not_approved" : "no_channel" };
}

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", email: "correo" };

/**
 * What is configured on the server. Read from the environment, never from the
 * browser. Each channel needs everything it must carry, or it is off.
 */
export function availabilityFromEnv(env: Record<string, string | undefined> = process.env): ChannelAvailability {
  const whatsapp = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
  const email = Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM && env.NEXT_PUBLIC_COMPANY_ADDRESS && env.UNSUBSCRIBE_SECRET && env.NEXT_PUBLIC_APP_URL);
  const approvedTemplates = (env.WHATSAPP_APPROVED_TEMPLATES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9_]{1,512}$/.test(s));
  return { whatsapp, email, approvedTemplates, simulated: false };
}

/** What each channel still needs, in plain Spanish, for the settings screen. */
export function channelGaps(env: Record<string, string | undefined> = process.env): Record<Channel, string[]> {
  const need = (keys: Array<[string, string]>) => keys.filter(([key]) => !env[key]).map(([, label]) => label);
  return {
    whatsapp: need([
      ["WHATSAPP_ACCESS_TOKEN", "la clave de WhatsApp (WHATSAPP_ACCESS_TOKEN)"],
      ["WHATSAPP_PHONE_NUMBER_ID", "el número de WhatsApp (WHATSAPP_PHONE_NUMBER_ID)"],
    ]),
    email: need([
      ["EMAIL_API_KEY", "la clave del servicio de correo (EMAIL_API_KEY)"],
      ["EMAIL_FROM", "el remitente (EMAIL_FROM)"],
      ["NEXT_PUBLIC_COMPANY_ADDRESS", "la dirección postal de la empresa (NEXT_PUBLIC_COMPANY_ADDRESS), obligatoria en cada correo"],
      ["UNSUBSCRIBE_SECRET", "la clave para los enlaces de baja (UNSUBSCRIBE_SECRET)"],
      ["NEXT_PUBLIC_APP_URL", "la dirección de la app (NEXT_PUBLIC_APP_URL), para el enlace de baja"],
    ]),
  };
}
