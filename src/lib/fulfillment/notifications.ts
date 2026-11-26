import type { ChannelAvailability, FollowupKind, StatusKind } from "../autopilot/types";

// The client's notification settings (migration 0041, notification_settings):
// which channels carry automatic messages, and whether the optional ones go.
//
// Three kinds of automatic message (docs/FULFILLMENT.md, "Messages"):
//
//   - REQUIRED notices: money (a receipt, a declined charge, a missing payment
//     method) and the letters mailed in the client's name (mailed, re-mailed).
//     They always go, on a channel the client kept, while the client has not
//     opted out of automatic messages altogether. A client cannot turn them
//     off one by one: they are what the law and the contract need the client
//     to know about their money and the work done for them.
//   - PROGRESS UPDATES (optional): a certified letter delivered, a new report
//     and what it shows, the next round prepared, the one review request.
//   - REMINDERS (optional): every follow-up (sign, upload, finish the review,
//     monitoring, confirm the address…). With reminders off, the situation goes
//     to a person on the team exactly as it does after an opt-out.
//
// The opt-out records (BAJA / STOP, the email link, a teammate's note, and
// "Stop all automatic messages" on the settings screen) still win over
// everything: an opted-out client gets no automatic message at all, required
// ones included (they stay in the app: Mi caso, Mis pagos). Never SMS.

export interface NotificationSettings {
  whatsapp: boolean;
  email: boolean;
  reminders: boolean;
  updates: boolean;
  updatedAt: string | null;
  updatedBy: "client" | "staff" | null;
}

/** A client who never opened the screen: every channel, every message. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  whatsapp: true,
  email: true,
  reminders: true,
  updates: true,
  updatedAt: null,
  updatedBy: null,
};

export type MessageCategory = "required" | "updates" | "reminders";

/** Status messages the client cannot turn off one by one: money, and the letters mailed in their name. */
export const REQUIRED_STATUS: readonly StatusKind[] = ["payment_receipt", "payment_declined", "payment_method_needed", "letters_mailed", "letter_remailed"];

/** Status messages that are progress news: optional. */
export const UPDATE_STATUS: readonly StatusKind[] = ["certified_delivered", "report_changes", "next_round_prepared", "review_request"];

/** Which group a message belongs to: a follow-up is a reminder; a status message is required or an update. */
export function messageCategory(kind: "followup" | "status", topic: FollowupKind | StatusKind | string): MessageCategory {
  if (kind === "followup") return "reminders";
  return (REQUIRED_STATUS as readonly string[]).includes(topic) ? "required" : "updates";
}

/** The client's settings, or the defaults when they never chose. */
export function settingsOf(client: { notificationSettings?: NotificationSettings | null }): NotificationSettings {
  return client.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS;
}

/** True when the client's settings let this message go at all (before channels, quiet hours and the cap). */
export function settingsAllow(settings: NotificationSettings, kind: "followup" | "status", topic: string): boolean {
  const category = messageCategory(kind, topic);
  if (category === "required") return true;
  return category === "reminders" ? settings.reminders : settings.updates;
}

/** The team's channels, narrowed to the ones the client kept. */
export function channelsFor(settings: NotificationSettings, channels: ChannelAvailability): ChannelAvailability {
  return { ...channels, whatsapp: channels.whatsapp && settings.whatsapp, email: channels.email && settings.email };
}

export type SettingsProblem = "no_channel";

/** A save the database would refuse, said before it is sent. */
export function settingsProblem(next: Pick<NotificationSettings, "whatsapp" | "email">): SettingsProblem | null {
  return next.whatsapp || next.email ? null : "no_channel";
}

// ── The words ───────────────────────────────────────────────────────────

