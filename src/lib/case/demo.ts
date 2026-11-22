import { cancellationDeadline, firstWorkingDay } from "../agreement/businessDays";
import { AGREEMENT_VERSION } from "../agreement/documents";
import { EMPTY_AGREEMENT, type AgreementState } from "../agreement/record";
import { resolveTerms } from "../agreement/terms";
import { feeToCents } from "../billing/rules";
import type { BillingCharge } from "../billing/types";
import { DEMO_CLIENT_REPORT } from "../demo";
import type { ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { defaultMailClass } from "../mail/classes";
import type { ClientLetterMail } from "../mail/clientView";
import { writeStoredAgreement } from "../ux/agreementLocal";
import { BILLING_STORAGE_KEY, writeDemoBilling, type DemoBillingState } from "../ux/billingLocal";
import { APPROVED_KEY, MAILED_AT_KEY, MAILED_KEY, STORAGE_KEY, type FlagsMap } from "../ux/flagsStore";
import { LETTER_MAIL_KEY, letterMailKey } from "../ux/letterMail";
import { sessionPlan } from "../ux/sessionPlan";
import type { CaseDocumentFact, CaseFacts } from "./timeline";

// ─────────────────────────────────────────────────────────────────────────
// DEMO ONLY. The demo's "Mi caso".
//
// Signed out, the case is what this device has saved: the agreement signed
// here, the review answers, and a round only if the saved state says one went
// out. On its own that never gets past "tu equipo prepara tus cartas", since
// in the demo nobody mails anything.
//
// So the demo can also load an EXAMPLE CASE: invented dates, counted back from
// today, written into the same device stores every screen already reads (the
// agreement, the answers, the mailed round and its mail status, the payments),
// plus a few facts only "Mi caso" shows (documents, the report's date, the
// answer that came back). Home, the rounds page, the letters, the payments and
// "Mi caso" then all tell the same story, and every screen that shows it
// carries the "Ejemplo" label. "Volver a empezar" forgets all of it.
// A signed-in client never sees any of this: their case comes from GET /api/case.
// ─────────────────────────────────────────────────────────────────────────

export const CASE_DEMO_KEY = "bonalti.caseDemo.v1";
/** When this device first showed the demo report (the demo's "imported" date). */
export const DEMO_REPORT_AT_KEY = "bonalti.demoReportAt.v1";
/** When the demo review was first seen complete on this device. */
export const DEMO_REVIEW_DONE_KEY = "bonalti.demoReviewDoneAt.v1";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The facts only "Mi caso" shows, kept for the example case. */
export interface CaseDemoExtras {
  loadedAt: string;
  documents: CaseDocumentFact[];
  reportImportedAt: string;
  reviewFinishedAt: string;
  roundPreparedAt: string;
  answers: Array<{ from: string | null; receivedAt: string }>;
}

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the example lasts for this visit only.
  }
}

export function readCaseDemoExtras(): CaseDemoExtras | null {
  const extras = read<CaseDemoExtras>(CASE_DEMO_KEY);
  return extras && typeof extras === "object" && typeof extras.loadedAt === "string" ? extras : null;
}

/** The reason each example answer carries: the catalogue's own codes. */
function exampleReason(item: ReportItem): DisputeReasonCode {
  if (item.category === "personal_info") return "wrong_personal_info";
  if (item.category === "inquiry") return "unauthorized_inquiry";
  return "wrong_dates";
}

/**
 * The example case's answers: personal details and every negative item marked
 * inaccurate, the rest "se ve correcto". Invented, like the rest of the example.
 */
export function exampleFlags(items: readonly ReportItem[], at: string): FlagsMap {
  return Object.fromEntries(
    items.map((item) => [
      item.fingerprint,
      item.negative || item.category === "personal_info"
        ? { state: "attested" as const, attestedAt: at, reasonCode: exampleReason(item) }
        : { state: "correct" as const },
    ]),
  );
}

