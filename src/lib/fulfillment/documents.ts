import type { DocumentKind } from "../staff/types";

// The client's documents (migration 0041; docs/FULFILLMENT.md, "Documents").
//
//   - The two every letter carries (photo ID, proof of address) and the
//     identity theft report stay in identity_documents, as before.
//   - The others CRC keeps and Credalti now does (client_files, several of
//     each): proof for an item the client disputed, a letter from a creditor
//     or collector, court papers. They are for the team's file; nothing here
//     puts them in a letter (letters come from approved templates only).
//   - Power of attorney / authorization: a slot that stays OFF until the
//     attorney approves its text (POA_VERSION and
//     NEXT_PUBLIC_POA_APPROVED_VERSION, like the agreement). Off, the client
//     is never offered it and the route refuses it.
//   - A Social Security card is NEVER kept (the database refuses it). A note
//     that the team "saw proof of the SSN" is attorney-pending and off too:
//     nothing records it.
//
// A person reviews a document: accepted, or not accepted with a reason the
// client sees in their language and, usually, a request to upload it again.
// A required document whose newest upload was not accepted counts as missing
// (staff/stage.ts missingDocuments), so no round is offered for sending with
// it and the documents reminder starts again from the review.

export type ExtraDocumentKind = "supporting_document" | "creditor_letter" | "court_record" | "power_of_attorney";
export type ReviewableKind = Exclude<DocumentKind, "ssn_card"> | ExtraDocumentKind;

export const EXTRA_DOCUMENT_KINDS: readonly ExtraDocumentKind[] = ["supporting_document", "creditor_letter", "court_record", "power_of_attorney"];

/** The version of the power-of-attorney text. Attorney-pending: nothing is offered until it is approved. */
export const POA_VERSION = "poa-2026-11-25-draft.1";

/** True only when the attorney approved this exact version (the deployment sets NEXT_PUBLIC_POA_APPROVED_VERSION). */
export function powerOfAttorneyEnabled(env?: Record<string, string | undefined>): boolean {
  // Read by its full name so Next.js inlines it in the browser too.
  const approved = env ? env.NEXT_PUBLIC_POA_APPROVED_VERSION : process.env.NEXT_PUBLIC_POA_APPROVED_VERSION;
  return approved === POA_VERSION;
}

/** The kinds a client may upload now: the power of attorney only once the attorney approved it. */
export function uploadableExtraKinds(env?: Record<string, string | undefined>): ExtraDocumentKind[] {
  return EXTRA_DOCUMENT_KINDS.filter((k) => k !== "power_of_attorney" || powerOfAttorneyEnabled(env));
}

export interface ClientFile {
  id: string;
  kind: ExtraDocumentKind;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  bytes: number;
  description: string;
  uploadedAt: string;
  uploadedBy: "client" | "staff";
  withdrawnAt: string | null;
}

export type RejectReason = "blurry" | "cut_off" | "expired" | "name_mismatch" | "address_mismatch" | "too_old" | "wrong_document" | "unreadable" | "other";

export const REJECT_REASONS: readonly RejectReason[] = ["blurry", "cut_off", "expired", "name_mismatch", "address_mismatch", "too_old", "wrong_document", "unreadable", "other"];

export interface DocumentReview {
  id: string;
  kind: ReviewableKind;
  fileId: string | null;
  /** The upload it is about: a newer upload makes the review out of date. */
  documentUploadedAt: string;
  decision: "accepted" | "rejected";
  reasonCode: RejectReason | null;
  note: string;
  askAgain: boolean;
  by: string;
  at: string;
}

export type ReviewState = "not_reviewed" | "accepted" | "rejected";

interface ClientDocs {
  documents: readonly DocumentKind[];
  documentUploadedAt?: Partial<Record<DocumentKind, string>>;
  documentReviews?: readonly DocumentReview[];
  files?: readonly ClientFile[];
}

