import { buildAttackPlan } from "../domain/attack";
import { parseReport, type RawReport } from "../domain/parser";
import type { ItemFlag, NormalizedReport, ReportItem } from "../domain/types";
import { DEMO_RAW_REPORT } from "../demo";
import type { ItemAnswer, MailStatus, RoundStatus, StaffClient, StaffLetter, StaffRound } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// DEMO DATA. Nobody in this file exists.
//
// Fifteen invented clients for the staff console, spread across every stage
// and every kind of exception. Names are made up, phone numbers use the
// reserved fictional range (555-01xx), addresses are placeholders and the
// reports are variations of the app's demo report (src/lib/demo.ts).
//
// Every date is counted back from "now", so the demo looks the same whenever
// it is opened: the client who stalled 8 days ago always stalled 8 days ago.
// ─────────────────────────────────────────────────────────────────────────

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

function ownReason(item: ReportItem): string | null {
  const data = item.data as { field?: string; accountType?: string };
  if (item.category === "personal_info") {
    if (data.field === "address") return "Nunca he vivido en esta dirección.";
    if (data.field === "name") return "Así no se escribe mi nombre.";
    return "Nunca trabajé para esta empresa.";
  }
  if (item.category === "tradeline") {
    if (data.accountType !== "collection") return null;
    return item.name === "Sample Medical Collections" ? "El saldo no coincide con lo que debo." : "No reconozco esta deuda.";
  }
  if (item.category === "inquiry") {
    return item.name === "Auto Finance Corp" ? null : "No autoricé esta consulta.";
  }
  return null;
}