/** Every date of the example case, counted back from `now`. Pure, for the tests. */
export function exampleCaseDates(now: Date) {
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS);
  const acknowledged = ago(27, 3);
  const signed = ago(27, 2);
  const deadline = cancellationDeadline(signed);
  // The team starts on the first working day after the window, prepares, and mails the next day.
  const prepared = new Date(firstWorkingDay(deadline).getTime() + 15 * HOUR_MS);
  const mailed = new Date(prepared.getTime() + 2 * DAY_MS);
  return {
    acknowledged,
    signed,
    deadline,
    idReceived: ago(27, 1),
    addressReceived: ago(26, 20),
    checked: ago(26, 2),
    reportImported: ago(25, 4),
    reviewFinished: ago(24, 5),
    prepared,
    mailed,
    delivered: new Date(mailed.getTime() + 4 * DAY_MS + 3 * HOUR_MS),
    charged: new Date(mailed.getTime() + 1 * DAY_MS + 2 * HOUR_MS),
    answer: ago(1, 6),
  };
}

/**
 * Load the example case into this device's stores. Every screen reads it from
 * there, so they all agree. Demo only: the callers check isDemoMode().
 */
export function loadExampleCase(now: Date = new Date()): void {
  const d = exampleCaseDates(now);
  const terms = resolveTerms();
  const agreement: AgreementState = {
    ...EMPTY_AGREEMENT,
    disclosureAcknowledgedAt: d.acknowledged.toISOString(),
    signedAt: d.signed.toISOString(),
    cancellationDeadline: d.deadline.toISOString(),
    cancelledAt: null,
    serviceEndRequestedAt: null,
    version: AGREEMENT_VERSION,
    locale: "es",
    signerName: "Rosa Martínez (ejemplo)",
    terms,
  };
  writeStoredAgreement(agreement);

  const items = DEMO_CLIENT_REPORT.items;
  const flags = exampleFlags(items, d.reviewFinished.toISOString());
  const mailedAt = d.mailed.toISOString();
  write(STORAGE_KEY, flags);
  write(APPROVED_KEY, true);
  write(MAILED_KEY, flags);
  write(MAILED_AT_KEY, mailedAt);

  // The round's letters: certified ones show the post office's delivery scan.
  const { plan } = sessionPlan(items, flags);
  const mail: Record<string, Partial<ClientLetterMail>> = {};
  for (const letter of plan.letters) {
    const mailClass = defaultMailClass(letter.templateKey, letter.target.type);
    mail[letterMailKey(letter.target.key, letter.templateKey)] = {
      mailClass,
      status: "delivered",
      mailedAt,
      deliveredAt: d.delivered.toISOString(),
      returnedAt: null,
    };
  }
  write(LETTER_MAIL_KEY, mail);

  // The payments: the round's one charge, the day after the mailing, with a demo card.
  const fee = feeToCents(terms.monthlyFee) ?? 0;
  const chargedAt = d.charged.toISOString();
  const charge: BillingCharge = {
    id: `dmx1${Math.floor(d.mailed.getTime() / 60000).toString(36)}`,
    roundNumber: 1,
    amountCents: fee,
    status: "succeeded",
    workDate: mailedAt,
    createdAt: chargedAt,
    attempts: 1,
    lastAttemptAt: chargedAt,
    nextAttemptAt: null,
    chargedAt,
    failureCode: null,
    refund: null,
  };
  const billing: DemoBillingState = {
    scenario: "live",
    method: {
      token: "demo_tok_visa_4242",
      brand: "visa",
      last4: "4242",
      addedAt: d.reviewFinished.toISOString(),
      authorizationVersion: "example",
      authorizedAt: d.reviewFinished.toISOString(),
      authorizationHash: "example",
    },
    agreement: null,
    rounds: [{ number: 1, mailed: true, mailedAt, letters: plan.letters.map((l) => ({ recipient: l.target.name, returned: false })) }],
    charges: [charge],
  };
  writeDemoBilling(billing);

  const extras: CaseDemoExtras = {
    loadedAt: now.toISOString(),
    documents: [
      { kind: "government_id", receivedAt: d.idReceived.toISOString(), checkedAt: d.checked.toISOString() },
      { kind: "proof_of_address", receivedAt: d.addressReceived.toISOString(), checkedAt: d.checked.toISOString() },
    ],
    reportImportedAt: d.reportImported.toISOString(),
    reviewFinishedAt: d.reviewFinished.toISOString(),
    roundPreparedAt: d.prepared.toISOString(),
    answers: [{ from: "Experian", receivedAt: d.answer.toISOString() }],
  };
  write(CASE_DEMO_KEY, extras);
}

