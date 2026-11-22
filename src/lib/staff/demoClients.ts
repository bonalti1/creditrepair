import { attachDemoAutopilot } from "../autopilot/demo";
import { BRAND } from "../brand";
import { cancellationDeadline } from "../agreement/businessDays";
import { AGREEMENT_VERSION } from "../agreement/documents";
import { resolveTerms } from "../agreement/terms";
import { nextRetryAt } from "../billing/dunning";
import { feeToCents } from "../billing/rules";
import { NO_BILLING, type BillingCharge } from "../billing/types";
import { buildAttackPlan } from "../domain/attack";
import { parseReport, type RawReport } from "../domain/parser";
import type { ItemFlag, NormalizedReport, ReportItem } from "../domain/types";
import type { DisputeReasonCode } from "../letters/reasons";
import { DEMO_RAW_REPORT } from "../demo";
import { attachDemoIntake } from "../intake/demo";
import { attachDemoSelfHealing } from "../autopilot/selfHealingDemo";
import { paidCharge, sampleMethod } from "./billing";
import type {
  ItemAnswer,
  MailStatus,
  RoundStatus,
  StaffChatMessage,
  StaffClient,
  StaffLetter,
  StaffRound,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DEMO DATA. Nobody in this file exists.
//
// Thirty-six invented clients for the staff console, spread across every
// stage, every kind of exception and every state of billing. A few have a conversation with the assistant on file. Names are made up, phone numbers use the
// reserved fictional range (555-01xx), addresses are placeholders and the
// reports are variations of the app's demo report (src/lib/demo.ts).
//
// Every date is counted back from "now", so the demo looks the same whenever
// it is opened: the client who stalled 8 days ago always stalled 8 days ago.
//
// The one thing that follows the real calendar is the cancellation window: it
// ends on the 3rd business day after signing, so its length depends on the
// weekday. To keep the picture the same on any day, everyone whose story is
// past the window signed at least 7 days ago (the window never lasts that
// long), and the one client inside it signed yesterday (it never ends that soon).
//
// Billing is invented too, and consistent with the rounds: a charge exists
// only for a round that was mailed, dated the day after the mailing. The fee
// is the one set for the plan (NEXT_PUBLIC_PLAN_MONTHLY_FEE); while the owner
// has not set one, an example amount stands in so the demo has something to
// show. It is not a price anyone decided.
// ─────────────────────────────────────────────────────────────────────────

/** Example fee for the demo when the plan fee is not configured. Not a real price. */
export const DEMO_EXAMPLE_FEE = "89.00";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type Shape = "base" | "medical" | "extra_inquiry";

interface ReportSpec {
  pulledDaysAgo: number;
  shape: Shape;
  /** Leave out the old-address entry: the bureau removed it after round 1. */
  withoutOldAddress?: boolean;
}

function rawReport(person: { first: string; last: string; city: string; zip: string }, shape: Shape): RawReport {
  const raw = structuredClone(DEMO_RAW_REPORT);
  const eq = raw.bureaus.equifax!;
  const ex = raw.bureaus.experian!;
  const tu = raw.bureaus.transunion!;

  const streetNumber = 100 + ((person.first.length * 37 + person.last.length * 11) % 800);
  eq.personalInfo = [
    { field: "address", value: `${streetNumber} Old Street Apt 2, ${person.city}, TX ${person.zip}` },
    { field: "name", value: `${person.first.charAt(0)}. ${person.last.toUpperCase()} JR` },
  ];
  ex.personalInfo = [{ field: "employer", value: "ACME LLC" }];

  const shift = (person.first.length + person.last.length) % 9;
  eq.score = 548 + shift * 3;
  ex.score = 561 + shift * 2;
  tu.score = 544 + shift * 4;

  if (shape === "medical") {
    tu.tradelines.push({
      creditor: "Sample Medical Collections",
      accountNumberMasked: "****4410",
      accountType: "collection",
      status: "collection",
      paymentStatus: "",
      balance: 640,
      openedAt: "2025-03-11",
      firstDelinquencyAt: "2024-10-02",
      remarks: ["placed for collection"],
      furnisher: { name: "Sample Medical Collections", addressLines: ["P.O. Box 0000", "Dallas, TX 75201"] },
    });
    tu.personalInfo.push({ field: "name", value: `${person.first.toUpperCase()} ${person.last.toUpperCase().slice(0, -1)}` });
  }
  if (shape === "extra_inquiry") {
    ex.inquiries.push({ inquirer: "Example Wireless", date: "2026-05-22", type: "hard" });
  }
  return raw;
}

/** What an invented client said is wrong with an item: the standard reason they picked and their own words. */
function ownReason(item: ReportItem): { code: DisputeReasonCode; note: string } | null {
  const data = item.data as { field?: string; accountType?: string };
  if (item.category === "personal_info") {
    if (data.field === "address") return { code: "wrong_personal_info", note: "Nunca he vivido en esta dirección." };
    if (data.field === "name") return { code: "wrong_personal_info", note: "Así no se escribe mi nombre." };
    return { code: "wrong_personal_info", note: "Nunca trabajé para esta empresa." };
  }
  if (item.category === "tradeline") {
    if (data.accountType !== "collection") return null;
    return item.name === "Sample Medical Collections"
      ? { code: "wrong_balance", note: "El saldo no coincide con lo que debo." }
      : { code: "not_mine", note: "No reconozco esta deuda." };
  }
  if (item.category === "inquiry") {
    return item.name === "Auto Finance Corp" ? null : { code: "unauthorized_inquiry", note: "No autoricé esta consulta." };
  }
  return null;
}

/**
 * The client's answers: the first `answered` items of the report, in report
 * order. `withReasonCodes: false` is a client who confirmed before the reason
 * picker existed: the same answers and the same words, with no reason code.
 */
function answersFor(
  report: NormalizedReport,
  answered: number,
  at: string,
  withReasonCodes = true,
): Record<string, ItemAnswer> {
  const answers: Record<string, ItemAnswer> = {};
  report.items.slice(0, answered).forEach((item) => {
    const reason = ownReason(item);
    answers[item.fingerprint] = reason
      ? {
          status: "inaccurate",
          reason: reason.note,
          ...(withReasonCodes ? { reasonCode: reason.code } : {}),
          confirmedAt: at,
        }
      : { status: "correct", answeredAt: at };
  });
  return answers;
}

/**
 * Letters for a round, from the same engine the client app uses. Only items
 * the client confirmed as inaccurate can enter a letter; the engine enforces it.
 */
function lettersFor(
  clientId: string,
  roundNumber: number,
  report: NormalizedReport,
  answers: Record<string, ItemAnswer>,
  mailStatus: MailStatus,
): StaffLetter[] {
  const flags: ItemFlag[] = report.items.flatMap((item) => {
    const answer = answers[item.fingerprint];
    return answer?.status === "inaccurate"
      ? [{ fingerprint: item.fingerprint, reason: answer.reason, attested: true, attestedAt: answer.confirmedAt }]
      : [];
  });
  const byFingerprint = new Map(report.items.map((i) => [i.fingerprint, i]));
  const plan = buildAttackPlan({ roundNumber, items: report.items, flags, history: {} });
  return plan.letters.map((letter, index) => ({
    id: `${clientId}-r${roundNumber}-c${index + 1}`,
    recipient: letter.target,
    templateKey: letter.templateKey,
    category: letter.category,
    stage: letter.stage,
    items: letter.itemFingerprints.flatMap((fp) => byFingerprint.get(fp) ?? []),
    // The reason each item carried when the letter was written. Only the client's own choice gets here.
    itemReasons: Object.fromEntries(
      letter.itemFingerprints.flatMap((fp) => {
        const answer = answers[fp];
        return answer?.status === "inaccurate" && answer.reasonCode ? [[fp, answer.reasonCode]] : [];
      }),
    ),
    mailStatus,
  }));
}

export function buildDemoClients(now: Date): StaffClient[] {
  // An hour of slack keeps "8 days ago" at 8 whole days if the clock moves a
  // little between building the data and reading it.
  const ago = (days: number, hours = 0): string =>
    new Date(now.getTime() - days * DAY_MS - (hours + 1) * HOUR_MS).toISOString();

  interface Seed {
    id: string;
    first: string;
    last: string;
    phone: string;
    city: string;
    zip: string;
    salesperson: string;
    createdDaysAgo: number;
    signedUpDaysAgo?: number;
    agreementDaysAgo?: number;
    documents?: StaffClient["documents"];
    report?: ReportSpec;
    /** Items answered so far; omitted means all of them. */
    answered?: number;
    answeredDaysAgo?: number;
    lastActivityDaysAgo: number;
    /** Days since the client put a payment method on file; omitted means none yet. */
    paymentMethodDaysAgo?: number;
    /** True for a client who answered before the reason picker existed: answers without a reason code. */
    beforeReasons?: boolean;
  }

  const fee = resolveTerms().monthlyFee ?? DEMO_EXAMPLE_FEE;
  const methodDaysAgo = new Map<string, number>();
  const people = new Map<string, { first: string; last: string; city: string; zip: string }>();
  const answeredBeforeReasons = new Set<string>();

  const make = (seed: Seed): StaffClient => {
    const person = { first: seed.first, last: seed.last, city: seed.city, zip: seed.zip };
    people.set(seed.id, person);
    if (seed.beforeReasons) answeredBeforeReasons.add(seed.id);
    let report: NormalizedReport | null = null;
    let answers: Record<string, ItemAnswer> = {};
    if (seed.report) {
      const raw = rawReport(person, seed.report.shape);
      raw.pulledAt = ago(seed.report.pulledDaysAgo);
      if (seed.report.withoutOldAddress) {
        raw.bureaus.equifax!.personalInfo = raw.bureaus.equifax!.personalInfo.filter((p) => p.field !== "address");
      }
      report = parseReport(raw);
      answers = answersFor(
        report,
        seed.answered ?? report.items.length,
        ago(seed.answeredDaysAgo ?? Math.max(0, seed.report.pulledDaysAgo - 1)),
        !seed.beforeReasons,
      );
    }
    const signedUp = seed.signedUpDaysAgo !== undefined;
    const signedAt = seed.agreementDaysAgo !== undefined ? ago(seed.agreementDaysAgo) : null;
    if (seed.paymentMethodDaysAgo !== undefined) methodDaysAgo.set(seed.id, seed.paymentMethodDaysAgo);
    return {
      id: seed.id,
      firstName: seed.first,
      lastName: seed.last,
      phone: seed.phone,
      state: "TX",
      addressLines: signedUp ? [`${200 + seed.first.length * 13} Calle Ejemplo`, `${seed.city}, TX ${seed.zip}`] : [],
      salesperson: seed.salesperson,
      createdAt: ago(seed.createdDaysAgo),
      signedUpAt: signedUp ? ago(seed.signedUpDaysAgo!) : null,
      agreementSignedAt: signedAt,
      // The disclosure statements are acknowledged first, a few minutes before the contract.
      disclosureAcknowledgedAt: signedAt ? new Date(new Date(signedAt).getTime() - 6 * 60 * 1000).toISOString() : null,
      agreementVersion: signedAt ? AGREEMENT_VERSION : null,
      cancellationDeadline: signedAt ? cancellationDeadline(new Date(signedAt)).toISOString() : null,
      agreementCancelledAt: null,
      cancelledWithinWindow: null,
      serviceEndRequestedAt: null,
      serviceEndReason: null,
      documents: seed.documents ?? [],
      report,
      answers,
      rounds: [],
      // The fee as printed in the agreement this client signed.
      agreementMonthlyFee: signedAt ? fee : null,
      // Filled in below, once the rounds exist: a charge is always for a mailed round.
      billing: NO_BILLING,
      lastActivityAt: ago(seed.lastActivityDaysAgo, 2),
      notes: [],
      questions: [],
      handled: {},
    };
  };

  /** A round built from the client's current report and answers. */
  const round = (
    client: StaffClient,
    number: number,
    status: RoundStatus,
    dates: { mailedDaysAgo?: number; respondedDaysAgo?: number } = {},
    from?: { report: NormalizedReport; answers: Record<string, ItemAnswer> },
  ): StaffRound => {
    const mailStatus: MailStatus =
      status === "draft" || status === "ready"
        ? "not_sent"
        : (dates.mailedDaysAgo ?? 0) >= 5
          ? "delivered"
          : "in_transit";
    return {
      number,
      status,
      mailedAt: dates.mailedDaysAgo !== undefined ? ago(dates.mailedDaysAgo) : null,
      respondedAt: dates.respondedDaysAgo !== undefined ? ago(dates.respondedDaysAgo) : null,
      letters: lettersFor(client.id, number, from?.report ?? client.report!, from?.answers ?? client.answers, mailStatus),
    };
  };

  /** The report a round was written from, when the client now has a newer one. */
  const earlier = (client: StaffClient, seed: { shape: Shape; pulledDaysAgo: number }) => {
    const raw = rawReport(people.get(client.id)!, seed.shape);
    raw.pulledAt = ago(seed.pulledDaysAgo);
    const report = parseReport(raw);
    return {
      report,
      answers: answersFor(report, report.items.length, ago(seed.pulledDaysAgo - 1), !answeredBeforeReasons.has(client.id)),
    };
  };

  const both: StaffClient["documents"] = ["government_id", "proof_of_address"];

  /**
   * A stretch of a client's in-app conversation. Each line is who wrote it
   * ("client", "assistant" for a scripted line, "coach" for an AI answer to a typed
   * question, or a teammate's name), and the text. Lines are a minute apart,
   * starting at `startIso`.
   */
  const thread = (clientId: string, startIso: string, lines: Array<[who: string, text: string]>): StaffChatMessage[] =>
    lines.map(([who, text], index) => {
      const at = new Date(new Date(startIso).getTime() + index * 60 * 1000).toISOString();
      const id = `${clientId}-m-${at}`;
      if (who === "client") return { id, at, role: "user", source: "coach", text };
      if (who === "assistant") return { id, at, role: "assistant", source: "journey", text };
      if (who === "coach") return { id, at, role: "assistant", source: "coach", text };
      return { id, at, role: "assistant", source: "human", authorName: who, text };
    });

  // 1. Lead: sales is still talking with her.
  const mariana = make({
    id: "c01", first: "Mariana", last: "Robles", phone: "+17135550101", city: "Houston", zip: "77001",
    salesperson: "ana", createdDaysAgo: 1, lastActivityDaysAgo: 1,
  });
  mariana.notes = [{ id: "c01-n1", at: ago(1), author: "ana", text: "Escribió por el anuncio. Quiere comprar casa el próximo año. Le mando el enlace hoy." }];

  // 2. Created her account six days ago and has not signed the agreement.
  const yolanda = make({
    id: "c02", first: "Yolanda", last: "Cisneros", phone: "+12105550102", city: "San Antonio", zip: "78201",
    salesperson: "luis", createdDaysAgo: 8, signedUpDaysAgo: 6, lastActivityDaysAgo: 6,
  });

  // 3. Signed eight days ago; proof of address still missing.
  const rigoberto = make({
    id: "c03", first: "Rigoberto", last: "Almanza", phone: "+12145550103", city: "Dallas", zip: "75201",
    salesperson: "ana", createdDaysAgo: 12, signedUpDaysAgo: 10, agreementDaysAgo: 8,
    documents: ["government_id"], lastActivityDaysAgo: 8,
  });

  // 4. Everything in, waiting for her report; she asked something the assistant passed on.
  const itzel = make({
    id: "c04", first: "Itzel", last: "Bahena", phone: "+15125550104", city: "Austin", zip: "78701",
    salesperson: "carmen", createdDaysAgo: 9, signedUpDaysAgo: 8, agreementDaysAgo: 7,
    documents: both, lastActivityDaysAgo: 1,
  });
  itzel.questions = [
    { id: "c04-q1", askedAt: ago(1), text: "¿Puedo activar el monitoreo con mi ITIN en lugar del número de Seguro Social?", answeredAt: null },
  ];
  itzel.conversation = [
    ...thread("c04", ago(2, 3), [
      ["assistant", `Hola 👋 Soy ${BRAND.assistant}, tu asistente de crédito con IA. Para empezar activa tu monitoreo de crédito: en cuanto esté listo importo tu reporte y lo revisamos juntos.`],
    ]),
    // Her question, at the moment the assistant passed it to the team.
    ...thread("c04", ago(1), [
      ["client", "¿Puedo activar el monitoreo con mi ITIN en lugar del número de Seguro Social?"],
      ["coach", "No tengo una respuesta segura para eso y prefiero no adivinar. Ya le pasé tu pregunta al equipo: una persona te responde aquí mismo."],
    ]),
  ];

  // 5. Reviewing, on schedule: nothing to do.
  const fidel = make({
    id: "c05", first: "Fidel", last: "Carranza", phone: "+19155550105", city: "El Paso", zip: "79901",
    salesperson: "luis", createdDaysAgo: 9, signedUpDaysAgo: 8, agreementDaysAgo: 7, documents: both,
    report: { pulledDaysAgo: 2, shape: "base" }, answered: 3, answeredDaysAgo: 0, lastActivityDaysAgo: 0,
  });

  fidel.conversation = [
    ...thread("c05", ago(2), [
      ["assistant", `Hola 👋 Soy ${BRAND.assistant}, tu asistente de crédito con IA. Ya importé tu reporte de los 3 burós. Vamos a revisarlo juntos, punto por punto: yo te explico cada uno y tú decides.`],
    ]),
    ...thread("c05", ago(0, 3), [
      ["client", "¿Qué es una consulta dura?"],
      ["coach", "Una consulta dura aparece cuando una empresa revisa tu crédito porque pediste un crédito con ella. Si la reconoces, es correcta. Tú decides qué responder en cada punto."],
    ]),
  ];

  // 6. Review stalled: report in for eight days, two answers, quiet since.
  const lourdes = make({
    id: "c06", first: "Lourdes", last: "Zamudio", phone: "+17135550106", city: "Houston", zip: "77002",
    salesperson: "ana", createdDaysAgo: 12, signedUpDaysAgo: 11, agreementDaysAgo: 10, documents: both,
    report: { pulledDaysAgo: 8, shape: "medical" }, answered: 2, answeredDaysAgo: 6, lastActivityDaysAgo: 6,
  });

  // 7 and 8. Round 1 ready to mail.
  const anselmo = make({
    id: "c07", first: "Anselmo", last: "Quiroga", phone: "+12105550107", city: "San Antonio", zip: "78205",
    salesperson: "carmen", createdDaysAgo: 9, signedUpDaysAgo: 8, agreementDaysAgo: 7, documents: both,
    report: { pulledDaysAgo: 4, shape: "base" }, answeredDaysAgo: 1, lastActivityDaysAgo: 1, paymentMethodDaysAgo: 1,
  });
  anselmo.rounds = [round(anselmo, 1, "ready")];

  const brenda = make({
    id: "c08", first: "Brenda", last: "Olivares", phone: "+12145550108", city: "Dallas", zip: "75204",
    salesperson: "luis", createdDaysAgo: 11, signedUpDaysAgo: 10, agreementDaysAgo: 9,
    documents: [...both, "ssn_card"],
    report: { pulledDaysAgo: 6, shape: "medical" }, answeredDaysAgo: 0, lastActivityDaysAgo: 0,
  });
  brenda.rounds = [round(brenda, 1, "ready")];

  // 9. Round 1 prepared, but he took so long that the report is now too old to send on.
  const ramiro = make({
    id: "c09", first: "Ramiro", last: "Escobedo", phone: "+15125550109", city: "Austin", zip: "78704",
    salesperson: "ana", createdDaysAgo: 52, signedUpDaysAgo: 50, agreementDaysAgo: 49, documents: both,
    report: { pulledDaysAgo: 47, shape: "extra_inquiry" }, answeredDaysAgo: 1, lastActivityDaysAgo: 1, paymentMethodDaysAgo: 40,
  });
  ramiro.rounds = [round(ramiro, 1, "ready")];
  ramiro.notes = [{ id: "c09-n1", at: ago(20), author: "ana", text: "Estuvo de viaje por trabajo. Dijo que termina su revisión cuando regrese." }];

  // 10. Mailed twelve days ago: the system is waiting on the bureaus.
  const ernesto = make({
    id: "c10", first: "Ernesto", last: "Villaseñor", phone: "+19155550110", city: "El Paso", zip: "79902",
    salesperson: "carmen", createdDaysAgo: 22, signedUpDaysAgo: 21, agreementDaysAgo: 20, documents: both,
    report: { pulledDaysAgo: 16, shape: "base" }, answeredDaysAgo: 13, lastActivityDaysAgo: 3, paymentMethodDaysAgo: 14,
  });
  ernesto.rounds = [round(ernesto, 1, "mailed", { mailedDaysAgo: 12 })];

  // 11. Mailed nine days ago; the post office returned one letter.
  const graciela = make({
    id: "c11", first: "Graciela", last: "Montoya", phone: "+17135550111", city: "Houston", zip: "77003",
    salesperson: "luis", createdDaysAgo: 19, signedUpDaysAgo: 18, agreementDaysAgo: 17, documents: both,
    report: { pulledDaysAgo: 13, shape: "medical" }, answeredDaysAgo: 10, lastActivityDaysAgo: 4, paymentMethodDaysAgo: 11,
  });
  graciela.rounds = [round(graciela, 1, "mailed", { mailedDaysAgo: 9 })];
  graciela.rounds[0]!.letters[1]!.mailStatus = "returned";

  // 12. Mailed 35 days ago and no new report has come in. He answered before
  // the reason picker existed: his answers count and carry no reason code.
  const heriberto = make({
    id: "c12", first: "Heriberto", last: "Solís", phone: "+12105550112", city: "San Antonio", zip: "78207",
    salesperson: "ana", createdDaysAgo: 46, signedUpDaysAgo: 45, agreementDaysAgo: 44, documents: both,
    report: { pulledDaysAgo: 40, shape: "base" }, answeredDaysAgo: 37, lastActivityDaysAgo: 21,
    beforeReasons: true, paymentMethodDaysAgo: 38,
  });
  heriberto.rounds = [round(heriberto, 1, "mailed", { mailedDaysAgo: 35 })];

  // 13. Answers arrived two days ago; the system prepares round 2 next week.
  // She also answered before the reason picker existed.
  const paulina = make({
    id: "c13", first: "Paulina", last: "Arriaga", phone: "+12145550113", city: "Dallas", zip: "75206",
    salesperson: "carmen", createdDaysAgo: 44, signedUpDaysAgo: 43, agreementDaysAgo: 42, documents: both,
    report: { pulledDaysAgo: 2, shape: "base", withoutOldAddress: true }, answeredDaysAgo: 35, lastActivityDaysAgo: 2,
    beforeReasons: true, paymentMethodDaysAgo: 36,
  });
  {
    const first = earlier(paulina, { shape: "base", pulledDaysAgo: 37 });
    paulina.answers = { ...first.answers };
    paulina.rounds = [round(paulina, 1, "responded", { mailedDaysAgo: 33, respondedDaysAgo: 2 }, first)];
  }

  // 14. Round 1 answered; round 2 is prepared and ready to mail.
  const samuel = make({
    id: "c14", first: "Samuel", last: "Tejeda", phone: "+15125550114", city: "Austin", zip: "78745",
    salesperson: "luis", createdDaysAgo: 55, signedUpDaysAgo: 54, agreementDaysAgo: 53,
    documents: [...both, "ssn_card"],
    report: { pulledDaysAgo: 12, shape: "medical", withoutOldAddress: true }, answeredDaysAgo: 46, lastActivityDaysAgo: 5, paymentMethodDaysAgo: 47,
  });
  {
    const first = earlier(samuel, { shape: "medical", pulledDaysAgo: 48 });
    samuel.answers = { ...first.answers };
    samuel.rounds = [
      round(samuel, 1, "responded", { mailedDaysAgo: 43, respondedDaysAgo: 12 }, first),
      round(samuel, 2, "ready"),
    ];
  }
  samuel.notes = [{ id: "c14-n1", at: ago(12), author: "carmen", text: "Le avisé por WhatsApp que llegó su reporte nuevo." }];
  // A teammate already answered in his conversation once.
  samuel.conversation = [
    ...thread("c14", ago(13), [
      ["client", "¿Ya llegó mi reporte nuevo?"],
      ["coach", "Todavía no veo un reporte nuevo en tu cuenta. Le aviso al equipo para que lo revise contigo."],
    ]),
    ...thread("c14", ago(12), [
      ["carmen", "Hola Samuel, soy Carmen, del equipo. Tu reporte nuevo ya está en tu cuenta. Puedes verlo en la app cuando gustes."],
      ["client", "Gracias, ya lo vi."],
    ]),
  ];

  // 15. Letters out 20 days ago. The charge for that round was declined three
  // times (the day after mailing, then 3 and 7 days later): the retries are
  // used up and her case is paused until she updates her payment method.
  const noemi = make({
    id: "c15", first: "Noemí", last: "Barrientos", phone: "+19155550115", city: "El Paso", zip: "79905",
    salesperson: "carmen", createdDaysAgo: 30, signedUpDaysAgo: 29, agreementDaysAgo: 28, documents: both,
    report: { pulledDaysAgo: 24, shape: "extra_inquiry" }, answeredDaysAgo: 22, lastActivityDaysAgo: 9, paymentMethodDaysAgo: 23,
  });
  noemi.rounds = [round(noemi, 1, "mailed", { mailedDaysAgo: 20 })];

  // 16. Still reviewing. She said one account is the result of identity theft
  // and there is no identity theft report (FTC) on file: the app told her a
  // teammate would follow up, so a person has to.
  const dolores = make({
    id: "c16", first: "Dolores", last: "Nájera", phone: "+19565550116", city: "Laredo", zip: "78040",
    salesperson: "ana", createdDaysAgo: 9, signedUpDaysAgo: 8, agreementDaysAgo: 7, documents: both,
    report: { pulledDaysAgo: 3, shape: "base" }, answered: 4, answeredDaysAgo: 1, lastActivityDaysAgo: 1,
  });
  {
    const collection = dolores.report!.items.find((i) => i.bureau === "equifax" && i.name === "Midland Credit Management")!;
    dolores.answers[collection.fingerprint] = {
      status: "inaccurate",
      reasonCode: "identity_theft",
      reason: "Alguien abrió esta cuenta con mis datos. Yo no fui.",
      confirmedAt: ago(1),
    };
  }
  dolores.conversation = [
    ...thread("c16", ago(3), [
      ["assistant", `Hola 👋 Soy ${BRAND.assistant}, tu asistente de crédito con IA. Ya importé tu reporte de los 3 burós. Vamos a revisarlo juntos, punto por punto: yo te explico cada uno y tú decides.`],
    ]),
    ...thread("c16", ago(1), [
      ["assistant", "Anotado. Para este motivo hace falta un reporte de robo de identidad de la FTC. Una persona del equipo te va a contactar para seguir con ese paso."],
      ["client", "¿Y cómo saco ese reporte de la FTC?"],
      ["coach", "Se llena en IdentityTheft.gov, el sitio de la FTC, y no tiene costo. Una persona del equipo te va a escribir para ayudarte con ese paso."],
    ]),
  ];

  // 17. Signed yesterday: inside the 3-business-day cancellation window. Her
  // documents are in, and nothing may start yet. Nobody has to act; the system
  // shows the day work can begin.
  const estela = make({
    id: "c17", first: "Estela", last: "Coronado", phone: "+18065550117", city: "Lubbock", zip: "79401",
    salesperson: "luis", createdDaysAgo: 3, signedUpDaysAgo: 2, agreementDaysAgo: 1,
    documents: both, lastActivityDaysAgo: 1,
  });

  // 18. Signed six days ago and cancelled the next day, inside the window. He
  // had already reviewed his report and round 1 was prepared: it never goes out.
  const octavio = make({
    id: "c18", first: "Octavio", last: "Rentería", phone: "+13615550118", city: "Corpus Christi", zip: "78401",
    salesperson: "ana", createdDaysAgo: 8, signedUpDaysAgo: 7, agreementDaysAgo: 6, documents: both,
    report: { pulledDaysAgo: 6, shape: "base" }, answeredDaysAgo: 5, lastActivityDaysAgo: 5,
  });
  octavio.rounds = [round(octavio, 1, "ready")];
  octavio.agreementCancelledAt = ago(5);
  octavio.cancelledWithinWindow = true;
  octavio.notes = [{ id: "c18-n1", at: ago(5), author: "ana", text: "Canceló desde la app dentro de su plazo. No se le cobra nada." }];

  // 19. Round 1 went out 25 days ago; yesterday she asked to end the service.
  // Nothing more is sent, and a person confirms it with her.
  const rebeca = make({
    id: "c19", first: "Rebeca", last: "Ontiveros", phone: "+14325550119", city: "Midland", zip: "79701",
    salesperson: "carmen", createdDaysAgo: 36, signedUpDaysAgo: 35, agreementDaysAgo: 34, documents: both,
    report: { pulledDaysAgo: 29, shape: "extra_inquiry" }, answeredDaysAgo: 27, lastActivityDaysAgo: 1, paymentMethodDaysAgo: 28,
  });
  rebeca.rounds = [round(rebeca, 1, "mailed", { mailedDaysAgo: 25 })];
  rebeca.serviceEndRequestedAt = ago(1);
  rebeca.serviceEndReason = "Me voy a mudar fuera de Texas el próximo mes.";

  // 20. Two rounds mailed and both paid on time: the ordinary case.
  const leticia = make({
    id: "c20", first: "Leticia", last: "Varela", phone: "+19565550120", city: "McAllen", zip: "78501",
    salesperson: "luis", createdDaysAgo: 60, signedUpDaysAgo: 59, agreementDaysAgo: 58, documents: both,
    report: { pulledDaysAgo: 16, shape: "medical", withoutOldAddress: true }, answeredDaysAgo: 51, lastActivityDaysAgo: 6,
    paymentMethodDaysAgo: 52,
  });
  {
    const first = earlier(leticia, { shape: "medical", pulledDaysAgo: 53 });
    leticia.answers = { ...first.answers };
    leticia.rounds = [
      round(leticia, 1, "responded", { mailedDaysAgo: 48, respondedDaysAgo: 16 }, first),
      round(leticia, 2, "mailed", { mailedDaysAgo: 6 }),
    ];
  }

  // 21. Round 1 went out today. Nothing is charged yet: the system charges it
  // tomorrow, a day after mailing, so a round marked by mistake can be corrected.
  const joaquin = make({
    id: "c21", first: "Joaquín", last: "Medrano", phone: "+12545550121", city: "Waco", zip: "76701",
    salesperson: "ana", createdDaysAgo: 14, signedUpDaysAgo: 13, agreementDaysAgo: 12, documents: both,
    report: { pulledDaysAgo: 8, shape: "base" }, answeredDaysAgo: 3, lastActivityDaysAgo: 2,
    paymentMethodDaysAgo: 3,
  });
  joaquin.rounds = [round(joaquin, 1, "mailed", { mailedDaysAgo: 0 })];

  // 22. Round 1 went out three days ago; the first try at the charge was
  // declined and the system tries again tomorrow. Nobody on the team has to act.
  const ximena = make({
    id: "c22", first: "Ximena", last: "Duarte", phone: "+14095550122", city: "Beaumont", zip: "77701",
    salesperson: "carmen", createdDaysAgo: 16, signedUpDaysAgo: 15, agreementDaysAgo: 14, documents: both,
    report: { pulledDaysAgo: 9, shape: "extra_inquiry" }, answeredDaysAgo: 5, lastActivityDaysAgo: 3,
    paymentMethodDaysAgo: 5,
  });
  ximena.rounds = [round(ximena, 1, "mailed", { mailedDaysAgo: 3 })];

  // 23. Round 1 went out two days ago and he never put a payment method on
  // file: the charge is due and there is nothing to charge. A person asks him.
  const baltazar = make({
    id: "c23", first: "Baltazar", last: "Ibarra", phone: "+19035550123", city: "Tyler", zip: "75701",
    salesperson: "luis", createdDaysAgo: 15, signedUpDaysAgo: 14, agreementDaysAgo: 13, documents: both,
    report: { pulledDaysAgo: 9, shape: "base" }, answeredDaysAgo: 4, lastActivityDaysAgo: 4,
  });
  baltazar.rounds = [round(baltazar, 1, "mailed", { mailedDaysAgo: 2 })];

  // ── Months of history (for the business dashboard) ────────────────────
  // Clients from the last half year whose story is further along: several
  // rounds mailed about 40 days apart, the reports that came back after each
  // one, a few leads who never signed, and two who cancelled before any work
  // was done. None of them needs a person today and none has a round to send,
  // so the "needs a person" picture above is unchanged.
  //
  // What a later report no longer lists is recorded on the round it answered
  // (RoundResult, "removed"), exactly as an import records it: only what the
  // reports themselves show.
  function buildHistoryClients(): StaffClient[] {
    interface ReportState {
      shape: Shape;
      withoutOldAddress?: boolean;
    }
    /**
     * Rounds mailed and answered, oldest first. `states` are the reports: the
     * first one the client reviewed, then the one that answered each round
     * (so one more than the rounds answered). The newest is the client's report.
     */
    const withHistory = (client: StaffClient, states: ReportState[], rounds: Array<{ mailed: number; responded?: number }>) => {
      const person = people.get(client.id)!;
      const pulledDaysAgo = (k: number) => (k === 0 ? rounds[0]!.mailed + 4 : rounds[k - 1]!.responded!);
      const reports = states.map((state, k) => {
        const raw = rawReport(person, state.shape);
        raw.pulledAt = ago(pulledDaysAgo(k));
        if (state.withoutOldAddress) {
          raw.bureaus.equifax!.personalInfo = raw.bureaus.equifax!.personalInfo.filter((p) => p.field !== "address");
        }
        return parseReport(raw);
      });
      const answers = answersFor(reports[0]!, reports[0]!.items.length, ago(pulledDaysAgo(0) - 1));
      client.report = reports[reports.length - 1]!;
      client.answers = answers;
      client.rounds = rounds.map((r, i) => {
        const status: RoundStatus = r.responded !== undefined ? "responded" : "mailed";
        const built = round(client, i + 1, status, { mailedDaysAgo: r.mailed, respondedDaysAgo: r.responded }, { report: reports[i]!, answers });
        const next = r.responded !== undefined ? reports[i + 1] : undefined;
        if (!next) return built;
        const still = new Set(next.items.map((item) => item.fingerprint));
        const gone = [...new Set(built.letters.flatMap((l) => l.items.map((item) => item.fingerprint)))].filter((fp) => !still.has(fp));
        return gone.length > 0
          ? { ...built, results: gone.map((fingerprint) => ({ fingerprint, outcome: "removed" as const, reportDate: next.pulledAt })) }
          : built;
      });
    };

    const both: StaffClient["documents"] = ["government_id", "proof_of_address"];
    const later: ReportState = { shape: "base", withoutOldAddress: true };

    // 24. Five rounds since spring; the fifth went out 25 days ago.
    const rosa = make({
      id: "c24", first: "Rosa", last: "Delgado", phone: "+17135550124", city: "Houston", zip: "77004",
      salesperson: "ana", createdDaysAgo: 200, signedUpDaysAgo: 198, agreementDaysAgo: 197, documents: both,
      lastActivityDaysAgo: 4, paymentMethodDaysAgo: 196,
    });
    withHistory(rosa, [{ shape: "medical" }, { shape: "medical", withoutOldAddress: true }, later, later, later], [
      { mailed: 188, responded: 157 }, { mailed: 147, responded: 116 }, { mailed: 106, responded: 75 }, { mailed: 66, responded: 35 }, { mailed: 25 },
    ]);
    rosa.conversation = thread("c24", ago(4, 5), [
      ["client", "¿Ya salieron mis cartas de esta ronda?"],
      ["marta", "Hola Rosa, soy Marta, del equipo. Sí, tu ronda 5 salió hace unos días. Te avisamos aquí cuando llegue tu reporte nuevo."],
      ["client", "Gracias, Marta."],
    ]);

    // 25. Four rounds; the fourth is with the bureaus.
    const gerardo = make({
      id: "c25", first: "Gerardo", last: "Fuentes", phone: "+12105550125", city: "San Antonio", zip: "78209",
      salesperson: "luis", createdDaysAgo: 170, signedUpDaysAgo: 168, agreementDaysAgo: 160, documents: both,
      lastActivityDaysAgo: 9, paymentMethodDaysAgo: 159,
    });
    withHistory(gerardo, [{ shape: "extra_inquiry" }, { shape: "extra_inquiry", withoutOldAddress: true }, later, later], [
      { mailed: 150, responded: 119 }, { mailed: 110, responded: 79 }, { mailed: 70, responded: 39 }, { mailed: 29 },
    ]);

    // 26. Three rounds answered; the system prepares round 4 in two days.
    const patricia = make({
      id: "c26", first: "Patricia", last: "Lozano", phone: "+12145550126", city: "Dallas", zip: "75208",
      salesperson: "carmen", createdDaysAgo: 140, signedUpDaysAgo: 139, agreementDaysAgo: 133, documents: both,
      lastActivityDaysAgo: 6, paymentMethodDaysAgo: 132,
    });
    withHistory(patricia, [{ shape: "medical" }, { shape: "medical", withoutOldAddress: true }, later, later], [
      { mailed: 120, responded: 89 }, { mailed: 80, responded: 49 }, { mailed: 38, responded: 6 },
    ]);

    // 27. Three rounds; the third went out 17 days ago.
    const hector = make({
      id: "c27", first: "Héctor", last: "Valdez", phone: "+15125550127", city: "Austin", zip: "78702",
      salesperson: "luis", createdDaysAgo: 110, signedUpDaysAgo: 108, agreementDaysAgo: 107, documents: both,
      lastActivityDaysAgo: 12, paymentMethodDaysAgo: 106,
    });
    withHistory(hector, [{ shape: "extra_inquiry" }, { shape: "extra_inquiry", withoutOldAddress: true }, later], [
      { mailed: 98, responded: 67 }, { mailed: 57, responded: 26 }, { mailed: 17 },
    ]);

    // 28. A slow start (37 days from signing to round 1); round 2 is out.
    const silvia = make({
      id: "c28", first: "Silvia", last: "Cárdenas", phone: "+19155550128", city: "El Paso", zip: "79903",
      salesperson: "ana", createdDaysAgo: 95, signedUpDaysAgo: 94, agreementDaysAgo: 92, documents: both,
      lastActivityDaysAgo: 13, paymentMethodDaysAgo: 91,
    });
    withHistory(silvia, [{ shape: "medical" }, later], [{ mailed: 55, responded: 24 }, { mailed: 13 }]);

    // 29. Two rounds; the second is with the bureaus.
    const tomas = make({
      id: "c29", first: "Tomás", last: "Guerrero", phone: "+19565550129", city: "Laredo", zip: "78041",
      salesperson: "carmen", createdDaysAgo: 80, signedUpDaysAgo: 79, agreementDaysAgo: 78, documents: both,
      lastActivityDaysAgo: 2, paymentMethodDaysAgo: 77,
    });
    withHistory(tomas, [{ shape: "base" }, later], [{ mailed: 70, responded: 39 }, { mailed: 29 }]);
    tomas.conversation = thread("c29", ago(2, 6), [
      ["client", "Me llegó una carta de Equifax a mi casa. ¿Se la mando a ustedes?"],
      ["marta", "Hola Tomás, soy Marta. Sí, por favor: tómale una foto y súbela en la app, en «Documentos». La revisamos con tu reporte nuevo."],
    ]);

    // 30. Round 1 answered 24 days ago and round 2 not yet out: behind the 40-day cycle.
    const adriana = make({
      id: "c30", first: "Adriana", last: "Pineda", phone: "+19565550130", city: "McAllen", zip: "78503",
      salesperson: "luis", createdDaysAgo: 65, signedUpDaysAgo: 64, agreementDaysAgo: 63, documents: both,
      lastActivityDaysAgo: 20, paymentMethodDaysAgo: 62,
    });
    withHistory(adriana, [{ shape: "extra_inquiry" }, later], [{ mailed: 55, responded: 24 }]);

    // 31 and 32. Leads who never created their account.
    const julio = make({
      id: "c31", first: "Julio", last: "Becerra", phone: "+17135550131", city: "Houston", zip: "77005",
      salesperson: "ana", createdDaysAgo: 75, lastActivityDaysAgo: 70,
    });
    const marisol = make({
      id: "c32", first: "Marisol", last: "Treviño", phone: "+12105550132", city: "San Antonio", zip: "78210",
      salesperson: "luis", createdDaysAgo: 50, lastActivityDaysAgo: 47,
    });

    // 33. Signed and cancelled the next day, inside the window. Nothing was done or charged.
    const diego = make({
      id: "c33", first: "Diego", last: "Arellano", phone: "+13615550133", city: "Corpus Christi", zip: "78404",
      salesperson: "carmen", createdDaysAgo: 122, signedUpDaysAgo: 120, agreementDaysAgo: 118, lastActivityDaysAgo: 117,
    });
    diego.agreementCancelledAt = ago(117);
    diego.cancelledWithinWindow = true;

    // 34. Reviewed her report, then cancelled after the window, before any round went out. Nothing was charged.
    const lorena = make({
      id: "c34", first: "Lorena", last: "Saucedo", phone: "+14325550134", city: "Odessa", zip: "79761",
      salesperson: "ana", createdDaysAgo: 62, signedUpDaysAgo: 60, agreementDaysAgo: 58, documents: both,
      report: { pulledDaysAgo: 54, shape: "base" }, answeredDaysAgo: 50, lastActivityDaysAgo: 45,
    });
    lorena.agreementCancelledAt = ago(45);
    lorena.cancelledWithinWindow = false;
    lorena.notes = [{ id: "c34-n1", at: ago(45), author: "ana", text: "Canceló: prefiere esperar a después de su mudanza. No se le cobró nada." }];

    // 35. Added by hand from a phone call; the invitation went out.
    const norma = make({
      id: "c35", first: "Norma", last: "Ybarra", phone: "+19035550135", city: "Tyler", zip: "75702",
      salesperson: "carmen", createdDaysAgo: 25, lastActivityDaysAgo: 25,
    });
    norma.addedBy = "carmen";
    norma.goal = "auto";

    // 36. Round 1 went out 24 days ago.
    const fabian = make({
      id: "c36", first: "Fabián", last: "Mora", phone: "+12545550136", city: "Killeen", zip: "76541",
      salesperson: "luis", createdDaysAgo: 40, signedUpDaysAgo: 39, agreementDaysAgo: 38, documents: both,
      lastActivityDaysAgo: 10, paymentMethodDaysAgo: 37,
    });
    withHistory(fabian, [{ shape: "medical" }], [{ mailed: 24 }]);

    return [rosa, gerardo, patricia, hector, silvia, tomas, adriana, julio, marisol, diego, lorena, norma, fabian];
  }

  const history = buildHistoryClients();

  const clients = [
    mariana, yolanda, rigoberto, itzel, fidel, lourdes, anselmo, brenda,
    ramiro, ernesto, graciela, heriberto, paulina, samuel, noemi, dolores,
    estela, octavio, rebeca, leticia, joaquin, ximena, baltazar,
    ...history,
  ];

  // ── Billing ───────────────────────────────────────────────────────────
  // The ordinary case first: whoever has a payment method on file was charged
  // for each round the day after it was mailed, and paid. A round mailed
  // today has no charge yet.
  for (const client of clients) {
    const days = methodDaysAgo.get(client.id);
    if (days === undefined) continue;
    const due = (r: StaffRound) => Boolean(r.mailedAt) && new Date(r.mailedAt!).getTime() + DAY_MS <= now.getTime();
    client.billing = {
      paymentMethod: sampleMethod(ago(days)),
      charges: client.rounds.filter(due).map((r) => paidCharge(client.id, r, fee)),
      pause: null,
    };
  }

  /** A charge for round 1 that was declined `attempts` times, the last time `lastDaysAgo` days ago. */
  const declined = (client: StaffClient, attempts: number, lastDaysAgo: number): BillingCharge => {
    const mailed = client.rounds[0]!;
    const last = ago(lastDaysAgo);
    return {
      id: `${client.id}-ch1`,
      roundNumber: 1,
      amountCents: feeToCents(fee) ?? 0,
      status: "failed",
      workDate: mailed.mailedAt!,
      createdAt: new Date(new Date(mailed.mailedAt!).getTime() + DAY_MS).toISOString(),
      attempts,
      lastAttemptAt: last,
      nextAttemptAt: nextRetryAt(attempts, new Date(last))?.toISOString() ?? null,
      chargedAt: null,
      failureCode: "card_declined",
      refund: null,
    };
  };

  // Ernesto was charged for round 1 and the charge was returned in full: two
  // of his letters had gone out with an old address.
  {
    const charge = ernesto.billing.charges[0]!;
    ernesto.billing = {
      ...ernesto.billing,
      charges: [
        {
          ...charge,
          status: "refunded",
          refund: {
            id: "c10-re1",
            amountCents: charge.amountCents,
            reason: "Dos de sus cartas salieron con su dirección anterior. Se le devuelve el cobro de la ronda 1.",
            by: "carmen",
            at: ago(9),
            completedAt: ago(9),
          },
        },
      ],
    };
    ernesto.notes = [{ id: "c10-n1", at: ago(9), author: "carmen", text: "Le devolvimos el cobro de la ronda 1 y le avisé por WhatsApp." }];
  }

  // Noemí: declined the day after mailing, then 3 and 7 days later. Out of retries.
  noemi.billing = { paymentMethod: sampleMethod(ago(23), "0341", "mastercard"), charges: [declined(noemi, 3, 12)], pause: null };

  // Ximena: declined once, two days ago; the next try is tomorrow.
  ximena.billing = { paymentMethod: sampleMethod(ago(5), "7718"), charges: [declined(ximena, 1, 2)], pause: null };

  // ── Who works each client ─────────────────────────────────────────────
  // The demo team is in team.ts (buildDemoTeam): Carmen administers and works
  // cases, Marta is the specialist, Ana and Luis sell. Leads and people who
  // have not signed are nobody's yet, and two signed clients are still waiting
  // for someone. Since the round-robin was switched on (120 days ago) new
  // clients went to Marta by themselves; before that Carmen assigned them.
  // A round records who sent it: whoever had the client then.
  {
    const toCarmen = new Set(["c10", "c11", "c14", "c15", "c19", "c26", "c29", "c33"]);
    const unassigned = new Set(["c01", "c02", "c03", "c04", "c31", "c32", "c35"]);
    const autoSince = now.getTime() - 120 * DAY_MS;
    for (const client of clients) {
      if (unassigned.has(client.id)) continue;
      const at = client.agreementSignedAt ?? client.signedUpAt ?? client.createdAt;
      const first = client.id === "c11" ? "marta" : toCarmen.has(client.id) ? "carmen" : "marta";
      const auto = first === "marta" && new Date(at).getTime() >= autoSince;
      client.assignedTo = first;
      client.assignments = [{ at, to: first, by: auto ? "sistema" : "carmen", auto }];
      for (const r of client.rounds) if (r.mailedAt) r.sentBy = first;
    }
    // Graciela's returned letter: Carmen took her case over from Marta.
    graciela.assignedTo = "carmen";
    graciela.assignments = [...(graciela.assignments ?? []), { at: ago(5), to: "carmen", by: "carmen", auto: false }];
    graciela.notes = [{ id: "c11-n1", at: ago(5), author: "carmen", text: "Me quedo con su caso mientras resolvemos la carta devuelta." }];
  }

  // Three rounds above were answered by the report now on file, and the demo
  // wrote them before results were recorded: record what that report no
  // longer lists, as an import does (reports/merge.ts).
  for (const client of [paulina, samuel, leticia]) {
    const still = new Set(client.report!.items.map((item) => item.fingerprint));
    const pulled = new Date(client.report!.pulledAt).getTime();
    client.rounds = client.rounds.map((r) => {
      if (r.status !== "responded" || r.results || !r.respondedAt || Math.abs(new Date(r.respondedAt).getTime() - pulled) > DAY_MS) return r;
      const gone = [...new Set(r.letters.flatMap((l) => l.items.map((item) => item.fingerprint)))].filter((fp) => !still.has(fp));
      return gone.length > 0 ? { ...r, results: gone.map((fingerprint) => ({ fingerprint, outcome: "removed" as const, reportDate: client.report!.pulledAt })) } : r;
    });
  }

  // Gerardo's round 3: the first try was declined, the retry three days later went through.
  {
    const gerardo = clients.find((c) => c.id === "c25")!;
    gerardo.billing = {
      ...gerardo.billing,
      charges: gerardo.billing.charges.map((charge) => {
        if (charge.roundNumber !== 3) return charge;
        const paidAt = new Date(new Date(charge.createdAt).getTime() + 3 * DAY_MS).toISOString();
        return { ...charge, attempts: 2, lastAttemptAt: paidAt, chargedAt: paidAt };
      }),
    };
  }

  // What sales wrote down about some of them.
  const goals: Record<string, string> = { c01: "mortgage", c02: "auto", c03: "card", c04: "general", c31: "mortgage", c32: "card" };
  for (const client of clients) if (goals[client.id]) client.goal = goals[client.id];
  mariana.email = "mariana.robles@ejemplo.com";

  // What the AI intake recorded for a few of them (src/lib/intake/demo.ts).
  attachDemoIntake(clients, ago);

  // What fixed itself (autopilot/selfHealingDemo.ts): an address to confirm, a confirmed one, a returned
  // letter sent again, a document uploaded again, corrected addresses, a payment fixed. Before the
  // autopilot's history below, so its reminders follow from it.
  attachDemoSelfHealing(clients, ago);

  // What the autopilot did for them: messages sent, a hold, an opt-out, a
  // round mailed by itself, when each prepared round was first seen
  // (autopilot/demo.ts). Nothing in the cases above changes.
  return attachDemoAutopilot(clients, now);
}