/** The client's screen (Más → Avisos), in the client's language. */
export const NOTIFICATION_COPY = {
  en: {
    navTitle: "Notifications",
    navDesc: "How we write to you: WhatsApp, email, language, reminders.",
    title: "Notifications",
    lead: "Choose how Credalti writes to you about your case. You can change this any time.",
    channels: "Where we write to you",
    whatsapp: "WhatsApp",
    whatsappDesc: "To the phone number on your account.",
    email: "Email",
    emailDesc: "To the email on your account. Every email has an unsubscribe link.",
    noEmail: "There is no email on your account. Ask our team to add one.",
    atLeastOne: "Keep at least one: we need a way to send the notices about your payments and your letters.",
    language: "Language of our messages",
    what: "What we send",
    required: "Notices about your money and your letters",
    requiredDesc: "Receipts, a payment that did not go through, and when we mail a letter in your name. These always go while you get automatic messages.",
    requiredOn: "Always on",
    updates: "Progress updates",
    updatesDesc: "A certified letter was delivered, your new report is in, your next round is ready.",
    reminders: "Reminders",
    remindersDesc: "A nudge when something waits for you: signing, a document, your review. If you turn them off, a person on our team may call you instead.",
    stopAll: "Stop all automatic messages",
    stopAllDesc: "The same as replying STOP. You can still write to us, and a person answers. The notices stay in the app (My case, My payments).",
    stopAllButton: "Stop all",
    stopped: (when: string) => `You asked us to stop automatic messages on ${when}.`,
    startAgain: "Turn automatic messages back on",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    error: "We could not save it. Please try again.",
    signIn: "Sign in to change your notifications.",
    demo: "Demo: your choices are kept only in this browser.",
    neverSms: "We never send text messages (SMS) about your case. Login codes are the only texts.",
    quiet: "We do not send automatic messages between 9 p.m. and 8 a.m. Texas time.",
  },
  es: {
    navTitle: "Avisos",
    navDesc: "Cómo te escribimos: WhatsApp, correo, idioma, recordatorios.",
    title: "Avisos",
    lead: "Elige cómo te escribe Credalti sobre tu caso. Lo puedes cambiar cuando quieras.",
    channels: "Dónde te escribimos",
    whatsapp: "WhatsApp",
    whatsappDesc: "Al número de teléfono de tu cuenta.",
    email: "Correo electrónico",
    emailDesc: "Al correo de tu cuenta. Cada correo trae un enlace para darte de baja.",
    noEmail: "Tu cuenta no tiene correo. Pídele a nuestro equipo que lo agregue.",
    atLeastOne: "Deja al menos uno: necesitamos una forma de enviarte los avisos de tus pagos y tus cartas.",
    language: "Idioma de nuestros mensajes",
    what: "Qué te enviamos",
    required: "Avisos de tu dinero y tus cartas",
    requiredDesc: "Recibos, un pago que no pasó, y cuando enviamos una carta a tu nombre. Siempre se envían mientras recibas mensajes automáticos.",
    requiredOn: "Siempre",
    updates: "Avances de tu caso",
    updatesDesc: "Se entregó una carta certificada, llegó tu reporte nuevo, tu siguiente ronda está lista.",
    reminders: "Recordatorios",
    remindersDesc: "Un aviso cuando algo te espera: firmar, un documento, tu revisión. Si los apagas, puede que una persona del equipo te llame.",
    stopAll: "Dejar de recibir mensajes automáticos",
    stopAllDesc: "Es lo mismo que responder BAJA. Puedes seguir escribiéndonos y una persona te responde. Los avisos siguen en la app (Mi caso, Mis pagos).",
    stopAllButton: "Darme de baja",
    stopped: (when: string) => `Pediste no recibir mensajes automáticos el ${when}.`,
    startAgain: "Volver a recibir mensajes automáticos",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado.",
    error: "No se pudo guardar. Intenta de nuevo.",
    signIn: "Inicia sesión para cambiar tus avisos.",
    demo: "Demo: lo que elijas se guarda solo en este navegador.",
    neverSms: "Nunca te enviamos mensajes de texto (SMS) sobre tu caso. Solo los códigos para entrar.",
    quiet: "No enviamos mensajes automáticos entre las 9 p.m. y las 8 a.m., hora de Texas.",
  },
} as const;
