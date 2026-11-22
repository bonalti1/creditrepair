import { z } from "zod";
import { callClaude, imageBlock, pdfBlock, type ModelCaller } from "./claude";
import { intakeConfigured, intakeModel, PROOF_OF_ADDRESS_MAX_AGE_DAYS } from "./config";
import { estimateCostUsd, NO_USAGE, type ModelUsage } from "./cost";
import { daysBetween, DAY_MS, parseLooseDate } from "./dates";
import { checkUpload } from "./files";
import { addressesMatch, namesMatch } from "./match";
import { findSensitive } from "./redact";
import { CONFIDENCE_VALUES, S } from "./schema";
import type { IntakeStatus } from "./types";

// The photo ID and proof of address a client uploads, checked before they go
// behind every dispute letter: the right kind of document, readable, not
// obviously expired, the client's name, and (for proof of address) the mailing
// address on file and a recent date.
//
// The model only describes the picture. The decision is made here, in code,
// against what is on file: `accepted` only when every check passes and the
// model was sure; anything else is `needs_person`, with plain Spanish
// reasons, and a person looks (an exception on the console).
//
// Kept: the status and the reasons. Not kept: the model's answer, the name and
// address it read, and any number on the document. The schema has no field
// for an ID number, the instructions forbid one, and an answer with a long run
// of digits where a name or address goes is not used.

export type IdentityDocumentKind = "government_id" | "proof_of_address";

const ID_TYPES = ["drivers_license", "state_id", "passport", "passport_card", "matricula_consular", "permanent_resident_card", "employment_authorization_card", "military_id", "other_photo_id"] as const;
const ADDRESS_TYPES = ["utility_bill", "phone_or_internet_bill", "bank_statement", "credit_card_statement", "lease_or_mortgage", "insurance_statement", "government_letter", "pay_stub", "other_mail"] as const;
const OTHER_TYPES = ["not_a_document", "other"] as const;
const PROBLEMS = ["blurry", "glare", "cut_off", "too_dark", "too_small", "photo_of_a_screen", "partially_covered", "looks_altered"] as const;

export const IDENTITY_SYSTEM_PROMPT = `You look at a photo or scan of a document that a consumer uploaded to a credit services company, and describe it in the schema. The company needs either a government-issued photo ID or a proof of address (a recent bill or statement mailed to the consumer). Staff will decide what to do with your description; you do not decide anything.

Describe:
- documentType: what the document is. Use an ID type only for a government-issued photo ID (driver's license, state ID, passport, passport card, Mexican matrícula consular, permanent resident card, employment authorization card, military ID, or another government photo ID). Use an address-document type for bills, statements, leases, insurance statements, letters from a government agency, pay stubs or other mail. Use "not_a_document" for a photo that is not a document, and "other" when it is a document of another kind.
- legible: true only if the name and the other text you report can be read clearly.
- problems: any of blurry, glare, cut_off (part of the document is outside the photo), too_dark, too_small, photo_of_a_screen, partially_covered, looks_altered. Empty when none.
- nameOnDocument: the person's name exactly as printed (for a bill or statement, the account holder / addressee), or null.
- addressOnDocument: the person's mailing/service address as printed, split into lines, or an empty list. For an ID, the address printed on it, if any.
- documentDate: for a bill, statement or letter, its statement/issue date (YYYY-MM-DD, or YYYY-MM if only month and year), or null.
- expirationDate: for an ID, its expiration date (YYYY-MM-DD), or null if none is printed or it cannot be read.
- confidence: "high" only if you read everything you report clearly; otherwise "medium" or "low".

Never write any ID number, license number, passport number, document number, account number, Social Security number, date of birth, barcode content or signature. Leave them out completely; they are not part of the schema and must not appear in any field.`;

export const IDENTITY_JSON_SCHEMA = S.obj({
  documentType: S.enum([...ID_TYPES, ...ADDRESS_TYPES, ...OTHER_TYPES]),
  legible: S.bool(),
  problems: S.arr(S.enum(PROBLEMS)),
  nameOnDocument: S.nullable(S.str("The person's name as printed.")),
  addressOnDocument: S.arr(S.str(), "The address as printed, one line per entry; empty if none."),
  documentDate: S.nullable(S.str("Statement or issue date, YYYY-MM-DD or YYYY-MM.")),
  expirationDate: S.nullable(S.str("ID expiration date, YYYY-MM-DD.")),
  confidence: S.enum(CONFIDENCE_VALUES),
});

const identitySchema = z
  .object({
    documentType: z.enum([...ID_TYPES, ...ADDRESS_TYPES, ...OTHER_TYPES]),
    legible: z.boolean(),
    problems: z.array(z.enum(PROBLEMS)),
    nameOnDocument: z.string().nullable(),
    addressOnDocument: z.array(z.string()),
    documentDate: z.string().nullable(),
    expirationDate: z.string().nullable(),
    confidence: z.enum(CONFIDENCE_VALUES),
  })
  .strict();

