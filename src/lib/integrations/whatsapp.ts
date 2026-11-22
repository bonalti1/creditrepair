import { BRAND } from "../brand";
import { assertClaimGuardrails } from "../compliance/guardrails";
import { SERVICE_MODE, type ServiceMode } from "../service/mode";

// WhatsApp Cloud API layer (spec §4.3): status updates (report imported, round
// of letters in preparation, letters mailed, item no longer on the report) and
// day-40 re-engagement. Message copy is in the client's language (English
// unless they chose Spanish; profiles.locale) and runs through the claim
// guardrails before sending. No-ops when credentials are not configured.
//
// The wording follows the service mode (service/mode.ts). Full service: the
// team prepares and mails, and no message asks the client to approve or send.
// Self-serve: the client approves and sends. No message, in either mode, says
// what a letter will achieve.

export type WhatsAppEvent =
  | { kind: "report_imported" }
  | { kind: "attack_ready"; roundNumber: number }
  | { kind: "letters_mailed"; roundNumber: number; letterCount: number }
  | { kind: "items_deleted"; deletedCount: number; remainingCount: number }
  | { kind: "day40_reengage"; deletedCount: number; remainingCount: number };

// Deep links: every notification lands the user on the exact next step in the
// app (journey engine keys map 1:1 to these destinations).
function appLink(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return base ? `\n👉 ${base}${path}` : "";
}

export function renderMessage(event: WhatsAppEvent, mode: ServiceMode = SERVICE_MODE, locale: "es" | "en" = "en"): string {
  return locale === "es" ? renderMessageEs(event, mode) : renderMessageEn(event, mode);
}

function renderMessageEn(event: WhatsAppEvent, mode: ServiceMode): string {
  const team = mode === "full_service";
  switch (event.kind) {
    case "report_imported":
      return `✅ Your credit report was imported. Open the app to review your items and flag the ones you believe are inaccurate.${appLink("/items")}`;
    case "attack_ready":
      return team
        ? `📝 Your team is preparing your round #${event.roundNumber} of letters, based on what you confirmed in your review. You can read each letter in the app. You don't have to approve or send anything.${appLink("/attack")}`
        : `📝 Your round #${event.roundNumber} of letters is ready for YOUR approval. Review your letters and press send when you're ready. You decide, you send.${appLink("/attack")}`;
    case "letters_mailed": {
      const one = event.letterCount === 1;
      return team
        ? `📬 Your team mailed ${one ? "the letter" : `the ${event.letterCount} letters`} for your round #${event.roundNumber}. The bureaus have about 30 days to answer. In the app you can see each letter and how it's going.${appLink("/rounds")}`
        : `📬 Done! ${one ? "Your letter" : `Your ${event.letterCount} letters`} for round #${event.roundNumber} ${one ? "was" : "were"} printed and mailed. The bureaus usually answer within about 30 days.${appLink("/rounds")}`;
    }
    case "items_deleted":
      return `🎉 Good news! ${event.deletedCount === 1 ? "1 item no longer appears" : `${event.deletedCount} items no longer appear`} on your report. ${event.remainingCount} left. Results vary case by case.${appLink("/rounds")}`;
    case "day40_reengage": {
      const gone = event.deletedCount === 1 ? "1 item no longer appears" : `${event.deletedCount} items no longer appear`;
      const left = event.remainingCount === 1 ? "1 is still there" : `${event.remainingCount} are still there`;
      // With nothing gone, say only what is still there.
      const change =
        event.deletedCount === 0
          ? event.remainingCount === 1
            ? "the item is still on your report"
            : `the ${event.remainingCount} items are still on your report`
          : `${gone} and ${left}`;
      return team
        ? `📊 We checked your report again: ${change}. Your team is preparing the next round of letters from what you confirmed. Open the app to see how it's going.${appLink("/rounds")}`
        : `📊 We updated your report: ${event.deletedCount === 1 ? "1 item removed" : `${event.deletedCount} items removed`}, ${event.remainingCount === 1 ? "1 pending" : `${event.remainingCount} pending`}. Open the app to put together your next round of letters.${appLink("/attack")}`;
    }
  }
}

