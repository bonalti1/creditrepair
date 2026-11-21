import type { ItemCategory } from "../domain/types";

// The letter library: one catalogue entry for every template in TEMPLATES.
//
// The templates say what a letter says; this file says when staff may use it.
// `requiresFacts` is the rule that matters most: a letter asserts a fact (for
// example "this account is not mine") only because the client has stated that
// fact. If the client has not, the letter is the wrong letter.
//
// Every entry is `attorney_pending`: these are drafts until the attorney has
// reviewed them (see docs/LETTER-LIBRARY.md, written by `npm run letters:packet`).

export { TEMPLATES, ORIGINAL_TEMPLATE_KEYS, renderLetter, type LetterContext } from "./templates";

export type LetterCategory =
  | "bureau_dispute"
  | "bureau_follow_up"
  | "inquiries"
  | "personal_information"
  | "creditor"
  | "collector"
  | "identity_theft"
  | "file_access";

export type LetterRecipient = "bureau" | "secondary_bureau" | "furnisher" | "collector";

export type LetterStageHint = "dispute" | "mov" | "furnisher_direct" | "follow_up";

export interface Bilingual {
  es: string;
  en: string;
}

export interface LetterMeta {
  key: string;
  title: Bilingual;
  category: LetterCategory;
  recipient: LetterRecipient;
  /** The statutes and rules the letter cites or relies on. */
  statutes: string[];
  /** One plain sentence for staff: when this letter is the right one. */
  useWhen: Bilingual;
  /** What the client must have stated or provided before this letter may be used. */
  requiresFacts: string[];
  /** Suggested enclosures. A letter only lists what is physically attached. */
  enclosures: string[];
  stageHint?: LetterStageHint;
  /** Why this letter needs the attorney's particular attention. */
  attorneyAttention?: string;
  /** A caution for staff that does not fit in `useWhen`. */
  staffNote?: string;
  /** The kinds of report item the letter lists. Empty when it lists none. */
  appliesTo: ItemCategory[];
  reviewStatus: "attorney_pending";
}

export const CATEGORY_LABELS: Record<LetterCategory, Bilingual> = {
  bureau_dispute: { es: "Disputas ante el buró, por motivo", en: "Bureau disputes, by reason" },
  bureau_follow_up: { es: "Seguimiento ante el buró", en: "Bureau follow-ups" },
  inquiries: { es: "Consultas de crédito", en: "Inquiries" },
  personal_information: { es: "Información personal", en: "Personal information" },
  creditor: { es: "Acreedor o proveedor de datos", en: "Creditor or furnisher" },
  collector: { es: "Agencia de cobranza", en: "Debt collector" },
  identity_theft: { es: "Robo de identidad", en: "Identity theft" },
  file_access: { es: "Expediente y acceso", en: "File and access" },
};

// ---- Citations ---------------------------------------------------------------
// Each FCRA / FDCPA section is paired with its U.S. Code section in one place,
// so a citation cannot be written with a mismatched cross-reference.

const FCRA_USC: Record<string, string> = {
  "604": "1681b",
  "605": "1681c",
  "605A": "1681c-1",
  "605B": "1681c-2",
  "609": "1681g",
  "611": "1681i",
  "612": "1681j",
  "623": "1681s-2",
};
const FDCPA_USC: Record<string, string> = { "805": "1692c", "809": "1692g" };

const fcra = (section: keyof typeof FCRA_USC, sub = "") => `FCRA § ${section}${sub} (15 U.S.C. § ${FCRA_USC[section]}${sub})`;
const fdcpa = (section: keyof typeof FDCPA_USC, sub = "") =>
  `FDCPA § ${section}${sub} (15 U.S.C. § ${FDCPA_USC[section]}${sub})`;
const REG_V_DIRECT_DISPUTES = "12 C.F.R. § 1022.43";

// ---- Enclosures --------------------------------------------------------------

const ID = "Copy of government-issued photo ID";
const ADDRESS = "Proof of address (utility bill / bank statement)";
const IDENTITY = [ID, ADDRESS];
const FTC_REPORT = "Identity theft report (FTC)";
const PRIOR_DISPUTE = "Copy of the earlier dispute letter and proof of mailing or delivery";
const BUREAU_RESULTS = "Copy of the bureau's results or notice";

// ---- Notes used on more than one entry ---------------------------------------

const DIRECT_DISPUTE_CRO =
  "12 C.F.R. § 1022.43(b)(2), and the parallel exclusion in FCRA § 623(a)(8), say a furnisher need not investigate a direct dispute it reasonably believes was prepared by, or submitted on a form supplied by, a credit repair organization. Please advise how that affects direct-dispute letters prepared with our software and sent by the client.";

const VALIDATION_TIMING =
  "FDCPA § 809(b) applies only to a written dispute sent within 30 days after the client received the collector's first (validation) notice. Outside that window the collector has no duty under § 809(b) to verify or to pause collection; confirm the date with the client before using this letter.";

const meta = (entry: Omit<LetterMeta, "reviewStatus">): LetterMeta => ({ ...entry, reviewStatus: "attorney_pending" });

