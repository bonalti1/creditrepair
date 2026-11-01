import { assertClaimGuardrails } from "../compliance/guardrails";

// WhatsApp Cloud API layer (spec §4.3): status updates (report imported, attack
// ready for your approval, letters mailed, item deleted 🎉) and day-40
// re-engagement. Message copy is Spanish-first and runs through the claim
// guardrails before sending. No-ops when credentials are not configured.

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

export function renderMessage(event: WhatsAppEvent): string {
  switch (event.kind) {
    case "report_imported":
      return `✅ Tu reporte de crédito fue importado. Entra a la app para revisar tus elementos y marcar los que crees que son inexactos.${appLink("/items")}`;
    case "attack_ready":
      return `🛡️ Tu ataque #${event.roundNumber} está listo para TU aprobación. Revisa tus cartas y presiona enviar cuando estés listo. Tú decides, tú envías.${appLink("/attack")}`;
    case "letters_mailed":
      return `📬 ¡Listo! Tus ${event.letterCount} cartas del ataque #${event.roundNumber} fueron impresas y enviadas por correo. Los burós suelen responder en un plazo de ~30 días.${appLink("/rounds")}`;
    case "items_deleted":
      return `🎉 ¡Buenas noticias! ${event.deletedCount} elemento(s) ya no aparecen en tu reporte. Quedan ${event.remainingCount}. Los resultados varían según cada caso.${appLink("/rounds")}`;
    case "day40_reengage":
      return `📊 Actualizamos tu reporte: ${event.deletedCount} elemento(s) eliminados, ${event.remainingCount} pendientes. Entra a la app para armar tu próximo ataque.${appLink("/attack")}`;
  }
}

export async function sendWhatsApp(toPhoneE164: string, event: WhatsAppEvent): Promise<{ sent: boolean }> {
  const message = renderMessage(event);
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