function renderMessageEs(event: WhatsAppEvent, mode: ServiceMode): string {
  const team = mode === "full_service";
  switch (event.kind) {
    case "report_imported":
      return `✅ Tu reporte de crédito fue importado. Entra a la app para revisar tus elementos y marcar los que crees que son inexactos.${appLink("/items")}`;
    case "attack_ready":
      return team
        ? `📝 Tu equipo está preparando tu ronda de cartas #${event.roundNumber}, con lo que tú confirmaste en tu revisión. En la app puedes leer cada carta. No tienes que aprobar ni enviar nada.${appLink("/attack")}`
        : `📝 Tu ronda de cartas #${event.roundNumber} está lista para TU aprobación. Revisa tus cartas y presiona enviar cuando estés listo. Tú decides, tú envías.${appLink("/attack")}`;
    case "letters_mailed": {
      const one = event.letterCount === 1;
      return team
        ? `📬 Tu equipo envió por correo ${one ? "la carta" : `las ${event.letterCount} cartas`} de tu ronda #${event.roundNumber}. Los burós tienen ~30 días para responder. En la app ves cada carta y cómo va.${appLink("/rounds")}`
        : `📬 ¡Listo! ${one ? "Tu carta" : `Tus ${event.letterCount} cartas`} de tu ronda #${event.roundNumber} ${one ? "fue impresa y enviada" : "fueron impresas y enviadas"} por correo. Los burós suelen responder en un plazo de ~30 días.${appLink("/rounds")}`;
    }
    case "items_deleted":
      return `🎉 ¡Buenas noticias! ${event.deletedCount === 1 ? "1 elemento ya no aparece" : `${event.deletedCount} elementos ya no aparecen`} en tu reporte. Quedan ${event.remainingCount}. Los resultados varían según cada caso.${appLink("/rounds")}`;
    case "day40_reengage": {
      const gone = event.deletedCount === 1 ? "1 elemento ya no aparece" : `${event.deletedCount} elementos ya no aparecen`;
      const left = event.remainingCount === 1 ? "1 sigue" : `${event.remainingCount} siguen`;
      // With nothing gone, say only what is still there.
      const change =
        event.deletedCount === 0
          ? event.remainingCount === 1
            ? "el elemento sigue en tu reporte"
            : `los ${event.remainingCount} elementos siguen en tu reporte`
          : `${gone} y ${left}`;
      return team
        ? `📊 Revisamos tu reporte de nuevo: ${change}. Tu equipo prepara la siguiente ronda de cartas con lo que tú confirmaste. Entra a la app para ver cómo va.${appLink("/rounds")}`
        : `📊 Actualizamos tu reporte: ${event.deletedCount === 1 ? "1 elemento eliminado" : `${event.deletedCount} elementos eliminados`}, ${event.remainingCount === 1 ? "1 pendiente" : `${event.remainingCount} pendientes`}. Entra a la app para armar tu próxima ronda de cartas.${appLink("/attack")}`;
    }
  }
}

// What the assistant says on WhatsApp without the model. Every automated message is
// sent with the AI mark in front (see the webhook), and says it is AI itself.

/** To a client, when the coach is not available or its reply was held back (Spanish). */
export const CLIENT_FALLBACK_REPLY = `¡Gracias por tu mensaje! Soy ${BRAND.assistant}, el asistente de IA de ${BRAND.name}. En la app puedes revisar tu reporte y ver cómo van tus cartas. Si tienes una pregunta sobre tu crédito, escríbela y te respondo aquí mismo. Si prefieres hablar con una persona del equipo, dilo y te conectamos. 🙂`;

/**
 * To someone who is not a client yet. Sales comes first: the assistant introduces
 * itself once, says a person will write, and then stays quiet.
 */
export const LEAD_GREETING = `¡Hola! Soy ${BRAND.assistant}, el asistente de IA de ${BRAND.name}. Gracias por escribir. Una persona de nuestro equipo te responde aquí mismo en un momento para explicarte cómo trabajamos. 🙂`;

/** Both, in each language: the client's (profiles.locale), or the language a lead wrote in; English otherwise. */
export const CLIENT_FALLBACK_REPLIES: Record<"es" | "en", string> = {
  en: `Thanks for your message! I'm ${BRAND.assistant}, ${BRAND.name}'s AI assistant. In the app you can review your report and see how your letters are doing. If you have a question about your credit, write it here and I'll answer right here. If you'd rather talk to a person on our team, just say so and we'll connect you. 🙂`,
  es: CLIENT_FALLBACK_REPLY,
};

export const LEAD_GREETINGS: Record<"es" | "en", string> = {
  en: `Hi! I'm ${BRAND.assistant}, ${BRAND.name}'s AI assistant. Thanks for writing. A person on our team will answer you right here in a moment to explain how we work. 🙂`,
  es: LEAD_GREETING,
};

export async function sendWhatsApp(toPhoneE164: string, event: WhatsAppEvent, locale: "es" | "en" = "en"): Promise<{ sent: boolean }> {
  const message = renderMessage(event, SERVICE_MODE, locale);
  return sendWhatsAppText(toPhoneE164, message, `whatsapp:${event.kind}`);
}

/** Free-text sender (coach replies, assisted-plan conversations). Guardrail-linted. */
export async function sendWhatsAppText(
  toPhoneE164: string,
  message: string,
  context = "whatsapp:text",
): Promise<{ sent: boolean }> {
  assertClaimGuardrails(message, context);

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { sent: false };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhoneE164,
      type: "text",
      text: { body: message },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${await res.text()}`);
  return { sent: true };
}

/**
 * A message template approved in Meta (src/lib/autopilot/templates.ts): the
 * only way to write to a client more than 24 hours after their last message.
 * `rendered` is the same words with the parameters filled in; it is checked
 * against the claim rules before anything is sent.
 */
export async function sendWhatsAppTemplate(
  toPhoneE164: string,
  template: { name: string; locale: "es" | "en"; params: readonly string[]; rendered: string },
  context = "whatsapp:template",
): Promise<{ sent: boolean; id: string | null }> {
  assertClaimGuardrails(template.rendered, context);

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { sent: false, id: null };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhoneE164,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.locale === "es" ? "es_MX" : "en_US" },
        components: [{ type: "body", parameters: template.params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp error ${res.status}: ${await res.text()}`);
  const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
  return { sent: true, id: data.messages?.[0]?.id ?? null };
}
