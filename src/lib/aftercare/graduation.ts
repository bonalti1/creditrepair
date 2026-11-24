import { workMayStart } from "../agreement/gate";
import { caseDay, latestMailedRound, responseWindowStart, CASE_RESPONSE_DAYS, type CaseFacts } from "../case/timeline";

// Program completion ("graduation"). When the client's disputes are done (no
// item they marked is still waiting), or whenever they choose to finish after
// the work started, Mi caso offers a clear moment: what was done, as facts;
// the build-your-credit plan going forward; free after-care tips if they want
// them; and sharing their progress with their loan officer.
//
// Finishing ends the service on the agreement (migration 0030 writes
// service_end_requested_at in the same transaction), so:
//  - no letter leaves afterwards (src/lib/agreement/gate.ts), and
//  - no charge can be created afterwards: chargeEligibility refuses with
//    "service_end_requested", and so does the database's charges trigger.
//    Work already mailed and not billed is never charged automatically; a
//    person looks at it (BILL_PERFORMED_WORK_AFTER_END_REQUEST, docs/BILLING.md).
//
// After-care is free and is not part of the paid service: nothing here adds
// work to the contract (an attorney question, docs/AFTERCARE.md).

export type L = "es" | "en";
type Bi = Record<L, string>;

export type GraduationReason = "disputes_done" | "client_chose";

export interface Graduation {
  completedAt: string;
  reason: GraduationReason;
  keepTips: boolean;
}

export interface GraduationInput {
  facts: CaseFacts;
  /** Items the client marked inaccurate that the latest report still lists. */
  markedStillReported: number;
  graduation: Graduation | null;
  now: Date;
}

export type GraduationStatus =
  /** Already finished. */
  | { kind: "graduated"; graduation: Graduation }
  /** Nothing they marked is still waiting: the graduation moment is offered. */
  | { kind: "ready"; reason: "disputes_done" }
  /** Work is under way; they may still choose to finish. */
  | { kind: "can_choose" }
  /** Too early (no agreement in force, or inside the cancellation window), or the service already ended another way. */
  | { kind: "not_available" };

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

export function graduationStatus(input: GraduationInput): GraduationStatus {
  if (input.graduation) return { kind: "graduated", graduation: input.graduation };
  const { facts, now } = input;
  const gate = workMayStart(facts.agreement, now);
  if (!gate.allowed) return { kind: "not_available" };
  if (!facts.review.finishedAt) return { kind: "can_choose" };
  if (facts.review.confirmed === 0) return { kind: "ready", reason: "disputes_done" };
  const mailed = latestMailedRound(facts);
  if (!mailed) return { kind: "can_choose" };
  const windowOver = now.getTime() >= time(responseWindowStart(mailed)) + CASE_RESPONSE_DAYS * 24 * 60 * 60 * 1000;
  if (windowOver && input.markedStillReported === 0) return { kind: "ready", reason: "disputes_done" };
  return { kind: "can_choose" };
}

/** What was done, as facts on record. Never what a bureau decided because of it. */
export function graduationSummary(facts: CaseFacts, locale: L, extra: { noLongerReported?: number | null } = {}): string[] {
  const es = locale === "es";
  const out: string[] = [];
  const signed = facts.agreement?.signedAt;
  if (signed) out.push(es ? `Firmaste tu acuerdo el ${caseDay(signed, locale)}.` : `You signed your agreement on ${caseDay(signed, locale)}.`);
  if (facts.review.finishedAt) {
    out.push(
      es
        ? `Revisaste ${facts.review.total === 1 ? "1 punto" : `${facts.review.total} puntos`} de tu reporte y marcaste ${facts.review.confirmed === 1 ? "1 como inexacto" : `${facts.review.confirmed} como inexactos`}.`
        : `You reviewed ${facts.review.total === 1 ? "1 item" : `${facts.review.total} items`} on your report and marked ${facts.review.confirmed} as inaccurate.`,
    );
  }
  const mailed = facts.rounds.filter((r) => r.mailedAt).sort((a, b) => a.number - b.number);
  if (mailed.length > 0) {
    const letters = mailed.reduce((n, r) => n + r.letters.length, 0);
    const first = caseDay(mailed[0]!.mailedAt!, locale);
    const last = caseDay(mailed.at(-1)!.mailedAt!, locale);
    out.push(
      es
        ? `Tu equipo envió ${mailed.length === 1 ? "1 ronda" : `${mailed.length} rondas`} de cartas (${letters === 1 ? "1 carta" : `${letters} cartas`}), ${mailed.length === 1 ? `el ${first}` : `del ${first} al ${last}`}.`
        : `Your team mailed ${mailed.length === 1 ? "1 round" : `${mailed.length} rounds`} of letters (${letters === 1 ? "1 letter" : `${letters} letters`}), ${mailed.length === 1 ? `on ${first}` : `from ${first} to ${last}`}.`,
    );
    const answers = mailed.reduce((n, r) => n + r.answers.length, 0);
    if (answers > 0) out.push(es ? `Llegaron ${answers === 1 ? "1 respuesta" : `${answers} respuestas`} de los burós o las empresas.` : `${answers === 1 ? "1 answer" : `${answers} answers`} came back from the bureaus or companies.`);
  }
  if (typeof extra.noLongerReported === "number" && mailed.length > 0) {
    out.push(
      es
        ? `${extra.noLongerReported === 1 ? "1 de los puntos que disputaste ya no aparece" : `${extra.noLongerReported} de los puntos que disputaste ya no aparecen`} en tu reporte más reciente.`
        : `${extra.noLongerReported} of the items you disputed ${extra.noLongerReported === 1 ? "no longer appears" : "no longer appear"} on your most recent report.`,
    );
  }
  return out;
}

