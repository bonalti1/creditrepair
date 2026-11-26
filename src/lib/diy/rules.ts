import { formatCents } from "../billing/money";
import type { PlanSnapshot } from "../billing/plans";

// Credalti DIY, the client's side (docs/SERVICE-OPTIONS.md): what the client
// can do with a round Alti prepared, as pure rules the screens, the routes and
// the tests share.
//
//   Print my letters   the prepared letters, from the approved texts, to print.
//   I mailed them      the client records the date; the bureaus' 30 days and
//                      Alti's next-round reminder count from it. Never in the
//                      future, never before the letters were prepared, at most
//                      30 days back (a typo, not a backdated round).
//   Mail them for me   Credalti mails the letters the client picks, through
//                      the same mail service the team uses, for the fee per
//                      letter in their signed plan. The total is shown before
//                      they confirm; it is charged after the letters are mailed.

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back "I mailed them" may be dated. */
export const MAILED_ON_MAX_DAYS_BACK = 30;

/** After this many days with prepared letters not marked as mailed, Alti offers help once (and a salesperson gets a gentle follow-up). */
export const UNMAILED_NUDGE_DAYS = 14;

export type MailedOnProblem = "invalid" | "future" | "before_prepared" | "too_old";

/** Why a "mailed on" date cannot be recorded, or null when it can. Dates are YYYY-MM-DD on the client's calendar. */
export function mailedOnProblem(mailedOn: string, now: Date, preparedAt: string | null): MailedOnProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mailedOn)) return "invalid";
  const day = new Date(`${mailedOn}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return "invalid";
  if (day.getTime() > now.getTime() + DAY_MS) return "future";
  if (now.getTime() - day.getTime() > (MAILED_ON_MAX_DAYS_BACK + 1) * DAY_MS) return "too_old";
  if (preparedAt) {
    const prepared = new Date(preparedAt);
    if (!Number.isNaN(prepared.getTime()) && day.getTime() < prepared.getTime() - DAY_MS) return "before_prepared";
  }
  return null;
}

export const MAILED_ON_PROBLEM_TEXT: Record<MailedOnProblem, { en: string; es: string }> = {
  invalid: { en: "Choose the date you mailed them.", es: "Elige la fecha en que las enviaste." },
  future: { en: "That date is in the future. Choose the day you mailed them.", es: "Esa fecha es en el futuro. Elige el día en que las enviaste." },
  before_prepared: { en: "That is before your letters were prepared. Check the date.", es: "Es antes de que se prepararan tus cartas. Revisa la fecha." },
  too_old: { en: `Choose a date in the last ${MAILED_ON_MAX_DAYS_BACK} days, or ask the team.`, es: `Elige una fecha de los últimos ${MAILED_ON_MAX_DAYS_BACK} días, o pregúntale al equipo.` },
};

/** The fee per letter for "Mail them for me" under a signed plan, or null when the plan does not offer it. */
export function mailFeeCents(plan: Pick<PlanSnapshot, "terms" | "effective"> | null | undefined): number | null {
  if (!plan || plan.terms.type !== "diy_subscription") return null;
  const fee = plan.effective.mailFeeCents ?? 0;
  return fee > 0 ? fee : null;
}

export interface MailQuote {
  letters: number;
  feeCents: number;
  totalCents: number;
  /** "3 letters × $4.00 = $12.00" */
  line: { en: string; es: string };
}

/** What "Mail them for me" costs, shown before the client confirms. */
export function mailQuote(feeCents: number, letters: number): MailQuote {
  const total = feeCents * letters;
  return {
    letters,
    feeCents,
    totalCents: total,
    line: {
      en: `${letters} ${letters === 1 ? "letter" : "letters"} × ${formatCents(feeCents)} = ${formatCents(total)}`,
      es: `${letters} ${letters === 1 ? "carta" : "cartas"} × ${formatCents(feeCents)} = ${formatCents(total)}`,
    },
  };
}

/** True when prepared letters have waited this long without "I mailed them": the moment Alti offers help, once. */
export function unmailedTooLong(preparedAt: string | null, mailed: boolean, now: Date, days = UNMAILED_NUDGE_DAYS): boolean {
  if (!preparedAt || mailed) return false;
  const t = new Date(preparedAt).getTime();
  return !Number.isNaN(t) && now.getTime() - t >= days * DAY_MS;
}