/** The newest person's review of this upload, or null when nobody reviewed this one (a newer upload makes an older review out of date). */
export function currentReview(client: ClientDocs, kind: ReviewableKind, fileId: string | null = null): DocumentReview | null {
  const uploadedAt = fileId
    ? (client.files ?? []).find((f) => f.id === fileId)?.uploadedAt
    : client.documentUploadedAt?.[kind as DocumentKind];
  const reviews = (client.documentReviews ?? [])
    .filter((r) => r.kind === kind && (r.fileId ?? null) === fileId)
    .filter((r) => !uploadedAt || r.documentUploadedAt >= uploadedAt)
    .sort((a, b) => a.at.localeCompare(b.at));
  return reviews.at(-1) ?? null;
}

export function reviewState(client: ClientDocs, kind: ReviewableKind, fileId: string | null = null): ReviewState {
  return currentReview(client, kind, fileId)?.decision ?? "not_reviewed";
}

/** A document on file whose current upload a person did not accept: it counts as missing. */
export function documentRejected(client: ClientDocs, kind: DocumentKind): boolean {
  return kind !== "ssn_card" && client.documents.includes(kind) && reviewState(client, kind) === "rejected";
}

/**
 * The required documents (photo ID, proof of address) whose current upload a
 * person did not accept, with the reason picked. The mailing gate
 * (rounds/send.ts documentHold) reads this from the database, so the server
 * holds the round even when a screen or a job did not.
 */
export function rejectedRequiredDocuments(
  client: ClientDocs,
  required: readonly DocumentKind[],
): Array<{ kind: Exclude<DocumentKind, "ssn_card">; reasonCode: RejectReason | null }> {
  return required.flatMap((kind) =>
    kind !== "ssn_card" && documentRejected(client, kind) ? [{ kind, reasonCode: currentReview(client, kind)?.reasonCode ?? null }] : [],
  );
}

/**
 * The sentence the team reads when the server holds a round for a document
 * that was not accepted. Written in Spanish where the rule lives, like the
 * other refusals of rounds/send.ts; the console shows it in English through
 * staffMessage (staff/i18n/messages.ts has the pattern).
 */
export function documentHoldMessageEs(kinds: readonly Exclude<DocumentKind, "ssn_card">[]): string {
  const names = kinds.map((k) => DOCUMENT_KIND_LABEL.es[k]).join(" y ");
  return `No se envía: ${kinds.length === 1 ? "un documento requerido no fue aceptado" : "dos documentos requeridos no fueron aceptados"} en la revisión (${names}). La ronda sale cuando el cliente suba uno nuevo y el equipo lo acepte.`;
}

/** When the newest "not accepted" review of a required document was made, for the reminder's start. */
export function latestRejectionAt(client: ClientDocs, kinds: readonly DocumentKind[]): string | null {
  const times = kinds.flatMap((k) => (k !== "ssn_card" && documentRejected(client, k) ? [currentReview(client, k)!.at] : []));
  return times.sort().at(-1) ?? null;
}

// ── The words ───────────────────────────────────────────────────────────

type Lang = "en" | "es";

export const DOCUMENT_KIND_LABEL: Record<Lang, Record<ReviewableKind | "ssn_card", string>> = {
  en: {
    government_id: "Photo ID",
    proof_of_address: "Proof of address",
    identity_theft_report: "Identity theft report",
    supporting_document: "Proof for a disputed item",
    creditor_letter: "Letter from a creditor or collector",
    court_record: "Court papers",
    power_of_attorney: "Power of attorney / authorization",
    ssn_card: "Social Security card",
  },
  es: {
    government_id: "Identificación con foto",
    proof_of_address: "Comprobante de domicilio",
    identity_theft_report: "Reporte de robo de identidad",
    supporting_document: "Prueba para un punto que disputas",
    creditor_letter: "Carta de un acreedor o cobrador",
    court_record: "Documentos de la corte",
    power_of_attorney: "Poder notarial / autorización",
    ssn_card: "Tarjeta de Seguro Social",
  },
};