export const GRADUATION_COPY: Record<L, {
  readyTitle: string;
  readyLead: string;
  chooseTitle: string;
  chooseLead: string;
  doneTitle: string;
  doneLead: (day: string) => string;
  whatWasDone: string;
  goingForward: string;
  goingForwardLead: string;
  openPlan: string;
  tipsLabel: string;
  tipsHelp: string;
  shareTitle: string;
  shareLead: string;
  shareCta: string;
  billingTitle: string;
  billing: string[];
  finish: string;
  finishConfirm: string;
  finishing: string;
  cancel: string;
  resultsNote: string;
  error: string;
}> = {
  en: {
    readyTitle: "Your disputes look done",
    readyLead: "Nothing you marked as inaccurate is waiting for a new round. You can finish your program here.",
    chooseTitle: "Finish your program",
    chooseLead: "You can finish whenever you want. Your team stops sending letters, and nothing more is charged.",
    doneTitle: "You finished your program",
    doneLead: (day) => `You finished on ${day}. Your plan to build credit stays here, free.`,
    whatWasDone: "What was done",
    goingForward: "Going forward",
    goingForwardLead: "Your build-your-credit plan stays open for you. It is free and not part of the paid service.",
    openPlan: "Open my plan",
    tipsLabel: "Send me free credit tips now and then",
    tipsHelp: "By WhatsApp or email. You can turn it off any time.",
    shareTitle: "Share your progress with your loan officer",
    shareLead: "If you want, your loan officer can see your home-buying milestones. Never your scores or your report.",
    shareCta: "Choose what to share",
    billingTitle: "Billing",
    billing: [
      "From the day you finish, no new charge is created.",
      "If a round mailed before that day was not billed yet, a person on our team looks at it and writes to you first.",
    ],
    finish: "Finish my program",
    finishConfirm: "Yes, finish my program",
    finishing: "Saving…",
    cancel: "Not now",
    resultsNote: "These are the facts on record. The bureaus decide how they answer, and results vary.",
    error: "We could not save it. Nothing changed. Please try again.",
  },
  es: {
    readyTitle: "Tus disputas parecen terminadas",
    readyLead: "Nada de lo que marcaste como inexacto espera una ronda nueva. Puedes terminar tu programa aquí.",
    chooseTitle: "Terminar tu programa",
    chooseLead: "Puedes terminar cuando quieras. Tu equipo deja de enviar cartas, y no se cobra nada más.",
    doneTitle: "Terminaste tu programa",
    doneLead: (day) => `Terminaste el ${day}. Tu plan para construir crédito se queda aquí, gratis.`,
    whatWasDone: "Lo que se hizo",
    goingForward: "De aquí en adelante",
    goingForwardLead: "Tu plan para construir crédito sigue abierto para ti. Es gratis y no es parte del servicio pagado.",
    openPlan: "Abrir mi plan",
    tipsLabel: "Mándame consejos de crédito gratis de vez en cuando",
    tipsHelp: "Por WhatsApp o correo. Lo puedes quitar cuando quieras.",
    shareTitle: "Comparte tu avance con tu oficial de préstamos",
    shareLead: "Si quieres, tu oficial de préstamos puede ver tus pasos para comprar casa. Nunca tus puntajes ni tu reporte.",
    shareCta: "Elegir qué compartir",
    billingTitle: "Cobros",
    billing: [
      "Desde el día en que terminas, no se crea ningún cobro nuevo.",
      "Si una ronda enviada antes de ese día no se cobró todavía, una persona del equipo la revisa y te escribe primero.",
    ],
    finish: "Terminar mi programa",
    finishConfirm: "Sí, terminar mi programa",
    finishing: "Guardando…",
    cancel: "Ahora no",
    resultsNote: "Esto es lo que está registrado. Los burós deciden cómo responden, y los resultados varían.",
    error: "No pudimos guardarlo. No cambió nada. Inténtalo otra vez.",
  },
};

/** Every sentence of the graduation moment, for the tests. */
export function graduationCopy(locale: L): string[] {
  const c = GRADUATION_COPY[locale];
  return [
    c.readyTitle, c.readyLead, c.chooseTitle, c.chooseLead, c.doneTitle, c.doneLead("1"), c.whatWasDone, c.goingForward, c.goingForwardLead,
    c.openPlan, c.tipsLabel, c.tipsHelp, c.shareTitle, c.shareLead, c.shareCta, c.billingTitle, ...c.billing, c.finish, c.finishConfirm, c.cancel, c.resultsNote, c.error,
  ];
}

export const GRADUATION_REASON_LABEL: Record<L, Record<GraduationReason, string>> = {
  en: { disputes_done: "Disputes done", client_chose: "Chose to finish" },
  es: { disputes_done: "Disputas terminadas", client_chose: "Eligió terminar" },
};