export type IdentityReading = z.infer<typeof identitySchema>;

const TYPE_ES: Record<string, string> = {
  drivers_license: "una licencia de conducir",
  state_id: "una identificación estatal",
  passport: "un pasaporte",
  passport_card: "una tarjeta de pasaporte",
  matricula_consular: "una matrícula consular",
  permanent_resident_card: "una tarjeta de residente permanente",
  employment_authorization_card: "un permiso de trabajo",
  military_id: "una identificación militar",
  other_photo_id: "una identificación oficial con foto",
  utility_bill: "un recibo de servicios",
  phone_or_internet_bill: "un recibo de teléfono o internet",
  bank_statement: "un estado de cuenta bancario",
  credit_card_statement: "un estado de cuenta de tarjeta",
  lease_or_mortgage: "un contrato de renta o hipoteca",
  insurance_statement: "un documento de seguro",
  government_letter: "una carta de una agencia de gobierno",
  pay_stub: "un talón de pago",
  other_mail: "correspondencia a tu nombre",
};

const PROBLEM_ES: Record<(typeof PROBLEMS)[number], string> = {
  blurry: "La foto está borrosa.",
  glare: "Hay un reflejo de luz sobre el documento.",
  cut_off: "Una parte del documento quedó fuera de la foto.",
  too_dark: "La foto está muy oscura.",
  too_small: "El documento se ve muy pequeño en la foto.",
  photo_of_a_screen: "Es una foto de una pantalla, no del documento.",
  partially_covered: "Algo tapa una parte del documento.",
  looks_altered: "El documento parece modificado.",
};

export interface IdentityDecision {
  status: Extract<IntakeStatus, "accepted" | "needs_person">;
  /** Plain Spanish, written to the client ("tu"). Staff read the same lines. */
  reasons: string[];
}

export interface OnFile {
  fullName: string;
  addressLines: readonly string[];
}

/** A long run of digits where a name, address or date goes: a document number leaked. */
function hasIdNumber(reading: IdentityReading): boolean {
  const texts = [reading.nameOnDocument ?? "", ...reading.addressOnDocument, reading.documentDate ?? "", reading.expirationDate ?? ""];
  // Addresses carry a ZIP (5 or 9 digits); a document number is usually 7+ digits not in ZIP+4 form.
  return texts.some((t) => /\d{7,}/.test(t.replace(/\b\d{5}-\d{4}\b/g, ""))) || findSensitive(reading).length > 0;
}

/** The decision, in code, from what the model saw and what is on file. */
export function decideIdentity(kind: IdentityDocumentKind, output: unknown, onFile: OnFile, now: Date): IdentityDecision {
  const person = (reasons: string[]): IdentityDecision => ({ status: "needs_person", reasons });
  const parsed = identitySchema.safeParse(output);
  if (!parsed.success) return person(["La revisión automática no pudo leer el documento. Una persona del equipo lo revisará."]);
  const r = parsed.data;
  if (hasIdNumber(r)) return person(["La revisión automática no se pudo completar. Una persona del equipo lo revisará."]);

  const isId = (ID_TYPES as readonly string[]).includes(r.documentType);
  const isAddress = (ADDRESS_TYPES as readonly string[]).includes(r.documentType);
  const doubts: string[] = [];
  const checks: string[] = [];

  if (kind === "government_id" && !isId) {
    doubts.push(isAddress ? `Parece ${TYPE_ES[r.documentType]}, no una identificación oficial con foto.` : "No parece una identificación oficial con foto.");
  } else if (kind === "proof_of_address" && !isAddress) {
    doubts.push(isId ? `Parece ${TYPE_ES[r.documentType]}. Como comprobante de domicilio se necesita un recibo o estado de cuenta reciente.` : "No parece un comprobante de domicilio (un recibo o estado de cuenta).");
  } else {
    checks.push(`Es ${TYPE_ES[r.documentType]}.`);
  }

  for (const problem of r.problems) doubts.push(PROBLEM_ES[problem]);
  if (!r.legible) doubts.push("No se lee con claridad.");
  else if (r.problems.length === 0) checks.push("Se lee con claridad.");
  if (r.confidence !== "high") doubts.push("La revisión automática no está segura de lo que leyó.");

  // The name.
  if (!onFile.fullName.trim()) doubts.push("Tu cuenta todavía no tiene tu nombre para comparar.");
  else if (!r.nameOnDocument) doubts.push("No se encontró un nombre en el documento.");
  else if (!namesMatch(r.nameOnDocument, onFile.fullName)) doubts.push("El nombre del documento no coincide con el de tu cuenta.");
  else checks.push("El nombre coincide con el de tu cuenta.");

  if (kind === "government_id" && isId) {
    const expires = parseLooseDate(r.expirationDate);
    if (r.expirationDate && !expires) doubts.push("No se pudo leer la fecha de vencimiento.");
    else if (expires && expires.time + DAY_MS < now.getTime()) doubts.push(`La identificación parece vencida (venció el ${expires.text}).`);
    else if (expires) checks.push("No está vencida.");
    else checks.push("No muestra fecha de vencimiento.");
  }

  if (kind === "proof_of_address" && isAddress) {
    if (onFile.addressLines.length === 0) doubts.push("Tu cuenta todavía no tiene tu dirección postal para comparar.");
    else if (r.addressOnDocument.length === 0) doubts.push("No se encontró una dirección en el documento.");
    else if (!addressesMatch(r.addressOnDocument, onFile.addressLines)) doubts.push("La dirección del documento no coincide con tu dirección postal en la cuenta.");
    else checks.push("La dirección coincide con tu dirección postal.");

    const dated = parseLooseDate(r.documentDate);
    if (!dated) doubts.push("No se ve la fecha del documento.");
    else if (dated.time - now.getTime() > DAY_MS) doubts.push("La fecha del documento está en el futuro.");
    else {
      // A month-only date counts from the end of that month.
      const age = daysBetween(dated.precision === "month" ? dated.time + 30 * DAY_MS : dated.time, now.getTime());
      if (age > PROOF_OF_ADDRESS_MAX_AGE_DAYS) doubts.push(`Tiene más de ${PROOF_OF_ADDRESS_MAX_AGE_DAYS} días (es del ${dated.text}). Se necesita uno más reciente.`);
      else checks.push(`Es reciente (del ${dated.text}).`);
    }
  }

  if (doubts.length > 0) return person(doubts);
  return { status: "accepted", reasons: checks };
}

