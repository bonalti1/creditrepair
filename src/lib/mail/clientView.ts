import type { LetterTargetType } from "../domain/types";
import { defaultMailClass, isCertified, MAIL_CLASS_LABEL } from "./classes";
import type { MailClass, MailStatus } from "./types";

// How a letter's mail status reads in the client app (the letters page and
// /rounds), in plain Spanish or English:
//   "Enviada el 3 de noviembre · Certificada · Entregada el 7 de noviembre"
//   "Mailed November 3 · First class · On its way"
// It states what happened to the envelope and nothing about what the bureau
// will do: no outcome, no promise (src/lib/compliance/guardrails.ts).
//
// In the real product the facts come from the client's own letters
// (letters.mail_class, mail_status, mailed_at, delivered_at, returned_at:
// migration 0013, policy "own letters read"). In the demo they come from what
// this browser saved (ux/letterMail.ts); nothing is ever made up: a letter
// with no recorded delivery reads "on its way".

export interface ClientLetterMail {
  mailClass: MailClass;
  status: MailStatus;
  mailedAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
}

type L = "es" | "en";

const TIME_ZONE = "America/Chicago";

function day(iso: string, locale: L): string {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "long", timeZone: TIME_ZONE });
}

/** The mail facts for a letter, from what is on record or, with nothing recorded, from the round's mailing date. */
export function clientLetterMail(
  letter: { templateKey: string; targetType?: LetterTargetType },
  mailedAt: string | null,
  saved?: Partial<ClientLetterMail> | null,
): ClientLetterMail {
  return {
    mailClass: saved?.mailClass ?? defaultMailClass(letter.templateKey, letter.targetType),
    status: saved?.status ?? (mailedAt ? "in_transit" : "not_sent"),
    mailedAt: saved?.mailedAt ?? mailedAt,
    deliveredAt: saved?.deliveredAt ?? null,
    returnedAt: saved?.returnedAt ?? null,
  };
}

/** One line: when it went, how, and where it is. Null while it has not been mailed. */
export function letterMailLine(mail: ClientLetterMail, locale: L): string | null {
  if (!mail.mailedAt || mail.status === "not_sent") return null;
  const es = locale === "es";
  const parts = [es ? `Enviada el ${day(mail.mailedAt, locale)}` : `Mailed ${day(mail.mailedAt, locale)}`, MAIL_CLASS_LABEL[mail.mailClass].short[locale]];
  if (mail.status === "delivered" && mail.deliveredAt) {
    // A certified letter's delivery is a USPS scan. For first class, the mail
    // service's "delivered" is its estimate, and the line says so.
    const when = day(mail.deliveredAt, locale);
    parts.push(
      isCertified(mail.mailClass)
        ? es ? `Entregada el ${when}` : `Delivered ${when}`
        : es ? `Entregada el ${when} (aprox.)` : `Delivered about ${when}`,
    );
  } else if ((mail.status === "returned" || mail.status === "undeliverable") && mail.returnedAt) {
    parts.push(
      es
        ? `El correo la devolvió el ${day(mail.returnedAt, locale)}; tu equipo la revisa`
        : `The post office returned it on ${day(mail.returnedAt, locale)}; your team is looking into it`,
    );
  } else {
    parts.push(es ? "En camino" : "On its way");
  }
  return parts.join(" · ");
}

/**
 * When the bureaus' 30-day window starts for the client's round: the latest
 * USPS delivery scan of a certified letter that reached its recipient, else
 * the mailing date. The same rule as the console (tracking.ts:
 * responseWindowStart): the law counts from receipt; the mailing date is
 * earlier, so without a scan the window shown never ends later than the real one.
 */
export function clientResponseWindowStart(mailedAt: string, mails: readonly ClientLetterMail[]): string {
  let start = new Date(mailedAt).getTime();
  for (const mail of mails) {
    const delivered = mail.deliveredAt ? new Date(mail.deliveredAt).getTime() : Number.NaN;
    if (isCertified(mail.mailClass) && mail.status === "delivered" && delivered > start) start = delivered;
  }
  return new Date(start).toISOString();
}

/** True when the line is about a letter that came back. */
export function letterCameBack(mail: ClientLetterMail): boolean {
  return mail.status === "returned" || mail.status === "undeliverable";
}
