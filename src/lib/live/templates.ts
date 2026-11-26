import { BRAND } from "../brand";

// The messages that carry a personal video's private link (docs/LIVE-FUNNEL.md,
// step 4). Written by a person (the teammate who recorded it sends it with one
// tap), in the lead's language. Each passes the claim rules (a test checks).
//
//   - Inside WhatsApp's 24 hours after the lead's last message: plain text.
//   - Outside it: only the template below, once Meta approved it and it is
//     listed in WHATSAPP_APPROVED_TEMPLATES (WhatsApp's rule). Until then the
//     screen says so and offers email or copying the link.
//   - SMS only when SMS_FUNNEL_ENABLED is on AND the person texted the keyword
//     or ticked the SMS consent on /live (live/sms.ts).

export const VIDEO_TEMPLATE = {
  name: "credalti_video_revision",
  params: ["first name", "teammate's first name", "the private link"],
  body: {
    en: `Hi {{1}}, this is {{2}} from ${BRAND.name}. I recorded a short private video about the credit report you sent us: {{3}} The link expires in 14 days.`,
    es: `Hola {{1}}, soy {{2}} de ${BRAND.name}. Grabé un video privado corto sobre el reporte de crédito que nos mandaste: {{3}} El enlace vence en 14 días.`,
  },
  footer: {
    en: "Reply STOP if you do not want these messages.",
    es: "Si no quieres recibir estos mensajes, responde BAJA.",
  },
} as const;

export function renderVideoTemplate(locale: "en" | "es", params: readonly [string, string, string]): string {
  const body = VIDEO_TEMPLATE.body[locale].replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1]?.trim() || (locale === "es" ? "hola" : "there"));
  return `${body}\n\n${VIDEO_TEMPLATE.footer[locale]}`;
}

/** The plain-text message inside the 24 hours (and the SMS and email body). */
export function videoMessage(locale: "en" | "es", input: { firstName: string | null; teammate: string; link: string }): string {
  const name = input.firstName?.trim();
  return locale === "es"
    ? `${name ? `Hola ${name}` : "Hola"}, soy ${input.teammate} de ${BRAND.name}. Grabé un video privado corto sobre el reporte de crédito que nos mandaste: ${input.link}\n\nAhí también puedes elegir un paquete cuando estés listo, o escribirme aquí si tienes preguntas. El enlace vence en 14 días.`
    : `${name ? `Hi ${name}` : "Hi"}, this is ${input.teammate} from ${BRAND.name}. I recorded a short private video about the credit report you sent us: ${input.link}\n\nYou can also pick a package there when you're ready, or write me here with any questions. The link expires in 14 days.`;
}

export function videoEmailSubject(locale: "en" | "es"): string {
  return locale === "es" ? `Tu video privado de ${BRAND.name}` : `Your private video from ${BRAND.name}`;
}
