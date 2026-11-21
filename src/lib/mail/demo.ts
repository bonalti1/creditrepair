import { cancellationDeadline } from "../agreement/businessDays";
import { AGREEMENT_VERSION } from "../agreement/documents";
import { resolveTerms } from "../agreement/terms";
import { DEMO_RAW_REPORT } from "../demo";
import { buildAttackPlan, type ItemHistory } from "../domain/attack";
import { parseReport } from "../domain/parser";
import type { EscalationStage, ItemFlag, NormalizedReport, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { paidUpBilling } from "../staff/billing";
import { DEMO_EXAMPLE_FEE } from "../staff/demoClients";
import type { ItemAnswer, StaffClient, StaffLetter, StaffRound } from "../staff/types";
import { defaultMailClass, isCertified } from "./classes";
import { mailState } from "./tracking";
import type { LetterMail, MailClass, MailEventKind, MailEventRecord, MailStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DEMO DATA for mail. Nothing in this file was mailed.
//
// The console's invented clients (staff/demoClients.ts) say only whether each
// letter is on its way, delivered or back. This adds what a mail service
// would have reported: the class, the tracking events and, for certified
// letters, a tracking number. Every letter here is marked "simulated", so the
// screens say so. The tracking numbers are made up and look nothing like a
// real one's check digit; USPS will not find them.
//
// It also adds one client the main demo has no room for: Rosario, whose
// fourth round escalates to the creditor and the collector directly, so the
// screens show certified letters with tracking from round 3 and, in round 4,
// a letter held for a missing address.
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** A made-up 22-digit number in USPS's certified style. Not a real tracking number. */
export function demoTrackingNumber(letterId: string): string {
  let hash = 0;
  for (const ch of letterId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `9407000000${String(hash).padStart(12, "0").slice(-12)}`;
}

function event(letterId: string, n: number, at: Date, kind: MailEventKind, status: MailStatus | null, detail: string | null = null): MailEventRecord {
  return { id: `demo-${letterId}-${n}`, at: at.toISOString(), kind, status, location: null, detail };
}

/**
 * What a mail service would have said about a letter mailed at `mailedAt`
 * whose status is now `status`. A delivered letter is delivered on the 4th
 * day, a returned one comes back on the 6th.
 */
export function demoLetterMail(letter: StaffLetter, mailedAt: string, status: MailStatus, mailClass?: MailClass): LetterMail {
  const cls = mailClass ?? letter.mailClass ?? defaultMailClass(letter.templateKey, letter.recipient.type);
  const start = new Date(mailedAt);
  const day = (n: number, hours = 10) => new Date(start.getTime() + n * DAY_MS + hours * HOUR_MS);
  const events: MailEventRecord[] = [event(letter.id, 1, start, "mailed", "in_transit")];
  if (status !== "not_sent") {
    events.push(event(letter.id, 2, day(1), "in_transit", "in_transit"));
    if (status === "delivered") {
      events.push(event(letter.id, 3, day(3), "processed_for_delivery", "in_transit"));
      events.push(event(letter.id, 4, day(4, 13), "delivered", "delivered"));
    }
    if (status === "returned") {
      events.push(event(letter.id, 3, day(6), "returned_to_sender", "returned", "Returned to Sender"));
    }
    if (status === "undeliverable") {
      events.push(event(letter.id, 3, day(6), "issue", "undeliverable", "package_undeliverable"));
    }
  }
  const state = mailState(events, true);
  return {
    mailClass: cls,
    provider: "simulated",
    externalId: null,
    trackingNumber: isCertified(cls) ? demoTrackingNumber(letter.id) : null,
    mailedAt,
    deliveredAt: state.deliveredAt,
    returnedAt: state.returnedAt,
    returnReason: state.returnReason,
    toAddressLines: letter.recipient.addressLines,
    events: state.events,
  };
}

/** Every mailed letter of the demo with its simulated mail record; nothing else changes. */
export function withDemoMail(clients: StaffClient[]): StaffClient[] {
  return clients.map((client) => ({
    ...client,
    rounds: client.rounds.map((round) =>
      round.mailedAt && (round.status === "mailed" || round.status === "responded")
        ? { ...round, letters: round.letters.map((letter) => (letter.mail ? letter : { ...letter, mail: demoLetterMail(letter, round.mailedAt!, letter.mailStatus) })) }
        : round,
    ),
  }));
}

// ── Rosario ─────────────────────────────────────────────────────────────

const REASON: Record<string, { code: DisputeReasonCode; note: string }> = {
  personal_info: { code: "wrong_personal_info", note: "Esa dirección y ese nombre no son míos." },
  "Capital One": { code: "wrong_balance", note: "El saldo que reportan no es el que tengo." },
  "Midland Credit Management": { code: "not_mine", note: "No reconozco esa deuda." },
  inquiry: { code: "unauthorized_inquiry", note: "Yo no pedí ese crédito." },
};

function answerFor(item: ReportItem, at: string): ItemAnswer {
  const reason = item.category === "personal_info" ? REASON.personal_info : item.category === "inquiry" ? REASON.inquiry : REASON[item.name];
  return reason ? { status: "inaccurate", reason: reason.note, reasonCode: reason.code, confirmedAt: at } : { status: "correct", answeredAt: at };
}

function lettersFor(clientId: string, number: number, report: NormalizedReport, answers: Record<string, ItemAnswer>, history: ItemHistory): StaffLetter[] {
  const flags: ItemFlag[] = report.items.flatMap((item) => {
    const answer = answers[item.fingerprint];
    return answer?.status === "inaccurate" ? [{ fingerprint: item.fingerprint, reason: answer.reason, attested: true, attestedAt: answer.confirmedAt }] : [];
  });
  const byFp = new Map(report.items.map((i) => [i.fingerprint, i]));
  return buildAttackPlan({ roundNumber: number, items: report.items, flags, history }).letters.map((planned, index) => ({
    id: `${clientId}-r${number}-c${index + 1}`,
    recipient: planned.target,
    templateKey: planned.templateKey,
    category: planned.category,
    stage: planned.stage,
    items: planned.itemFingerprints.flatMap((fp) => byFp.get(fp) ?? []),
    itemReasons: Object.fromEntries(
      planned.itemFingerprints.flatMap((fp) => {
        const answer = answers[fp];
        return answer?.status === "inaccurate" && answer.reasonCode ? [[fp, answer.reasonCode]] : [];
      }),
    ),
    mailStatus: "not_sent" as const,
  }));
}

/**
 * Rosario Villalobos: four rounds. 1, 2 and 3 went out and were answered (3
 * was the method-of-verification round, certified, every letter delivered).
 * Round 4 is ready: direct letters to Capital One and to Midland Credit
 * Management, which the address book can mail only once it has Midland's
 * dispute address.
 */
export function demoRosario(now: Date): StaffClient {
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - (hours + 1) * HOUR_MS).toISOString();
  const raw = structuredClone(DEMO_RAW_REPORT);
  raw.pulledAt = ago(18);
  raw.bureaus.equifax!.personalInfo = [
    { field: "address", value: "4410 Old Spanish Trl Apt 9, Houston, TX 77021" },
    { field: "name", value: "R. VILLALOBOS" },
  ];
  const report = parseReport(raw);
  const answers = Object.fromEntries(report.items.map((item) => [item.fingerprint, answerFor(item, ago(158))]));

  const id = "c50";
  const rank: Record<EscalationStage, number> = { dispute: 1, mov: 2, furnisher_direct: 3 };
  const history: ItemHistory = {};
  const rounds: StaffRound[] = [];
  const dates: Array<[mailed: number, responded: number | null]> = [
    [152, 118],
    [112, 78],
    [72, 18],
  ];
  for (let number = 1; number <= 4; number++) {
    const letters = lettersFor(id, number, report, answers, { ...history });
    const when = dates[number - 1];
    if (!when) {
      rounds.push({ number, status: "ready", mailedAt: null, respondedAt: null, letters });
      break;
    }
    const mailedAt = ago(when[0]);
    const mailed = letters.map((letter) => {
      const mail = demoLetterMail(letter, mailedAt, "delivered");
      return { ...letter, mailClass: mail.mailClass, mail, mailStatus: "delivered" as const };
    });
    rounds.push({ number, status: "responded", mailedAt, respondedAt: when[1] !== null ? ago(when[1]) : null, letters: mailed });
    for (const letter of letters) {
      if (letter.stage === "personal_info_cleanup") continue;
      for (const item of letter.items) {
        const stage = letter.stage;
        if (!history[item.fingerprint] || rank[stage] > rank[history[item.fingerprint]!]) history[item.fingerprint] = stage;
      }
    }
  }

  const signedAt = ago(165);
  const client: StaffClient = {
    id,
    firstName: "Rosario",
    lastName: "Villalobos",
    phone: "+17135550124",
    state: "TX",
    addressLines: ["4802 Calle Ejemplo", "Apt 12", "Houston, TX 77021"],
    salesperson: "ana",
    createdAt: ago(170),
    signedUpAt: ago(168),
    agreementSignedAt: signedAt,
    disclosureAcknowledgedAt: new Date(new Date(signedAt).getTime() - 6 * 60 * 1000).toISOString(),
    agreementVersion: AGREEMENT_VERSION,
    cancellationDeadline: cancellationDeadline(new Date(signedAt)).toISOString(),
    agreementCancelledAt: null,
    cancelledWithinWindow: null,
    serviceEndRequestedAt: null,
    serviceEndReason: null,
    documents: ["government_id", "proof_of_address"],
    report,
    answers,
    rounds,
    agreementMonthlyFee: resolveTerms().monthlyFee ?? DEMO_EXAMPLE_FEE,
    billing: { paymentMethod: null, charges: [], pause: null },
    lastActivityAt: ago(18, 2),
    notes: [],
    questions: [],
    handled: {},
  };
  return { ...client, billing: paidUpBilling(client, client.agreementMonthlyFee!, now) };
}

/** The demo clients with mail records, and Rosario. */
export function demoClientsWithMail(clients: StaffClient[], now: Date): StaffClient[] {
  const withMail = withDemoMail(clients);
  return withMail.some((c) => c.id === "c50") ? withMail : [...withMail, demoRosario(now)];
}