export const LETTER_CATALOGUE: LetterMeta[] = [
  // ---- Bureau disputes, by reason ---------------------------------------------
  meta({
    key: "dispute_611_accounts",
    title: { es: "Disputa general de cuentas", en: "General dispute of accounts" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El cliente disputa una o más cuentas y ninguna carta por motivo específico encaja mejor.",
      en: "The client disputes one or more accounts and no reason-specific letter fits better.",
    },
    requiresFacts: [
      "Client has attested, for each listed account, that the information is inaccurate, incomplete, unverifiable or outdated.",
    ],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote:
      "Original round-engine letter; wording unchanged. It gives no item-specific reason, and a dispute without specifics is easier for a bureau to treat as frivolous under § 611(a)(3). Prefer a reason-specific letter when the client has given a reason.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_not_my_account",
    title: { es: "Disputa: la cuenta no es mía", en: "Dispute: account is not mine" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El cliente afirma que no abrió la cuenta ni autorizó a nadie a abrirla, y no declara ser víctima de robo de identidad.",
      en: "The client states they did not open the account or authorize anyone to open it, and is not claiming identity theft.",
    },
    requiresFacts: [
      "Client states each listed account is not theirs: they did not open it and did not authorize anyone to open it in their name.",
      "Client confirms they are not a joint holder, co-signer or authorized user on the account.",
    ],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote:
      "If the client says the account was opened by someone using their identity, use the identity-theft letters instead; this letter does not claim identity theft.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_never_late",
    title: { es: "Disputa: pagos atrasados reportados por error", en: "Dispute: late payments reported in error" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El reporte muestra pagos atrasados en una cuenta y el cliente afirma que pagó a tiempo.",
      en: "The report shows late payments on an account and the client states they paid on time.",
    },
    requiresFacts: [
      "Client states the payments reported as late were made on time.",
      "Client identifies which months are wrong, ideally with statements or bank records.",
    ],
    enclosures: [...IDENTITY, "Account statements or bank records showing the payments were made on time"],
    stageHint: "dispute",
    staffNote: "If the late payments are accurate and the client wants a courtesy removal, use goodwill_adjustment instead.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_wrong_balance",
    title: { es: "Disputa: saldo o límite de crédito incorrecto", en: "Dispute: incorrect balance or credit limit" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El saldo, el límite de crédito o el monto vencido que aparece en el reporte no coincide con los registros del cliente.",
      en: "The balance, credit limit or past-due amount on the report does not match the client's records.",
    },
    requiresFacts: [
      "Client states which amount is wrong (balance, credit limit or past-due amount) and what their records show.",
    ],
    enclosures: [...IDENTITY, "Most recent account statement showing the correct balance or credit limit"],
    stageHint: "dispute",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_wrong_dates",
    title: { es: "Disputa: fechas incorrectas", en: "Dispute: incorrect dates" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "Una fecha de la cuenta (apertura, último pago, primera morosidad o cierre) está mal en el reporte.",
      en: "A date on the account (opened, last payment, first delinquency or closed) is wrong on the report.",
    },
    requiresFacts: ["Client states which date is wrong and what the correct date is according to their records."],
    enclosures: [...IDENTITY, "Statement, payment record or letter showing the correct date"],
    stageHint: "dispute",
    staffNote: "To ask the furnisher itself to correct a date of first delinquency, use furnisher_date_of_first_delinquency.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_duplicate_account",
    title: { es: "Disputa: cuenta duplicada", en: "Dispute: duplicate account" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "La misma cuenta aparece más de una vez en el reporte del mismo buró como si fueran cuentas distintas.",
      en: "The same account appears more than once on the same bureau's report as if it were separate accounts.",
    },
    requiresFacts: ["Client states the listed entries are one and the same account reported more than once."],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote:
      "An original creditor's account and a collection agency's account for the same debt are normally two legitimate entries, not a duplicate. Use this letter only when the same creditor or the same collector reports the same account twice.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_paid_or_settled",
    title: { es: "Disputa: cuenta pagada o liquidada que aparece con saldo", en: "Dispute: paid or settled account reported as owing" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El cliente pagó o liquidó la cuenta y el reporte todavía muestra un saldo o un monto vencido.",
      en: "The client paid or settled the account and the report still shows a balance or a past-due amount.",
    },
    requiresFacts: [
      "Client states the account was paid in full or settled by agreement with the creditor.",
      "Client can give the date and, ideally, a receipt, zero-balance letter or settlement letter.",
    ],
    enclosures: [...IDENTITY, "Receipt, zero-balance letter or settlement letter"],
    stageHint: "dispute",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_closed_by_consumer",
    title: { es: "Disputa: cuenta cerrada por el consumidor", en: "Dispute: account closed by the consumer" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El cliente cerró la cuenta por decisión propia y el reporte la muestra abierta o cerrada por el acreedor.",
      en: "The client closed the account themselves and the report shows it as open or as closed by the creditor.",
    },
    requiresFacts: ["Client states they closed the account at their own request."],
    enclosures: [...IDENTITY, "Closing confirmation from the creditor, if the client has one"],
    stageHint: "dispute",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_included_in_bankruptcy",
    title: { es: "Disputa: cuenta incluida en bancarrota que aún muestra saldo", en: "Dispute: account discharged in bankruptcy still showing a balance" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "La deuda fue incluida y descargada en la bancarrota del cliente y el reporte todavía muestra saldo o monto vencido.",
      en: "The debt was included and discharged in the client's bankruptcy and the report still shows a balance or past-due amount.",
    },
    requiresFacts: [
      "Client states they filed a bankruptcy case and received a discharge.",
      "Client states each listed debt was included in that bankruptcy case and discharged.",
      "Client provides the discharge order and, ideally, the schedule listing the creditor.",
    ],
    enclosures: [...IDENTITY, "Bankruptcy discharge order", "Bankruptcy schedule listing the creditor"],
    stageHint: "dispute",
    attorneyAttention:
      "The letter states that the listed debts were discharged. Not every debt listed in a bankruptcy is discharged (for example reaffirmed debts and debts excepted from discharge), and a case that is still open has no discharge yet. Please confirm what staff must check before using it.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "bureau_obsolete_item",
    title: { es: "Disputa: información fuera del período de reporte", en: "Dispute: information past its reporting period" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("605"), fcra("605", "(c)"), fcra("611")],
    useWhen: {
      es: "Según los registros del cliente, la partida negativa ya superó el período durante el cual puede reportarse.",
      en: "By the client's records, the negative item is older than the period for which it may be reported.",
    },
    requiresFacts: [
      "Client states, with dates, when the delinquency began (or when the public record was entered), and that date puts the item past its reporting period.",
    ],
    enclosures: [...IDENTITY, "Statement or letter showing when the delinquency began"],
    stageHint: "dispute",
    attorneyAttention:
      "The letter says § 605 limits most adverse information 'in most cases to seven years' and describes the § 605(c) starting point. It is not for bankruptcy cases, which have a longer period under § 605(a)(1), or for reports within the § 605(b) exceptions. Please confirm the wording and the periods staff should apply; we could not open the full text of § 605(a) to confirm every period.",
    staffNote: "Do not use for bankruptcy entries. Work out the date with the client; never estimate it.",
    appliesTo: ["tradeline", "public_record"],
  }),
  meta({
    key: "bureau_mixed_file",
    title: { es: "Disputa: información de otra persona en mi expediente", en: "Dispute: another person's information in my file" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El expediente del cliente contiene cuentas o datos de otra persona, por ejemplo un familiar con nombre parecido.",
      en: "The client's file contains accounts or details of another person, for example a relative with a similar name.",
    },
    requiresFacts: [
      "Client states each listed item is not theirs and does not belong to them.",
      "Client believes the items belong to another person with a similar name, address or identifying number.",
    ],
    enclosures: [...IDENTITY, "Copy of Social Security card"],
    stageHint: "dispute",
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
  }),
  meta({
    key: "dispute_611_public_records",
    title: { es: "Disputa general de registros públicos", en: "General dispute of public records" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El cliente disputa un registro público y no puede precisar qué dato del registro está mal.",
      en: "The client disputes a public record and cannot say precisely which detail of the record is wrong.",
    },
    requiresFacts: [
      "Client has attested, for each listed public record, that the information is inaccurate, unverifiable or outdated.",
    ],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote: "Original round-engine letter; wording unchanged. Prefer bureau_incorrect_public_record when the client can say what is wrong.",
    appliesTo: ["public_record"],
  }),
  meta({
    key: "bureau_incorrect_public_record",
    title: { es: "Disputa: registro público incorrecto", en: "Dispute: incorrect public record" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "Lo que el buró reporta sobre un registro público no coincide con el expediente del tribunal o de la agencia.",
      en: "What the bureau reports about a public record does not match the court's or agency's own record.",
    },
    requiresFacts: [
      "Client states what is wrong in the entry (status, filing or disposition date, or amount) and what the court or agency record shows.",
    ],
    enclosures: [...IDENTITY, "Copy of the court or agency record showing the correct information"],
    stageHint: "dispute",
    appliesTo: ["public_record"],
  }),
  meta({
    key: "bureau_medical_collection",
    title: { es: "Disputa: cobranza médica con monto incorrecto", en: "Dispute: medical collection with an incorrect amount" },
    category: "bureau_dispute",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "Una cobranza por factura médica aparece con un monto que no refleja lo que pagó el seguro o el cliente.",
      en: "A collection for a medical bill is reported with an amount that does not reflect what insurance or the client paid.",
    },
    requiresFacts: [
      "Client states the collection is for a medical bill.",
      "Client states that health insurance or the client paid all or part of the bill and the reported balance does not reflect it.",
      "Client provides an explanation of benefits, receipt or provider statement if they have one.",
    ],
    enclosures: [...IDENTITY, "Insurance explanation of benefits, receipt or provider statement"],
    stageHint: "dispute",
    attorneyAttention:
      "Medical debt. The letter is an ordinary § 611 accuracy dispute and deliberately says nothing about credit bureau medical-debt policies, the CFPB medical-debt rule (reported vacated by a federal court in July 2025), state medical-debt reporting laws, or HIPAA. Please advise whether any of those should be reflected, and whether the client's disclosure that the debt is medical raises a privacy concern.",
    appliesTo: ["tradeline"],
  }),

  // ---- Inquiries ---------------------------------------------------------------
  meta({
    key: "dispute_611_inquiries",
    title: { es: "Disputa general de consultas", en: "General dispute of inquiries" },
    category: "inquiries",
    recipient: "bureau",
    statutes: [fcra("604"), fcra("611")],
    useWhen: {
      es: "El cliente no reconoce una o más consultas de crédito, pero no puede afirmar con certeza que no las autorizó.",
      en: "The client does not recognize one or more inquiries but cannot say for certain that they did not authorize them.",
    },
    requiresFacts: ["Client states they do not recognize each listed inquiry or believes it is reported inaccurately."],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote: "Original round-engine letter; wording unchanged.",
    appliesTo: ["inquiry"],
  }),
  meta({
    key: "bureau_unauthorized_inquiry",
    title: { es: "Disputa: consulta que no autoricé", en: "Dispute: inquiry I did not authorize" },
    category: "inquiries",
    recipient: "bureau",
    statutes: [fcra("604"), fcra("611")],
    useWhen: {
      es: "El cliente afirma que no solicitó nada a esa empresa ni le dio permiso para consultar su reporte.",
      en: "The client states they did not apply for anything with that company or give it permission to pull their report.",
    },
    requiresFacts: [
      "Client states they did not apply for credit or any other product with each listed company.",
      "Client states they did not give each listed company permission to obtain their credit report.",
    ],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote:
      "An inquiry can have a permissible purpose without a new application (for example a review by an existing creditor, or a collector). Ask the client about existing accounts with the company before using this letter.",
    appliesTo: ["inquiry"],
  }),

  // ---- Personal information ----------------------------------------------------
  meta({
    key: "personal_info_cleanup",
    title: { es: "Corrección de información personal", en: "Correction of personal information" },
    category: "personal_information",
    recipient: "bureau",
    statutes: [fcra("611")],
    useWhen: {
      es: "El reporte muestra nombres, direcciones, empleadores u otros datos personales incorrectos o que ya no corresponden al cliente.",
      en: "The report shows names, addresses, employers or other personal details that are wrong or no longer apply to the client.",
    },
    requiresFacts: ["Client states each listed name, address, employer or other detail is inaccurate or no longer applies to them."],
    enclosures: IDENTITY,
    stageHint: "dispute",
    staffNote: "Original round-engine letter; wording unchanged. The letter itself cites no statute; § 611 is the basis for the request.",
    appliesTo: ["personal_info"],
  }),

  // ---- Bureau follow-ups -------------------------------------------------------
  meta({
    key: "mov_request",
    title: { es: "Solicitud del procedimiento de reinvestigación (método de verificación)", en: "Request for description of the reinvestigation procedure (method of verification)" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(a)(6)(B)(iii)"), fcra("611", "(a)(7)")],
    useWhen: {
      es: "El buró respondió que la partida disputada fue «verificada» y el cliente quiere saber cómo se verificó.",
      en: "The bureau answered that the disputed item was 'verified' and the client wants to know how it was verified.",
    },
    requiresFacts: ["Client previously disputed each listed item with this bureau and the bureau reported it as verified."],
    enclosures: [...IDENTITY, BUREAU_RESULTS],
    stageHint: "mov",
    attorneyAttention:
      "Original round-engine letter; wording unchanged. Two points: (1) it cites only § 611(a)(6)(B)(iii), which is the notice that a description is available; the duty to provide the description within 15 days of a request is § 611(a)(7). (2) Its last sentence asks for deletion 'if you cannot provide the method of verification'. The statute does not make deletion the consequence of not providing the description; please consider whether that sentence should be reworded.",
    appliesTo: ["tradeline", "inquiry", "public_record"],
  }),
  meta({
    key: "bureau_reinvestigation_procedure",
    title: { es: "Solicitud de la descripción del procedimiento de reinvestigación", en: "Request for description of the reinvestigation procedure" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(a)(7)")],
    useWhen: {
      es: "El buró respondió que la partida disputada fue «verificada» y el cliente quiere saber qué procedimiento se siguió y a qué empresa se consultó.",
      en: "The bureau answered that the disputed item was 'verified' and the client wants to know what procedure was followed and which company was contacted.",
    },
    requiresFacts: ["Client previously disputed each listed item with this bureau and the bureau reported it as verified."],
    enclosures: [...IDENTITY, BUREAU_RESULTS],
    stageHint: "mov",
    staffNote:
      "New draft of the same request as mov_request, citing § 611(a)(7) and not making deletion depend on whether the description is provided. Offered so the attorney can choose between the two wordings.",
    appliesTo: ["tradeline", "inquiry", "public_record"],
  }),
  meta({
    key: "bureau_no_response",
    title: { es: "Seguimiento: sin respuesta después del plazo de reinvestigación", en: "Follow-up: no response after the reinvestigation period" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(a)(1)"), fcra("611", "(a)(6)")],
    useWhen: {
      es: "Pasaron más de 30 días desde que el buró recibió la disputa y el cliente no ha recibido los resultados.",
      en: "More than 30 days have passed since the bureau received the dispute and the client has not received the results.",
    },
    requiresFacts: [
      "Client mailed a written dispute of the listed items to this bureau.",
      "Proof of delivery shows the bureau received it more than 30 days ago.",
      "Client has not received results by mail or in the bureau's online account.",
    ],
    enclosures: [...IDENTITY, PRIOR_DISPUTE],
    stageHint: "follow_up",
    staffNote:
      "Count from the date the bureau received the dispute, and allow for mailing time of the results. The period can be 45 days when the client sent additional information during the 30 days (§ 611(a)(1)(B)) or disputed after a free annual report (§ 612(a)(3)); wait until that longer period has passed in those cases.",
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
  }),
  meta({
    key: "bureau_frivolous_response",
    title: { es: "Respuesta a una determinación de disputa «frívola», con datos adicionales", en: "Response to a 'frivolous' determination, with added specifics" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(a)(3)"), fcra("611")],
    useWhen: {
      es: "El buró notificó que no investigará la disputa por considerarla frívola o irrelevante y el cliente puede dar más detalles.",
      en: "The bureau gave notice that it will not investigate the dispute because it considers it frivolous or irrelevant, and the client can give more detail.",
    },
    requiresFacts: [
      "Client received a notice from this bureau that the dispute was determined to be frivolous or irrelevant.",
      "Client states the dispute is their own and made in good faith.",
      "Client provides, in their own words, what is wrong with each item and any supporting documents (this is the letter's `details`).",
    ],
    enclosures: [...IDENTITY, BUREAU_RESULTS, "Documents supporting the dispute"],
    stageHint: "follow_up",
    attorneyAttention:
      "The letter says 'This dispute is mine, I am making it in good faith'. Bureaus often send frivolous notices when they suspect a credit repair company prepared the letter. Please confirm this sentence is accurate and appropriate given that the client reviews, approves and sends a letter drafted with our software.",
    staffNote: "Do not send without the client's own specifics. Repeating the same dispute with no new information invites the same answer.",
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
  }),
  meta({
    key: "bureau_consumer_statement",
    title: { es: "Solicitud para agregar una declaración del consumidor", en: "Request to add a consumer statement" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(b)"), fcra("611", "(c)")],
    useWhen: {
      es: "La reinvestigación no resolvió la disputa y el cliente quiere que su versión conste en el expediente.",
      en: "The reinvestigation did not resolve the dispute and the client wants their side recorded in the file.",
    },
    requiresFacts: [
      "Client disputed each listed item with this bureau and the reinvestigation is finished without resolving the dispute.",
      "Client has written the statement in their own words (this is the letter's `details`); 100 words or fewer is safest.",
    ],
    enclosures: IDENTITY,
    stageHint: "follow_up",
    staffNote:
      "A consumer statement is shown to whoever reads the report; it does not change the item or a credit score. Use it only when the client asks for it, and never write the statement for the client.",
    appliesTo: ["tradeline", "inquiry", "public_record"],
  }),
  meta({
    key: "bureau_reinsertion_notice",
    title: { es: "Partida eliminada que reapareció sin aviso", en: "Deleted item reinserted without notice" },
    category: "bureau_follow_up",
    recipient: "bureau",
    statutes: [fcra("611", "(a)(5)(B)"), fcra("611")],
    useWhen: {
      es: "Una partida que el buró eliminó tras una disputa volvió a aparecer y el cliente no recibió aviso por escrito.",
      en: "An item the bureau deleted after a dispute is back on the report and the client received no written notice.",
    },
    requiresFacts: [
      "Client disputed each listed item and the bureau's results show it was deleted.",
      "The same item appears again on a later report from the same bureau.",
      "Client did not receive a written notice of reinsertion from the bureau.",
    ],
    enclosures: [...IDENTITY, "Copy of the bureau's results showing the deletion", "Page of the later report showing the item"],
    stageHint: "follow_up",
    staffNote: "Check that it is the same account from the same furnisher, not the same debt reported by a new collector, which is a new item.",
    appliesTo: ["tradeline", "inquiry", "public_record"],
  }),

  // ---- Creditor or furnisher ---------------------------------------------------
  meta({
    key: "furnisher_direct",
    title: { es: "Disputa directa con el proveedor de datos", en: "Direct dispute with the furnisher" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [fcra("623", "(a)(8)"), REG_V_DIRECT_DISPUTES],
    useWhen: {
      es: "El cliente disputa la información directamente con la empresa que la reporta.",
      en: "The client disputes the information directly with the company that reports it.",
    },
    requiresFacts: ["Client has attested, for each listed item, that the information the furnisher reports is inaccurate."],
    enclosures: IDENTITY,
    stageHint: "furnisher_direct",
    attorneyAttention: `Original round-engine letter; wording unchanged. It says 'you are required to' and 'you must correct it or cease reporting it', which is firmer than the new letters. The round engine also uses it for inquiries and public records; as we understand 12 C.F.R. § 1022.43(b)(1), the direct-dispute rule does not cover disputes about inquiries or public record information, so please confirm whether it should. ${DIRECT_DISPUTE_CRO}`,
    staffNote:
      "Send to the address the furnisher gives for disputes (on the credit report or on its statements). A direct dispute should identify the account, say what is wrong and why, and include supporting documents.",
    appliesTo: ["tradeline", "inquiry", "public_record"],
  }),
  meta({
    key: "furnisher_after_bureau_verified",
    title: { es: "Disputa directa después de que el buró «verificó»", en: "Direct dispute after the bureau 'verified'" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [fcra("623", "(a)(8)"), fcra("623", "(a)(3)"), REG_V_DIRECT_DISPUTES],
    useWhen: {
      es: "El buró respondió que la partida fue verificada y el cliente sigue sosteniendo que es inexacta.",
      en: "The bureau answered that the item was verified and the client still maintains it is inaccurate.",
    },
    requiresFacts: [
      "Client disputed each listed item with a credit bureau and the bureau reported it as verified.",
      "Client states the information is inaccurate and says, in their own words, what is wrong (this is the letter's `details`).",
    ],
    enclosures: [...IDENTITY, BUREAU_RESULTS, "Documents supporting the dispute"],
    stageHint: "furnisher_direct",
    attorneyAttention: DIRECT_DISPUTE_CRO,
    staffNote: "Send to the address the furnisher gives for disputes. Include the client's specifics and documents; a furnisher may treat a direct dispute without them as frivolous.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "furnisher_date_of_first_delinquency",
    title: { es: "Solicitud de corrección de la fecha de primera morosidad", en: "Request to correct the date of first delinquency" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [fcra("623", "(a)(5)"), fcra("623", "(a)(8)"), fcra("605", "(c)"), REG_V_DIRECT_DISPUTES],
    useWhen: {
      es: "La fecha de primera morosidad que reporta el acreedor o la agencia de cobranza no coincide con los registros del cliente.",
      en: "The date of first delinquency reported by the creditor or collector does not match the client's records.",
    },
    requiresFacts: [
      "Client states the date of first delinquency being reported is wrong.",
      "Client gives the date their records show and how they know it (this is the letter's `details`).",
    ],
    enclosures: [...IDENTITY, "Statement or letter showing when the delinquency began"],
    stageHint: "furnisher_direct",
    attorneyAttention: DIRECT_DISPUTE_CRO,
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "goodwill_adjustment",
    title: { es: "Solicitud de buena voluntad", en: "Goodwill request" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [],
    useWhen: {
      es: "El pago atrasado es correcto y el cliente quiere pedirle al acreedor, como cortesía, que lo retire.",
      en: "The late payment is accurate and the client wants to ask the creditor, as a courtesy, to remove it.",
    },
    requiresFacts: [
      "Client confirms the late payment is accurately reported.",
      "Client has an otherwise good payment history with this creditor and can describe the circumstances at the time.",
    ],
    enclosures: [],
    attorneyAttention:
      "Original round-engine letter; wording unchanged. It asks a furnisher to remove information the client agrees is accurate. It claims no error and no legal right, but furnishers have accuracy duties and many decline. Please confirm you are comfortable with the company offering this letter and with how staff describe it to clients (a request, with no expected result).",
    staffNote: "This is a request for a favor, not a dispute. Never describe it to the client as likely to work.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "creditor_authorized_user_removal",
    title: { es: "Solicitud para dejar de ser usuario autorizado", en: "Authorized-user removal request" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [],
    useWhen: {
      es: "El cliente figura solo como usuario autorizado en la cuenta de otra persona y quiere que deje de reportarse a su nombre.",
      en: "The client is only an authorized user on someone else's account and wants it to stop being reported under their name.",
    },
    requiresFacts: [
      "Client states they are an authorized user on the account, not the account holder or a joint holder.",
      "Client states they did not agree to be responsible for the debt.",
      "Client wants to be removed and understands they will lose use of the card.",
    ],
    enclosures: [ID],
    staffNote: "Removing a long-standing, well-paid account can lower a score. Make sure the client wants this.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "creditor_settlement_offer",
    title: { es: "Oferta de acuerdo de pago", en: "Settlement offer" },
    category: "creditor",
    recipient: "furnisher",
    statutes: [],
    useWhen: {
      es: "El cliente quiere ofrecer un pago para resolver la cuenta y preguntar si el acreedor actualizaría o eliminaría lo que reporta.",
      en: "The client wants to offer a payment to resolve the account and ask whether the creditor would update or delete its reporting.",
    },
    requiresFacts: [
      "Client has decided to offer a settlement and has stated the amount and timing they can actually pay (this is the letter's `details`).",
      "Client understands the creditor does not have to accept the offer or change what it reports.",
    ],
    enclosures: [],
    attorneyAttention:
      "Settlement offer of the 'pay for delete' kind. It is written as an offer that asks, without demanding, that the furnisher update or delete its reporting, and says the decision is the furnisher's. Concerns to check: furnishers' accuracy duties and bureau policies against deleting accurate information for payment; whether an offer or a partial payment can restart a statute of limitations or count as an acknowledgment under state law (the letter says it is not an acknowledgment); whether negotiating debts brings the company under debt-settlement or similar state rules; and tax treatment of forgiven debt. Please say whether the company should offer this letter at all.",
    staffNote: "Use only at the client's explicit request. Staff do not suggest an amount and do not negotiate for the client.",
    appliesTo: ["tradeline"],
  }),

  // ---- Debt collector ----------------------------------------------------------
  meta({
    key: "debt_validation",
    title: { es: "Solicitud de validación de deuda (original)", en: "Debt validation request (original)" },
    category: "collector",
    recipient: "collector",
    statutes: [fdcpa("809", "(b)"), fcra("623", "(a)(3)")],
    useWhen: {
      es: "Una agencia de cobranza reporta una deuda y el cliente pide que la valide; úsela solo dentro de los 30 días del primer aviso.",
      en: "A collection agency reports a debt and the client asks it to validate the debt; use it only within 30 days of the first notice.",
    },
    requiresFacts: [
      "Client disputes the debt or wants it verified.",
      "Client received the collector's first notice less than 30 days ago.",
    ],
    enclosures: [],
    stageHint: "dispute",
    attorneyAttention: `Original round-engine letter; wording unchanged. Three points: (1) the letter does not say it is sent within 30 days of the collector's first notice, which is when § 809(b) applies; collector_validation_30_day is the replacement that does. (2) It asks for 'a copy of the original signed agreement', which § 809(b) does not expressly require as verification. (3) It asks the collector to delete its reporting if it cannot validate; § 809(b) pauses collection until verification and does not itself require deletion. Please say whether the round engine should switch to the new letter.`,
    staffNote: VALIDATION_TIMING,
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "collector_validation_30_day",
    title: { es: "Disputa y solicitud de verificación de deuda (dentro de 30 días)", en: "Dispute and request for verification of debt (within 30 days)" },
    category: "collector",
    recipient: "collector",
    statutes: [fdcpa("809", "(b)")],
    useWhen: {
      es: "El cliente recibió el primer aviso de una agencia de cobranza hace menos de 30 días y quiere disputar la deuda y pedir su verificación.",
      en: "The client received a collection agency's first notice less than 30 days ago and wants to dispute the debt and ask for verification.",
    },
    requiresFacts: [
      "Client received the collector's first written notice about this debt, and knows the date.",
      "The letter will be mailed within 30 days after the client received that notice.",
      "Client disputes the debt or wants it verified.",
    ],
    enclosures: [],
    stageHint: "dispute",
    staffNote: `${VALIDATION_TIMING} The letter states that it is sent within thirty days; do not use it if that is not true.`,
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "collector_validation_follow_up",
    title: { es: "Seguimiento: verificación de deuda no recibida", en: "Follow-up: verification of debt not received" },
    category: "collector",
    recipient: "collector",
    statutes: [fdcpa("809", "(b)")],
    useWhen: {
      es: "El cliente envió a tiempo la solicitud de verificación y la agencia de cobranza no ha respondido.",
      en: "The client sent the verification request in time and the collection agency has not answered.",
    },
    requiresFacts: [
      "Client sent a written dispute or verification request to this collector within 30 days of receiving its first notice, and has proof of mailing.",
      "Client has not received verification of the debt.",
    ],
    enclosures: ["Copy of the earlier verification request and proof of mailing or delivery"],
    stageHint: "follow_up",
    attorneyAttention:
      "The letter asks, as a request, that a collector that cannot verify the debt close its file and ask the bureaus to delete its reporting. § 809(b) itself only pauses collection until verification is mailed; it sets no deadline and does not require deletion. Please confirm the request is worded modestly enough, and that the sentence about a CFPB complaint is acceptable here.",
    staffNote: `${VALIDATION_TIMING} The statute sets no deadline for the collector to send verification; it may also simply stop collecting.`,
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "collector_cease_communication",
    title: { es: "Solicitud para que cese la comunicación", en: "Request to cease communication" },
    category: "collector",
    recipient: "collector",
    statutes: [fdcpa("805", "(c)")],
    useWhen: {
      es: "El cliente pide expresamente que la agencia de cobranza deje de contactarlo y entiende las consecuencias.",
      en: "The client expressly asks that the collection agency stop contacting them and understands the consequences.",
    },
    requiresFacts: [
      "Client states this collector has been contacting them about the listed debt.",
      "Client has explicitly asked for a cease-communication letter after being told that it does not erase the debt and that the collector or creditor may still take legal action.",
    ],
    enclosures: [],
    attorneyAttention:
      "A cease-communication letter does not erase the debt, does not stop credit reporting, and ends the informal contact through which a debt is often resolved; a collector that can no longer call or write may decide to file a lawsuit. § 805(c) binds debt collectors, not original creditors collecting their own debts. Please confirm the warning staff must give and whether the client's request should be recorded in writing.",
    staffNote:
      "Use only at the client's explicit request. It does not erase the debt and can lead to a lawsuit. Never suggest it as a way to improve credit.",
    appliesTo: ["tradeline"],
  }),
  meta({
    key: "collector_dispute_while_validation_pending",
    title: { es: "Deuda disputada que aparece en el reporte mientras la verificación está pendiente", en: "Disputed debt reported while verification is outstanding" },
    category: "collector",
    recipient: "collector",
    statutes: [fdcpa("809", "(b)"), fcra("623", "(a)(3)")],
    useWhen: {
      es: "El cliente pidió a tiempo la verificación, no la ha recibido, y la cobranza aparece en su reporte de crédito.",
      en: "The client asked for verification in time, has not received it, and the collection appears on their credit report.",
    },
    requiresFacts: [
      "Client sent a written dispute or verification request to this collector within 30 days of receiving its first notice, and has proof of mailing.",
      "Client has not received verification of the debt.",
      "The collection appears on the client's current credit report.",
    ],
    enclosures: ["Copy of the earlier verification request and proof of mailing or delivery"],
    stageHint: "follow_up",
    attorneyAttention:
      "The letter does not say that reporting a debt while verification is outstanding is unlawful, because whether credit reporting is collection activity that § 809(b) pauses is not settled. It asks for verification, for the debt to be reported as disputed (§ 623(a)(3)), and for correction or deletion if the collector's records do not support it. Please confirm that framing.",
    staffNote: VALIDATION_TIMING,
    appliesTo: ["tradeline"],
  }),

  // ---- Identity theft ----------------------------------------------------------
  meta({
    key: "identity_theft_block",
    title: { es: "Bloqueo de información por robo de identidad", en: "Identity theft block" },
    category: "identity_theft",
    recipient: "bureau",
    statutes: [fcra("605B")],
    useWhen: {
      es: "El cliente es víctima de robo de identidad, tiene su reporte de robo de identidad y pide al buró bloquear las partidas resultantes.",
      en: "The client is a victim of identity theft, has an identity theft report, and asks the bureau to block the resulting items.",
    },
    requiresFacts: [
      "Client states they are a victim of identity theft.",
      "Client states each listed item resulted from identity theft: a transaction they did not make or authorize.",
      "Client has filed an identity theft report (FTC IdentityTheft.gov report or police report) and provides a copy.",
    ],
    enclosures: [FTC_REPORT, ...IDENTITY],
    stageHint: "dispute",
    attorneyAttention:
      "Original round-engine letter; wording unchanged. It states as fact that the client is a victim of identity theft and that an identity theft report is enclosed. An untrue identity theft claim has serious consequences for the client, and a bureau may decline or rescind a block it believes was requested in error or by misrepresentation. The existing wording also says 'you must block ... within four (4) business days', which is firmer than the new letters. Please confirm the safeguards: staff never suggest this letter, and it is sent only with the client's own statement and report.",
    staffNote: "Never suggest identity theft to a client. Do not send unless the identity theft report is physically enclosed.",
    appliesTo: ["tradeline", "inquiry", "public_record", "personal_info"],
  }),
  meta({
    key: "identity_fraud_alert",
    title: { es: "Solicitud de alerta de fraude inicial", en: "Request for an initial fraud alert" },
    category: "identity_theft",
    recipient: "bureau",
    statutes: [fcra("605A", "(a)")],
    useWhen: {
      es: "El cliente sospecha de buena fe que ha sido o está por ser víctima de fraude o robo de identidad y quiere una alerta en su expediente.",
      en: "The client suspects in good faith that they have been or are about to become a victim of fraud or identity theft and wants an alert on their file.",
    },
    requiresFacts: [
      "Client states they suspect in good faith that they have been, or are about to become, a victim of fraud or identity theft.",
      "Client asks for a fraud alert and understands lenders may take extra steps to confirm their identity while it is in place.",
    ],
    enclosures: IDENTITY,
    staffNote:
      "One nationwide bureau refers an initial alert to the other two, so one letter is enough. Fraud alerts are normally requested online or by phone, and the dispute address may not be the bureau's fraud-alert address; check the address before mailing. An extended alert is a separate request that requires an identity theft report.",
    appliesTo: [],
  }),
  meta({
    key: "identity_theft_furnisher_notice",
    title: { es: "Aviso de robo de identidad al proveedor de datos", en: "Identity theft notice to the furnisher" },
    category: "identity_theft",
    recipient: "furnisher",
    statutes: [fcra("623", "(a)(6)")],
    useWhen: {
      es: "El cliente es víctima de robo de identidad y pide a la empresa que reporta la deuda que deje de reportarla, adjuntando su reporte de la FTC.",
      en: "The client is a victim of identity theft and asks the company reporting the debt to stop reporting it, enclosing their FTC report.",
    },
    requiresFacts: [
      "Client states they are a victim of identity theft.",
      "Client states each listed account or debt resulted from identity theft: they did not open, use or authorize it.",
      "Client has filed an identity theft report (FTC IdentityTheft.gov report or police report) and provides a copy to enclose.",
    ],
    enclosures: [FTC_REPORT, ...IDENTITY],
    stageHint: "furnisher_direct",
    attorneyAttention:
      "States as fact that the client is a victim of identity theft and that the identity theft report is enclosed; the same safeguards as the § 605B block apply. § 623(a)(6)(B) applies when the report is sent to the address the furnisher specifies for identity theft reports, so the letter asks for the correct address if this is not it. Please confirm the paraphrase of § 623(a)(6)(B).",
    staffNote: "Never suggest identity theft to a client. Do not send unless the identity theft report is physically enclosed.",
    appliesTo: ["tradeline"],
  }),

  // ---- File and access ---------------------------------------------------------
  meta({
    key: "secondary_bureau_request",
    title: { es: "Solicitud de expediente a un buró secundario", en: "File disclosure request to a secondary bureau" },
    category: "file_access",
    recipient: "secondary_bureau",
    statutes: [fcra("609"), fcra("611")],
    useWhen: {
      es: "El cliente quiere ver qué información tiene sobre él una agencia de reportes distinta de las tres principales.",
      en: "The client wants to see what a reporting agency other than the big three holds about them.",
    },
    requiresFacts: ["Client asks to see their file at this agency."],
    enclosures: IDENTITY,
    staffNote: "Original round-engine letter; wording unchanged. § 609 is a right to see the file, not a way to have anything taken off it.",
    appliesTo: [],
  }),
  meta({
    key: "file_disclosure_609",
    title: { es: "Solicitud de divulgación del expediente", en: "Request for file disclosure" },
    category: "file_access",
    recipient: "bureau",
    statutes: [fcra("609", "(a)")],
    useWhen: {
      es: "El cliente quiere una copia completa de su expediente en un buró, incluidas las fuentes y quién lo ha consultado.",
      en: "The client wants a complete copy of their file at a bureau, including sources and who has obtained it.",
    },
    requiresFacts: ["Client asks to see their file at this bureau."],
    enclosures: [...IDENTITY, "Copy of Social Security card"],
    staffNote:
      "§ 609 is a right to see the file, not a way to have anything taken off it, and it does not entitle the client to a creditor's original contract. A fee may apply unless a free disclosure is available; for the free ones use the § 612 letters or annualcreditreport.com.",
    appliesTo: [],
  }),
  meta({
    key: "free_annual_disclosure_612",
    title: { es: "Solicitud de la divulgación anual gratuita", en: "Request for the free annual disclosure" },
    category: "file_access",
    recipient: "secondary_bureau",
    statutes: [fcra("612", "(a)"), fcra("609")],
    useWhen: {
      es: "El cliente no ha recibido en los últimos 12 meses su divulgación anual gratuita de una agencia de reportes especializada.",
      en: "The client has not had their free annual disclosure from a specialty reporting agency in the last 12 months.",
    },
    requiresFacts: [
      "Client asks for their free annual file disclosure from this agency.",
      "Client states they have not received a free annual disclosure from this agency in the past 12 months.",
    ],
    enclosures: IDENTITY,
    attorneyAttention:
      "§ 612(a) free annual disclosures from Equifax, Experian and TransUnion must be requested through the centralized source (annualcreditreport.com or the Annual Credit Report Request Service), so this letter is meant for nationwide specialty agencies, which may require their own toll-free number or form. Please confirm a mailed letter is an acceptable way to ask, and that § 612(a) covers the agencies we send it to.",
    staffNote:
      "Not for Equifax, Experian or TransUnion: their free annual reports come only through annualcreditreport.com or the Annual Credit Report Request Service.",
    appliesTo: [],
  }),
  meta({
    key: "free_disclosure_adverse_action_612",
    title: { es: "Solicitud de divulgación gratuita tras un aviso de acción adversa", en: "Request for a free disclosure after an adverse action notice" },
    category: "file_access",
    recipient: "bureau",
    statutes: [fcra("612", "(b)"), fcra("609")],
    useWhen: {
      es: "En los últimos 60 días el cliente recibió un aviso de que le negaron crédito, seguro o empleo con base en un reporte de esta agencia.",
      en: "In the last 60 days the client received a notice that credit, insurance or employment was denied based on a report from this agency.",
    },
    requiresFacts: [
      "Client received an adverse action notice that names this agency as the source of the report.",
      "Client received that notice within the past 60 days.",
    ],
    enclosures: [...IDENTITY, "Copy of the adverse action notice"],
    staffNote: "The 60 days run from the day the client received the notice. Send the letter to the agency named in the notice.",
    appliesTo: [],
  }),
  meta({
    key: "prescreen_opt_out",
    title: { es: "Exclusión de las listas de ofertas preaprobadas", en: "Prescreen opt-out" },
    category: "file_access",
    recipient: "bureau",
    statutes: [fcra("604", "(e)")],
    useWhen: {
      es: "El cliente quiere dejar de recibir ofertas preaprobadas de crédito o seguro basadas en su expediente.",
      en: "The client wants to stop receiving prescreened offers of credit or insurance based on their file.",
    },
    requiresFacts: ["Client asks to be excluded from prescreened offer lists."],
    enclosures: IDENTITY,
    staffNote:
      "The bureaus run a joint opt-out system (optoutprescreen.com, 1-888-5-OPT-OUT), which is the usual and faster way. An opt-out made there lasts five years; a permanent one needs the bureaus' signed form, which this letter asks for.",
    appliesTo: [],
  }),
];

const BY_KEY = new Map(LETTER_CATALOGUE.map((entry) => [entry.key, entry]));

export function getLetterMeta(key: string): LetterMeta | undefined {
  return BY_KEY.get(key);
}

/** Catalogue entries matching every filter given, in catalogue order. */
export function lettersFor(filter: { recipient?: LetterRecipient; category?: LetterCategory } = {}): LetterMeta[] {
  return LETTER_CATALOGUE.filter(
    (entry) =>
      (filter.recipient === undefined || entry.recipient === filter.recipient) &&
      (filter.category === undefined || entry.category === filter.category),
  );
}
