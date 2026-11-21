import type { Locale } from "../i18n/dictionaries";
import { BRAND } from "../brand";

// "Talk to a person". A real person answers on WhatsApp, so the path exists
// only when a WhatsApp number is configured. Without one (the demo) the app
// says so plainly instead of sending the customer back to the AI chat.

const NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null;

const OPENING = {
  es: `Hola, necesito ayuda con mi cuenta de ${BRAND.name}.`,
  en: `Hi, I need help with my ${BRAND.name} account.`,
} as const;

/** The WhatsApp chat with the team, or null when no number is configured. */
export function humanHelpHref(locale: Locale): string | null {
  return NUMBER ? `https://wa.me/${NUMBER}?text=${encodeURIComponent(OPENING[locale])}` : null;
}

export const HUMAN_HELP = {
  /** Más row, live. */
  liveRow: {
    es: "Nuestro equipo te responde por WhatsApp.",
    en: "Our team answers you on WhatsApp.",
  },
  /** Más row, demo: not a link. */
  demoRow: {
    es: "En esta demo no hay personas conectadas. Con tu cuenta real, aquí se abre un chat de WhatsApp con nuestro equipo.",
    en: "No one is online in this demo. With a real account, this opens a WhatsApp chat with our team.",
  },
  /** Capi's answer in the chat, demo. */
  demoChat: {
    es: "En esta demo no hay personas conectadas. Con tu cuenta real, el botón «Persona» abre un chat de WhatsApp con nuestro equipo. Mientras tanto sigo yo aquí: ¿en qué te ayudo?",
    en: "No one is online in this demo. With a real account, the “Person” button opens a WhatsApp chat with our team. Meanwhile I'm still here: how can I help?",
  },
  /** Capi's answer in the chat when a typed question asks for a person, live. */
  liveChat: {
    es: "Para hablar con una persona, toca «Persona» aquí arriba: se abre un chat de WhatsApp con nuestro equipo.",
    en: "To talk to a person, tap “Person” at the top: it opens a WhatsApp chat with our team.",
  },
} as const;