/** For the client: what each extra kind is for. */
export const EXTRA_KIND_HINT: Record<Lang, Record<ExtraDocumentKind, string>> = {
  en: {
    supporting_document: "A statement, a receipt, a paid-in-full or settlement letter: anything that shows what you said about an item.",
    creditor_letter: "A letter a creditor or a collection agency mailed you.",
    court_record: "A judgment, a dismissal, a bankruptcy discharge.",
    power_of_attorney: "Lets Credalti act for you with the bureaus, in writing.",
  },
  es: {
    supporting_document: "Un estado de cuenta, un recibo, una carta de pago total o de acuerdo: lo que muestre lo que dijiste de un punto.",
    creditor_letter: "Una carta que te envió un acreedor o una agencia de cobranza.",
    court_record: "Una sentencia, un desistimiento, una liberación de bancarrota.",
    power_of_attorney: "Permite que Credalti actúe por ti con los burós, por escrito.",
  },
};

/** The reason the client reads, in their language. */
export const REJECT_REASON_TEXT: Record<Lang, Record<RejectReason, string>> = {
  en: {
    blurry: "The photo is blurry.",
    cut_off: "Part of the document is cut off. All four corners need to show.",
    expired: "The ID is expired.",
    name_mismatch: "The name does not match the name on your account.",
    address_mismatch: "The address does not match the mailing address on your account.",
    too_old: "It is more than 90 days old. A more recent one is needed.",
    wrong_document: "It is not the kind of document we need here.",
    unreadable: "We could not read it.",
    other: "Our team needs another one.",
  },
  es: {
    blurry: "La foto está borrosa.",
    cut_off: "Una parte del documento quedó cortada. Se necesitan las cuatro esquinas.",
    expired: "La identificación está vencida.",
    name_mismatch: "El nombre no coincide con el de tu cuenta.",
    address_mismatch: "La dirección no coincide con la dirección postal de tu cuenta.",
    too_old: "Tiene más de 90 días. Se necesita uno más reciente.",
    wrong_document: "No es el tipo de documento que necesitamos aquí.",
    unreadable: "No lo pudimos leer.",
    other: "Nuestro equipo necesita otro.",
  },
};

/** For the staff screen: the reason as the teammate picks it. */
export const REJECT_REASON_LABEL: Record<Lang, Record<RejectReason, string>> = {
  en: { blurry: "Blurry", cut_off: "Cut off", expired: "Expired", name_mismatch: "Name doesn't match", address_mismatch: "Address doesn't match", too_old: "Too old (90+ days)", wrong_document: "Wrong document", unreadable: "Can't be read", other: "Other (write why)" },
  es: { blurry: "Borrosa", cut_off: "Cortada", expired: "Vencida", name_mismatch: "El nombre no coincide", address_mismatch: "La dirección no coincide", too_old: "Muy vieja (90+ días)", wrong_document: "Documento equivocado", unreadable: "No se puede leer", other: "Otro (escribe por qué)" },
};

/** The line the client sees for a review: the reason, the team's words, and what to do. */
export function clientReviewLine(review: DocumentReview, locale: Lang): string {
  if (review.decision === "accepted") return locale === "es" ? "Nuestro equipo lo revisó y lo aceptó." : "Our team reviewed it and accepted it.";
  const reason = REJECT_REASON_TEXT[locale][review.reasonCode ?? "other"];
  const note = review.note.trim() ? ` ${review.note.trim()}` : "";
  const ask = review.askAgain ? (locale === "es" ? " Por favor, sube uno nuevo." : " Please upload a new one.") : "";
  return `${reason}${note}${ask}`;
}

/** What is never collected, said on the staff page and the client's screen. */
export const NOT_COLLECTED = {
  en: {
    ssn: "Social Security card: not collected. Credalti never keeps a copy.",
    ssnProof: "A note that the team saw proof of the SSN: waiting on the attorney, off.",
    poaOff: "Power of attorney / authorization: off until the attorney approves its text.",
  },
  es: {
    ssn: "Tarjeta de Seguro Social: no se pide. Credalti nunca guarda una copia.",
    ssnProof: "Una nota de que el equipo vio el comprobante del SSN: pendiente del abogado, apagada.",
    poaOff: "Poder notarial / autorización: apagado hasta que el abogado apruebe su texto.",
  },
};