/** The client's answers: the first `answered` items of the report, in report order. */
function answersFor(report: NormalizedReport, answered: number, at: string): Record<string, ItemAnswer> {
  const answers: Record<string, ItemAnswer> = {};
  report.items.slice(0, answered).forEach((item) => {
    const reason = ownReason(item);
    answers[item.fingerprint] = reason
      ? { status: "inaccurate", reason, confirmedAt: at }
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
    billing?: StaffClient["billing"];
  }

  const people = new Map<string, { first: string; last: string; city: string; zip: string }>();

  const make = (seed: Seed): StaffClient => {
    const person = { first: seed.first, last: seed.last, city: seed.city, zip: seed.zip };
    people.set(seed.id, person);
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
      );
    }
    const signedUp = seed.signedUpDaysAgo !== undefined;
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
      agreementSignedAt: seed.agreementDaysAgo !== undefined ? ago(seed.agreementDaysAgo) : null,
      documents: seed.documents ?? [],
      report,
      answers,
      rounds: [],
      billing: seed.billing ?? (seed.agreementDaysAgo !== undefined ? "active" : "none"),
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
    return { report, answers: answersFor(report, report.items.length, ago(seed.pulledDaysAgo - 1)) };
  };

  const both: StaffClient["documents"] = ["government_id", "proof_of_address"];

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

  // 3. Signed five days ago; proof of address still missing.
  const rigoberto = make({
    id: "c03", first: "Rigoberto", last: "Almanza", phone: "+12145550103", city: "Dallas", zip: "75201",
    salesperson: "ana", createdDaysAgo: 9, signedUpDaysAgo: 7, agreementDaysAgo: 5,
    documents: ["government_id"], lastActivityDaysAgo: 5,
  });

  // 4. Everything in, waiting for her report; she asked something Capi passed on.
  const itzel = make({
    id: "c04", first: "Itzel", last: "Bahena", phone: "+15125550104", city: "Austin", zip: "78701",
    salesperson: "carmen", createdDaysAgo: 4, signedUpDaysAgo: 3, agreementDaysAgo: 2,
    documents: both, lastActivityDaysAgo: 1,
  });
  itzel.questions = [
    { id: "c04-q1", askedAt: ago(1), text: "¿Puedo activar el monitoreo con mi ITIN en lugar del número de Seguro Social?", answeredAt: null },
  ];

  // 5. Reviewing, on schedule: nothing to do.
  const fidel = make({
    id: "c05", first: "Fidel", last: "Carranza", phone: "+19155550105", city: "El Paso", zip: "79901",
    salesperson: "luis", createdDaysAgo: 6, signedUpDaysAgo: 5, agreementDaysAgo: 4, documents: both,
    report: { pulledDaysAgo: 2, shape: "base" }, answered: 3, answeredDaysAgo: 0, lastActivityDaysAgo: 0,
  });

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
    report: { pulledDaysAgo: 4, shape: "base" }, answeredDaysAgo: 1, lastActivityDaysAgo: 1,
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
    report: { pulledDaysAgo: 47, shape: "extra_inquiry" }, answeredDaysAgo: 1, lastActivityDaysAgo: 1,
  });
  ramiro.rounds = [round(ramiro, 1, "ready")];
  ramiro.notes = [{ id: "c09-n1", at: ago(20), author: "ana", text: "Estuvo de viaje por trabajo. Dijo que termina su revisión cuando regrese." }];

  // 10. Mailed twelve days ago: the system is waiting on the bureaus.
  const ernesto = make({
    id: "c10", first: "Ernesto", last: "Villaseñor", phone: "+19155550110", city: "El Paso", zip: "79902",
    salesperson: "carmen", createdDaysAgo: 22, signedUpDaysAgo: 21, agreementDaysAgo: 20, documents: both,
    report: { pulledDaysAgo: 16, shape: "base" }, answeredDaysAgo: 13, lastActivityDaysAgo: 3,
  });
  ernesto.rounds = [round(ernesto, 1, "mailed", { mailedDaysAgo: 12 })];

  // 11. Mailed nine days ago; the post office returned one letter.
  const graciela = make({
    id: "c11", first: "Graciela", last: "Montoya", phone: "+17135550111", city: "Houston", zip: "77003",
    salesperson: "luis", createdDaysAgo: 19, signedUpDaysAgo: 18, agreementDaysAgo: 17, documents: both,
    report: { pulledDaysAgo: 13, shape: "medical" }, answeredDaysAgo: 10, lastActivityDaysAgo: 4,
  });
  graciela.rounds = [round(graciela, 1, "mailed", { mailedDaysAgo: 9 })];
  graciela.rounds[0]!.letters[1]!.mailStatus = "returned";

  // 12. Mailed 35 days ago and no new report has come in.
  const heriberto = make({
    id: "c12", first: "Heriberto", last: "Solís", phone: "+12105550112", city: "San Antonio", zip: "78207",
    salesperson: "ana", createdDaysAgo: 46, signedUpDaysAgo: 45, agreementDaysAgo: 44, documents: both,
    report: { pulledDaysAgo: 40, shape: "base" }, answeredDaysAgo: 37, lastActivityDaysAgo: 21,
  });
  heriberto.rounds = [round(heriberto, 1, "mailed", { mailedDaysAgo: 35 })];

  // 13. Answers arrived two days ago; the system prepares round 2 next week.
  const paulina = make({
    id: "c13", first: "Paulina", last: "Arriaga", phone: "+12145550113", city: "Dallas", zip: "75206",
    salesperson: "carmen", createdDaysAgo: 44, signedUpDaysAgo: 43, agreementDaysAgo: 42, documents: both,
    report: { pulledDaysAgo: 2, shape: "base", withoutOldAddress: true }, answeredDaysAgo: 35, lastActivityDaysAgo: 2,
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
    report: { pulledDaysAgo: 12, shape: "medical", withoutOldAddress: true }, answeredDaysAgo: 46, lastActivityDaysAgo: 5,
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

  // 15. Letters out, payment past due: on hold until it is settled.
  const noemi = make({
    id: "c15", first: "Noemí", last: "Barrientos", phone: "+19155550115", city: "El Paso", zip: "79905",
    salesperson: "carmen", createdDaysAgo: 30, signedUpDaysAgo: 29, agreementDaysAgo: 28, documents: both,
    report: { pulledDaysAgo: 24, shape: "extra_inquiry" }, answeredDaysAgo: 22, lastActivityDaysAgo: 9,
    billing: "past_due",
  });
  noemi.rounds = [round(noemi, 1, "mailed", { mailedDaysAgo: 20 })];

  return [
    mariana, yolanda, rigoberto, itzel, fidel, lourdes, anselmo, brenda,
    ramiro, ernesto, graciela, heriberto, paulina, samuel, noemi,
  ];
}