/** Forget the example (and everything else this device saved for the case), to start the demo again. */
export function clearDemoCase(): void {
  writeStoredAgreement(null);
  for (const key of [STORAGE_KEY, APPROVED_KEY, MAILED_KEY, MAILED_AT_KEY, LETTER_MAIL_KEY, CASE_DEMO_KEY, DEMO_REVIEW_DONE_KEY, BILLING_STORAGE_KEY]) {
    write(key, null);
  }
  try {
    window.localStorage.setItem("bonalti.paymentMethodOnFile", "0");
  } catch {
    // ignore
  }
}

/** The demo report's date on this device: the first time it was shown here. */
export function demoReportImportedAt(now: Date = new Date()): string {
  const saved = read<string>(DEMO_REPORT_AT_KEY);
  if (saved && !Number.isNaN(Date.parse(saved))) return saved;
  const at = now.toISOString();
  write(DEMO_REPORT_AT_KEY, at);
  return at;
}

/** The first time this device saw the demo review complete; null while it is not. */
export function demoReviewFinishedAt(done: boolean, now: Date = new Date()): string | null {
  if (!done) return null;
  const saved = read<string>(DEMO_REVIEW_DONE_KEY);
  if (saved && !Number.isNaN(Date.parse(saved))) return saved;
  const at = now.toISOString();
  write(DEMO_REVIEW_DONE_KEY, at);
  return at;
}

/** What the demo device knows, as case facts. Pure apart from the dates it remembers. */
export interface DeviceCaseInput {
  agreement: AgreementState | null;
  items: readonly ReportItem[];
  flags: FlagsMap;
  roundFlags: FlagsMap;
  roundApproved: boolean;
  roundMailedAt: string | null;
  letterMail: Record<string, Partial<ClientLetterMail>>;
  charges: BillingCharge[];
  showAmounts: boolean;
  extras: CaseDemoExtras | null;
  reportImportedAt: string;
  reviewFinishedAt: string | null;
}

export function deviceCaseFacts(input: DeviceCaseInput): CaseFacts {
  const { items, flags, extras } = input;
  const answered = items.filter((i) => flags[i.fingerprint]);
  const confirmed = answered.filter((i) => flags[i.fingerprint]?.state === "attested").length;
  const { plan, roundNumber } = sessionPlan([...items], input.roundFlags);
  const mailed = input.roundApproved && plan.letters.length > 0;
  const mailedAt = mailed ? input.roundMailedAt ?? null : null;
  return {
    agreement: input.agreement,
    documents: extras?.documents ?? [],
    reportImports: [extras?.reportImportedAt ?? input.reportImportedAt],
    review: {
      total: items.length,
      reviewed: answered.length,
      confirmed,
      finishedAt: answered.length === items.length ? (extras?.reviewFinishedAt ?? input.reviewFinishedAt) : null,
    },
    rounds: mailed
      ? [
          {
            number: roundNumber,
            preparedAt: extras?.roundPreparedAt ?? null,
            mailedAt,
            letters: plan.letters.map((l) => {
              const saved = input.letterMail[letterMailKey(l.target.key, l.templateKey)];
              const mailClass = saved?.mailClass ?? defaultMailClass(l.templateKey, l.target.type);
              return {
                recipient: l.target.name,
                mailClass,
                status: saved?.status ?? "in_transit",
                mailedAt: saved?.mailedAt ?? mailedAt,
                // A delivery date is shown only when one was saved; nothing is made up.
                deliveredAt: saved?.status === "delivered" ? saved.deliveredAt ?? null : null,
                returnedAt: saved?.returnedAt ?? null,
              };
            }),
            answers: extras?.answers ?? [],
          },
        ]
      : [],
    charges: input.charges.map((c) => ({
      roundNumber: c.roundNumber,
      amountCents: input.showAmounts ? c.amountCents : null,
      status: c.status,
      at: c.chargedAt ?? c.lastAttemptAt ?? c.createdAt,
      workDate: c.workDate,
      refundedAt: c.refund?.completedAt ?? c.refund?.at ?? null,
    })),
  };
}
