import { sha256Hex } from "../agreement/sha256";
import { DEFAULT_CLIENT_TIME_ZONE } from "../autopilot/clock";

// "Schedule a call with a person" (docs/SIGNUP-CHAT.md). Built, and OFF by
// default: with NEXT_PUBLIC_CALLS_ENABLED unset (or anything but "1"/"true")
// no call option appears anywhere, the booking page answers 404, the public
// and staff routes refuse, and the console shows no calls screen. The owner
// turns it on only after the attorney has answered the Telemarketing Sales
// Rule question in docs/SALES-FLOW.md.
//
// One variable for both sides: Next writes NEXT_PUBLIC_ values into the
// browser bundle at build time (the default argument below is that literal),
// and the server reads the same name.

export function callsEnabled(value: string | undefined = process.env.NEXT_PUBLIC_CALLS_ENABLED): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Times are shown on the person's clock; Texas (Central time) when unknown. */
export const CALL_TIME_ZONE = DEFAULT_CLIENT_TIME_ZONE;

/**
 * The call is for questions only. Shown on the booking page, in the
 * confirmation and the reminder, and to the team on every booking.
 *
 * Why: under the Telemarketing Sales Rule, credit repair sold by telephone
 * may not be paid for until the promised results are shown on a consumer
 * report issued more than six months after they were achieved
 * (16 C.F.R. 310.4(a)(2)), and the exemption for calls a person places in
 * answer to general media advertising does not apply to credit repair
 * (310.6(b)(5)). So nothing is sold, quoted or signed on a call.
 */
export const QUESTIONS_ONLY = {
  version: "2026-11-24-draft.1",
  en: {
    title: "This call is for questions only",
    body: "We answer your questions about how the service works. Signing up and any payment happen afterwards, in writing, in the app. Never on the call.",
    short: "Questions only. Signing up and payment happen afterwards, in writing, in the app.",
  },
  es: {
    title: "Esta llamada es solo para preguntas",
    body: "Respondemos tus preguntas sobre cómo funciona el servicio. El registro y cualquier pago se hacen después, por escrito, en la app. Nunca en la llamada.",
    short: "Solo preguntas. El registro y el pago se hacen después, por escrito, en la app.",
  },
} as const;

/** What the team reads on every booking and on the calls screen. */
export const STAFF_CALL_RULES = {
  es: [
    "Solo preguntas. No registres a nadie, no pidas datos de pago y no des precios en la llamada.",
    "Al terminar, manda a la persona a la app para registrarse por escrito (el chat con Alti o su invitación).",
    "Por qué: la Regla de Ventas por Teléfono (16 C.F.R. 310.4(a)(2)) no deja cobrar un servicio de crédito vendido por teléfono hasta seis meses después de mostrar resultados en un reporte, y la excepción para llamadas por anuncios no aplica a este servicio (310.6(b)(5)).",
  ],
  en: [
    "Questions only. Do not sign anyone up, ask for payment details or quote a price on the call.",
    "Afterwards, send the person to the app to sign up in writing (the chat with Alti, or their invitation).",
    "Why: under the Telemarketing Sales Rule (16 C.F.R. 310.4(a)(2)), credit repair sold by phone cannot be paid for until six months after results are shown on a report, and the exemption for calls from ads does not apply to it (310.6(b)(5)).",
  ],
} as const;

/**
 * TCPA: the person's express consent to be called at the number they give.
 * Its own checkbox, never pre-ticked, not a condition of anything. The words,
 * their version and hash are stored with the booking. Attorney-pending.
 */
export const CALL_CONSENT = {
  version: "2026-11-24-draft.1",
  en: "I agree that Credalti may call me at this number, at the time I picked, to answer my questions. This is not a condition of buying anything, and I can say no at any time.",
  es: "Acepto que Credalti me llame a este número, a la hora que elegí, para responder mis preguntas. No es una condición para comprar nada y puedo decir que no en cualquier momento.",
} as const;

/** The hash stored with a booking: the version and the exact words shown. */
export function callConsentHash(locale: "es" | "en"): string {
  return sha256Hex(`${CALL_CONSENT.version}\n${CALL_CONSENT[locale]}`);
}

/** US numbers only: "(713) 555-1234" → "+17135551234", or null. */
export function usPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}