export const IDENTITY_REQUEST_TEXT = (kind: IdentityDocumentKind) =>
  `The consumer uploaded this as their ${kind === "government_id" ? "government-issued photo ID" : "proof of address"}. Describe it. Answer with the JSON object only.`;

export interface IdentityCheckResult extends IdentityDecision {
  simulated: boolean;
  model: string;
  usage: ModelUsage;
  costUsd: number;
}

/**
 * The demo's check. With a database and no key, a simulated check never
 * passes: it goes to a person (`live: true`). In the demo the ID is accepted
 * and the proof of address needs a person, so both results can be seen.
 */
export function simulatedIdentityCheck(kind: IdentityDocumentKind, live: boolean): IdentityCheckResult {
  const base = { simulated: true, model: "simulado", usage: NO_USAGE, costUsd: 0 };
  if (live) {
    return { ...base, status: "needs_person", reasons: ["La revisión automática no está activa todavía. Una persona del equipo revisará tu documento."] };
  }
  return kind === "government_id"
    ? { ...base, status: "accepted", reasons: ["Es una licencia de conducir.", "Se lee con claridad.", "El nombre coincide con el de tu cuenta.", "No está vencida."] }
    : {
        ...base,
        status: "needs_person",
        reasons: ["La dirección del documento no coincide con tu dirección postal en la cuenta.", `Tiene más de ${PROOF_OF_ADDRESS_MAX_AGE_DAYS} días. Se necesita uno más reciente.`],
      };
}

export async function checkIdentityDocument(input: {
  kind: IdentityDocumentKind;
  bytes: Uint8Array;
  onFile: OnFile;
  now: Date;
  call?: ModelCaller;
  /** True with a database: then a simulated check sends the document to a person. */
  live: boolean;
}): Promise<IdentityCheckResult> {
  if (!input.call && !intakeConfigured()) return simulatedIdentityCheck(input.kind, input.live);
  const upload = checkUpload("identity", input.bytes);
  if (!upload.ok) return { status: "needs_person", reasons: [upload.message], simulated: false, model: intakeModel(), usage: NO_USAGE, costUsd: 0 };
  const block = upload.kind === "pdf" ? pdfBlock(input.bytes, "Uploaded document") : imageBlock(input.bytes, upload.kind === "png" ? "image/png" : "image/jpeg");
  const answer = await (input.call ?? callClaude)({
    task: "identity",
    system: IDENTITY_SYSTEM_PROMPT,
    content: [block, { type: "text", text: IDENTITY_REQUEST_TEXT(input.kind) }],
    schema: IDENTITY_JSON_SCHEMA,
  });
  const costUsd = estimateCostUsd(answer.usage);
  const meta = { simulated: false, model: answer.model, usage: answer.usage, costUsd };
  if (answer.problem) return { ...meta, status: "needs_person", reasons: ["La revisión automática no se pudo hacer. Una persona del equipo revisará tu documento."] };
  return { ...meta, ...decideIdentity(input.kind, answer.output, input.onFile, input.now) };
}
