import { BRAND } from "../brand";
import { templateApproved } from "../autopilot/channels";
import type { ChannelAvailability } from "../autopilot/types";

// What a teammate may send a lead on WhatsApp more than 24 hours after the
// lead's last message: only a template approved in Meta (WhatsApp's rule).
// One template, two languages under the same name. Its words pass the claim
// rules (a test checks both). Until the owner gets it approved and lists it in
// WHATSAPP_APPROVED_TEMPLATES, nothing can be sent outside the window: the
// conversation says so.
//
// Meta will likely file it as Marketing (a follow-up to someone who is not a
// client yet). Never by SMS.

export interface LeadTemplate {
  name: string;
  /** The parameters, in order. */
  params: readonly string[];
  body: Record<"en" | "es", string>;
  footer: Record<"en" | "es", string>;
}

export const LEAD_FOLLOWUP_TEMPLATE: LeadTemplate = {
  name: "credalti_prospecto_seguimiento",
  params: ["first name", "teammate's first name"],
  body: {
    en: `Hi {{1}}, this is {{2}} from ${BRAND.name}. You wrote to us about our credit report service. If you still have questions, reply here and I'll answer them.`,
    es: `Hola {{1}}, soy {{2}} de ${BRAND.name}. Nos escribiste sobre nuestro servicio de revisión de reportes de crédito. Si todavía tienes preguntas, responde aquí y te las contesto.`,
  },
  footer: {
    en: "Reply STOP if you do not want these messages.",
    es: "Si no quieres recibir estos mensajes, responde BAJA.",
  },
};

export const LEAD_TEMPLATES: readonly LeadTemplate[] = [LEAD_FOLLOWUP_TEMPLATE];

/** The words with the parameters filled in, as the lead will read them (body and footer). */
export function renderLeadTemplate(template: LeadTemplate, locale: "en" | "es", params: readonly string[]): string {
  const body = template.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1]?.trim() || (locale === "es" ? "hola" : "there"));
  return `${body}\n\n${template.footer[locale]}`;
}

/** The templates this server may send now: approved in Meta and listed in WHATSAPP_APPROVED_TEMPLATES. */
export function approvedLeadTemplates(channels: ChannelAvailability): LeadTemplate[] {
  return channels.whatsapp || channels.simulated ? LEAD_TEMPLATES.filter((t) => templateApproved(t.name, channels)) : [];
}
