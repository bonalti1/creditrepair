import { BRAND } from "../brand";
import { AGREEMENT_TIME_ZONE } from "./businessDays";
import { sha256Hex } from "./sha256";
import {
  CROA_CANCELLATION_FORM,
  CROA_CONTRACT_CANCEL_SENTENCE,
  CROA_DISCLOSURE,
  TEXAS_CANCELLATION_FORM,
  TEXAS_CONTRACT_CANCEL_SENTENCE,
  TEXAS_DISCLOSURE_REQUIREMENTS,
  type StatuteText,
} from "./statutes";
import { neverInAdvance, paymentTermsLines } from "../billing/plans";
import { placeholder, type ResolvedTerms, type TermKey } from "./terms";

// The agreement: six documents a client reads and signs before any work
// begins. What each one is and which law asks for it is in docs/AGREEMENT.md.
//
// NOTHING HERE HAS BEEN REVIEWED BY AN ATTORNEY. Every document carries
// reviewStatus "attorney_pending". The statutory passages (statutes.ts) are
// reproduced as the law is believed to read and are not yet verified; the rest
// is our draft, written to describe honestly what the product does. A real
// client can sign only after the attorney approves a version and the owner
// records that approval (readiness.ts).
//
// Any change to any text, however small, needs a new AGREEMENT_VERSION: a
// signature records the version and a hash of exactly what was on screen.

export const AGREEMENT_VERSION = "2026-11-21-draft.1";

export type AgreementLocale = "es" | "en";

export type DocumentKey =
  | "federal_disclosure"
  | "texas_disclosure"
  | "esign_consent"
  | "contract"
  | "authorization"
  | "cancellation_notice";

/** Where a passage comes from, which decides how it is marked on screen. */
export type BlockOrigin =
  /** English text worded by a federal statute. Must not be edited. */
  | "federal_statute"
  /** English text worded by a Texas statute. Must not be edited. Needs the attorney. */
  | "texas_statute"
  /** Our Spanish rendering of a statutory passage, shown beside it. The English controls. */
  | "translation"
  /** Our wording. The attorney reviews it. */
  | "draft"
  /** Our wording about a Texas requirement. Needs the attorney in particular. */
  | "texas_draft";

export interface Block {
  kind: "heading" | "paragraph" | "item" | "blank";
  text: string;
  origin: BlockOrigin;
  /** The law requires this passage in bold type. */
  bold?: boolean;
}

export interface AgreementDocument {
  key: DocumentKey;
  title: string;
  /** The law that requires the document, for the reader. */
  law: string;
  /** Always "attorney_pending" until an attorney has approved this version. */
  reviewStatus: "attorney_pending";
  /** Statutory passages this document reproduces, with their verification status. */
  statutes: StatuteText[];
  /** False while any statutory passage in it is unverified. Documents with none are our draft only. */
  verified: boolean;
  blocks: Block[];
  /**
   * Contract only: the statements the law puts in bold type in immediate
   * proximity to the space reserved for the signature. The signing screen
   * renders these directly above the signature field.
   */
  signatureStatements?: Block[];
}

/** What is known only once the contract is signed. */
export interface AgreementFill {
  /** The end of the cancellation window. Written into the notice of cancellation. */
  deadline?: Date | null;
}

/** True for every passage the attorney has to look at with Texas law in hand. */
export function isTexasSpecific(origin: BlockOrigin): boolean {
  return origin === "texas_statute" || origin === "texas_draft";
}

/** Which documents belong to which step. Step 1 comes first and is acknowledged on its own. */
export const DISCLOSURE_STEP: readonly DocumentKey[] = ["federal_disclosure", "texas_disclosure", "esign_consent"];
export const CONTRACT_STEP: readonly DocumentKey[] = ["contract", "authorization", "cancellation_notice"];

// ── Small helpers ───────────────────────────────────────────────────────

type L = AgreementLocale;
const pick = (locale: L, es: string, en: string) => (locale === "es" ? es : en);

const heading = (text: string, origin: BlockOrigin = "draft"): Block => ({ kind: "heading", text, origin });
const para = (text: string, origin: BlockOrigin = "draft", bold = false): Block =>
  bold ? { kind: "paragraph", text, origin, bold } : { kind: "paragraph", text, origin };
const item = (text: string, origin: BlockOrigin = "draft"): Block => ({ kind: "item", text, origin });
const blank = (text: string, origin: BlockOrigin, bold = false): Block =>
  bold ? { kind: "blank", text, origin, bold } : { kind: "blank", text, origin };

/** A term's value, or its visible placeholder when the owner has not set it. */
function termText(terms: ResolvedTerms, key: TermKey, locale: L): string {
  const value = terms[key];
  return value === null || value === undefined ? placeholder(key, locale) : String(value);
}

function dollars(terms: ResolvedTerms, key: "monthlyFee" | "estimatedTotal", locale: L): string {
  if (key === "estimatedTotal") {
    return terms.estimatedTotal ? `$${terms.estimatedTotal}` : pick(locale, "[PENDIENTE: total estimado]", "[PENDING: estimated total]");
  }
  return terms.monthlyFee ? `$${terms.monthlyFee}` : placeholder("monthlyFee", locale);
}

function months(terms: ResolvedTerms, locale: L): string {
  if (terms.estimatedMonths === null) return placeholder("estimatedMonths", locale);
  const n = terms.estimatedMonths;
  return locale === "es" ? `${n} ${n === 1 ? "mes" : "meses"}` : `${n} ${n === 1 ? "month" : "months"}`;
}

/** "to IdentityIQ" / "a IdentityIQ", or the provider unnamed while there is no partner link yet. */
function toMonitoringProvider(terms: ResolvedTerms, locale: L): string {
  if (terms.monitoringProviderName) return pick(locale, `a ${terms.monitoringProviderName}`, `to ${terms.monitoringProviderName}`);
  return pick(locale, "al proveedor de monitoreo de crédito", "to the credit monitoring provider");
}

/** The monitoring price without its "about" sign: the sentence already says "approximately". */
function monitoringPrice(terms: ResolvedTerms): string {
  return terms.monitoringPriceLabel.replace(/^[~≈]\s*/, "");
}

/** The date written into the notice of cancellation: "November 25, 2026". */
export function formatDeadlineDate(deadline: Date, locale: L): string {
  return deadline.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: AGREEMENT_TIME_ZONE,
  });
}

/** Before signing there is no date yet: the slot says how it will be worked out. */
function deadlineSlot(fill: AgreementFill, locale: L): string {
  if (fill.deadline) return formatDeadlineDate(fill.deadline, locale);
  return pick(
    locale,
    "[la fecha se escribe al firmar: el 3.er día hábil después de la firma]",
    "[the date is written in when you sign: the 3rd business day after signing]",
  );
}

// ── 1. Federal disclosure ───────────────────────────────────────────────

const CROA_DISCLOSURE_ES = {
  heading: "Derechos del consumidor sobre su expediente de crédito conforme a las leyes estatales y federales",
  paragraphs: [
    "Usted tiene derecho a disputar la información inexacta de su reporte de crédito comunicándose directamente con el buró de crédito. Sin embargo, ni usted ni ninguna compañía u organización de «reparación de crédito» tiene derecho a que se quite de su reporte de crédito información que sea exacta, actual y verificable. El buró de crédito debe quitar de su reporte la información negativa que sea exacta únicamente si tiene más de 7 años. La información sobre bancarrotas puede reportarse durante 10 años.",
    "Usted tiene derecho a obtener una copia de su reporte de crédito de un buró de crédito. Es posible que le cobren una tarifa razonable. Sin embargo, no hay tarifa si en los 60 días anteriores le negaron crédito, empleo, seguro o una vivienda de alquiler debido a información de su reporte de crédito. El buró de crédito debe poner a su disposición a una persona que le ayude a interpretar la información de su expediente de crédito. Usted tiene derecho a recibir una copia gratuita de su reporte de crédito si está desempleado y piensa solicitar empleo en los próximos 60 días, si recibe asistencia pública, o si tiene motivos para creer que su reporte de crédito contiene información inexacta debido a un fraude.",
    "Usted tiene derecho a demandar a una organización de reparación de crédito que viole la Ley de Organizaciones de Reparación de Crédito (Credit Repair Organization Act). Esta ley prohíbe las prácticas engañosas de las organizaciones de reparación de crédito.",
    "Usted tiene derecho a cancelar su contrato con cualquier organización de reparación de crédito, por cualquier motivo, dentro de los 3 días hábiles siguientes a la fecha en que lo firmó.",
    "Los burós de crédito están obligados a seguir procedimientos razonables para asegurar que la información que reportan sea exacta. Sin embargo, pueden ocurrir errores.",
    "Usted puede, por su cuenta, notificar por escrito a un buró de crédito que disputa la exactitud de la información de su expediente de crédito. El buró de crédito debe entonces volver a investigar y modificar o quitar la información inexacta o incompleta. El buró de crédito no puede cobrar ninguna tarifa por este servicio. Conviene entregar al buró de crédito toda la información pertinente y copias de todos los documentos que tenga sobre el error.",
    "Si la nueva investigación del buró de crédito no resuelve la disputa a su satisfacción, usted puede enviar al buró de crédito una declaración breve, que se conservará en su expediente, explicando por qué cree que el registro es inexacto. El buró de crédito debe incluir un resumen de su declaración sobre la información disputada en cualquier reporte que emita sobre usted.",
    "La Comisión Federal de Comercio (Federal Trade Commission) regula a los burós de crédito y a las organizaciones de reparación de crédito. Para más información, comuníquese con:",
  ],
} as const;

function federalDisclosure(locale: L): AgreementDocument {
  const official: Block[] = [
    heading(CROA_DISCLOSURE.heading, "federal_statute"),
    ...CROA_DISCLOSURE.paragraphs.map((text) => para(text, "federal_statute")),
    ...CROA_DISCLOSURE.contact.map((text) => blank(text, "federal_statute")),
  ];
  // In Spanish the translation is read first, because it is the one the client
  // can read; the official English text follows, complete. (Whether the
  // English must come first is question 4 for the attorney.)
  const blocks: Block[] =
    locale === "es"
      ? [
          para(
            "La ley federal exige que usted reciba esta declaración antes de firmar un contrato, y redacta su texto en inglés. Primero aparece su traducción al español, para su comodidad; después, el texto oficial en inglés, completo. Si hay alguna diferencia, prevalece el texto en inglés.",
            "translation",
          ),
          heading(CROA_DISCLOSURE_ES.heading, "translation"),
          ...CROA_DISCLOSURE_ES.paragraphs.map((text) => para(text, "translation")),
          ...CROA_DISCLOSURE.contact.map((text) => blank(text, "translation")),
          heading("Texto oficial en inglés", "translation"),
          ...official,
        ]
      : official;
  return {
    key: "federal_disclosure",
    title: pick(locale, "Sus derechos sobre su expediente de crédito (declaración federal)", "Your credit file rights (federal statement)"),
    law: "15 U.S.C. §1679c",
    reviewStatus: "attorney_pending",
    statutes: [CROA_DISCLOSURE],
    verified: CROA_DISCLOSURE.verified,
    blocks,
  };
}

// ── The services, described once and used by the Texas statement and the contract ──

function serviceItems(terms: ResolvedTerms, locale: L): string[] {
  const provider = toMonitoringProvider(terms, locale);
  return locale === "es"
    ? [
        `Importar su reporte de crédito. Con su permiso, obtenemos sus reportes de los tres burós de crédito nacionales (Equifax, Experian y TransUnion) a través de la suscripción de monitoreo de crédito que usted contrata y paga directamente ${provider}. Volvemos a importar un reporte nuevo aproximadamente cada 30 a 40 días mientras dure el servicio.`,
        "Mostrarle cada punto y registrar sus respuestas. En nuestra aplicación le mostramos cada punto de su reporte, explicado en palabras sencillas. Usted, y solo usted, nos dice cuáles puntos considera inexactos, incompletos, desactualizados o no verificables, y por qué. Usted confirma cada uno por separado. Nosotros nunca decidimos por usted qué es inexacto y no incluimos en una carta ningún punto que usted no haya confirmado.",
        "Preparar sus cartas de disputa. Sobre los puntos que usted confirmó, preparamos cartas de disputa por escrito, a nombre de usted, dirigidas a los burós de crédito y, cuando corresponde, a la empresa que reportó la información (el acreedor) o a una agencia de cobranza.",
        "Imprimir y enviar las cartas. Imprimimos las cartas y las enviamos por correo postal de los Estados Unidos, con las copias de su identificación y de su comprobante de domicilio que usted nos dio para ese fin.",
        "Dar seguimiento por rondas. Las cartas salen por rondas, aproximadamente una ronda cada 40 días. Después de cada ronda importamos su reporte nuevo, lo comparamos con el anterior, le mostramos qué cambió y qué no, y preparamos la siguiente ronda: cartas de seguimiento sobre los mismos puntos que usted confirmó y cartas sobre cualquier punto nuevo que usted confirme.",
        "Mantenerle informado. Usted puede ver en la aplicación el estado de cada carta, y le avisamos por WhatsApp o mensaje de texto. Una persona de nuestro equipo responde sus preguntas.",
      ]
    : [
        `Import your credit report. With your permission, we obtain your reports from the three national credit bureaus (Equifax, Experian and TransUnion) through the credit monitoring subscription that you buy and pay for directly ${provider}. We import a new report about every 30 to 40 days while the service lasts.`,
        "Show you each item and record your answers. In our app we show you every item on your report, explained in plain words. You, and only you, tell us which items you believe are inaccurate, incomplete, outdated or unverifiable, and why. You confirm each one separately. We never decide for you what is inaccurate, and no item goes into a letter unless you confirmed it.",
        "Prepare your dispute letters. For the items you confirmed, we prepare written dispute letters in your name, addressed to the credit bureaus and, where appropriate, to the company that reported the information (the creditor) or to a debt collector.",
        "Print and mail the letters. We print the letters and send them by U.S. mail, with the copies of your identification and proof of address that you gave us for that purpose.",
        "Follow up in rounds. Letters go out in rounds, about one round every 40 days. After each round we import your new report, compare it with the one before, show you what changed and what did not, and prepare the next round: follow-up letters on the same items you confirmed, and letters on any new item you confirm.",
        "Keep you informed. You can see the status of every letter in the app, and we send you updates by WhatsApp or text message. A person on our team answers your questions.",
      ];
}

function costItems(terms: ResolvedTerms, locale: L): string[] {
  if (terms.plan) {
    // Under a plan: its payment terms, generated from the plan (billing/plans.ts, attorney-pending), then the rest as before.
    const provider = toMonitoringProvider(terms, locale);
    const price = monitoringPrice(terms);
    return [
      ...paymentTermsLines(terms.plan.terms, terms.plan.effective, locale),
      ...(locale === "es"
        ? [
            `Pagos a otra empresa: el servicio requiere una suscripción activa de monitoreo de crédito, que usted contrata y paga directamente ${provider}: aproximadamente ${price} al mes. Ese pago no es para nosotros. ${BRAND.name} recibe una comisión del servicio de monitoreo cuando usted contrata su suscripción.`,
            "No hay otros cargos: no hay cuota de inscripción, ni cargo por cancelar, ni cargo por el envío de las cartas.",
          ]
        : [
            `Payments to another company: the service requires an active credit monitoring subscription, which you buy and pay for directly ${provider}: about ${price} per month. That payment is not to us. ${BRAND.name} earns a commission from the monitoring service when you subscribe.`,
            "There are no other charges: no enrollment fee, no charge for cancelling, and no charge for mailing the letters.",
          ]),
    ];
  }
  const fee = dollars(terms, "monthlyFee", locale);
  const total = dollars(terms, "estimatedTotal", locale);
  const length = months(terms, locale);
  const provider = toMonitoringProvider(terms, locale);
  const price = monitoringPrice(terms);
  return locale === "es"
    ? [
        `Nuestra cuota: ${fee} por cada mes de servicio.`,
        `Total de los pagos a nosotros: si el servicio dura lo estimado (${length}), el total que usted nos paga es ${total}. Si usted termina el servicio antes, paga solo por el trabajo ya realizado por completo.`,
        `Pagos a otra empresa: el servicio requiere una suscripción activa de monitoreo de crédito, que usted contrata y paga directamente ${provider}: aproximadamente ${price} al mes. Ese pago no es para nosotros. ${BRAND.name} recibe una comisión del servicio de monitoreo cuando usted contrata su suscripción.`,
        "No hay otros cargos: no hay cuota de inscripción, ni cargo por cancelar, ni cargo por el envío de las cartas.",
      ]
    : [
        `Our fee: ${fee} for each month of service.`,
        `Total of the payments to us: if the service lasts as estimated (${length}), the total you pay us is ${total}. If you end the service sooner, you pay only for work already fully performed.`,
        `Payments to another company: the service requires an active credit monitoring subscription, which you buy and pay for directly ${provider}: about ${price} per month. That payment is not to us. ${BRAND.name} earns a commission from the monitoring service when you subscribe.`,
        "There are no other charges: no enrollment fee, no charge for cancelling, and no charge for mailing the letters.",
      ];
}

// ── 2. Texas disclosure statement ───────────────────────────────────────

function texasDisclosure(terms: ResolvedTerms, locale: L): AgreementDocument {
  const T: BlockOrigin = "texas_draft";
  const company = termText(terms, "companyLegalName", locale);
  const blocks: Block[] =
    locale === "es"
      ? [
          para(
            "La ley de Texas exige que una organización de servicios de crédito le entregue este documento antes de que usted firme un contrato o pague cualquier cantidad. Léalo junto con la declaración federal.",
            T,
          ),
          heading("1. Los servicios y su costo total", T),
          para("Estos son los servicios que realizaremos para usted:", T),
          ...serviceItems(terms, locale).map((text) => item(text, T)),
          para("No garantizamos ningún resultado. Esto es lo que cuesta:", T),
          ...costItems(terms, locale).map((text) => item(text, T)),
          para(
            "No cobramos ni recibimos ningún pago por un servicio antes de haberlo realizado por completo.",
            T,
          ),
          heading("2. Su derecho a reclamar contra nuestra fianza", T),
          para(
            "La ley de Texas nos exige mantener una fianza de $10,000 en beneficio de nuestros clientes. Si usted sufre un daño porque incumplimos la ley de Texas sobre organizaciones de servicios de crédito (Código de Finanzas de Texas, capítulo 393), usted puede presentar una reclamación contra esa fianza para recuperar sus daños.",
            T,
          ),
          heading("3. La compañía afianzadora", T),
          para(`${termText(terms, "bondSuretyName", locale)}, ${termText(terms, "bondSuretyAddress", locale)}.`, T),
          heading("4. Su derecho a revisar su expediente de crédito", T),
          para(
            "Conforme a la Ley Federal de Informe Justo de Crédito (Fair Credit Reporting Act, 15 U.S.C. §1681 y siguientes), usted tiene derecho a revisar cualquier expediente que una agencia de informes del consumidor (un buró de crédito) tenga sobre usted. Puede pedirlo directamente a cada buró.",
            T,
          ),
          heading("5. Cuándo su expediente es gratuito", T),
          para(
            "Su expediente está disponible para su revisión sin costo si lo solicita a la agencia de informes del consumidor a más tardar 30 días después de la fecha en que usted recibió el aviso de que le negaron un crédito. En cualquier otro momento está disponible por un cargo mínimo.",
            T,
          ),
          para(
            "Además, la ley federal hoy le da más que eso: 60 días después de una negativa, y un reporte gratuito de cada buró cada 12 meses en annualcreditreport.com.",
            T,
          ),
          heading("6. Su derecho a disputar directamente", T),
          para(
            "Usted tiene derecho a disputar directamente ante una agencia de informes del consumidor si un punto de su expediente está completo o es exacto. No necesita de nosotros ni de nadie más para hacerlo, y el buró no puede cobrarle por ello.",
            T,
          ),
          heading("7. La información exacta permanece", T),
          para(
            "La información exacta no puede quitarse de forma permanente de los expedientes de una agencia de informes del consumidor.",
            T,
          ),
          heading("8. Cuándo la información se vuelve obsoleta", T),
          para(
            "La mayor parte de la información negativa se vuelve obsoleta 7 años después de ocurrida, y a partir de entonces una agencia de informes del consumidor ya no puede incluirla en un reporte. Las bancarrotas pueden reportarse hasta por 10 años. Estos límites no se aplican a un reporte que se usa para un crédito o un seguro de vida de $150,000 o más, o para un empleo con salario anual de $75,000 o más.",
            T,
          ),
          heading("9. Asesoría de crédito sin fines de lucro", T),
          para(
            "En Texas hay servicios de asesoría de crédito sin fines de lucro, que pueden ayudarle a bajo costo o sin costo. Una forma de encontrar una agencia aprobada es la lista del U.S. Trustee Program del Departamento de Justicia, en justice.gov/ust.",
            T,
          ),
          heading("10. Nuestro registro", T),
          para(
            `${company} está registrada ante el Secretario de Estado de Texas como organización de servicios de crédito, con el número de registro ${termText(terms, "texasRegistrationNumber", locale)}. Usted puede pedirnos ver nuestra declaración de registro.`,
            T,
          ),
        ]
      : [
          para(
            "Texas law requires a credit services organization to give you this document before you sign a contract or pay anything. Read it together with the federal statement.",
            T,
          ),
          heading("1. The services and their total cost", T),
          para("These are the services we will perform for you:", T),
          ...serviceItems(terms, locale).map((text) => item(text, T)),
          para("We do not guarantee any result. This is what it costs:", T),
          ...costItems(terms, locale).map((text) => item(text, T)),
          para("We do not charge or receive any payment for a service before it has been fully performed.", T),
          heading("2. Your right to proceed against our surety bond", T),
          para(
            "Texas law requires us to keep a $10,000 surety bond for the benefit of our clients. If you are harmed because we violate the Texas law on credit services organizations (Texas Finance Code, chapter 393), you may bring a claim against that bond to recover your damages.",
            T,
          ),
          heading("3. The surety company", T),
          para(`${termText(terms, "bondSuretyName", locale)}, ${termText(terms, "bondSuretyAddress", locale)}.`, T),
          heading("4. Your right to review your credit file", T),
          para(
            "Under the federal Fair Credit Reporting Act (15 U.S.C. §1681 et seq.), you have the right to review any file that a consumer reporting agency (a credit bureau) keeps about you. You can ask each bureau for it directly.",
            T,
          ),
          heading("5. When your file is free", T),
          para(
            "Your file is available for review at no charge if you ask the consumer reporting agency for it not later than the 30th day after the date you received notice that credit was denied. It is available for a minimal charge at any other time.",
            T,
          ),
          para(
            "Federal law today gives you more than that: 60 days after a denial, and a free report from each bureau every 12 months at annualcreditreport.com.",
            T,
          ),
          heading("6. Your right to dispute directly", T),
          para(
            "You have the right to dispute directly with a consumer reporting agency the completeness or accuracy of any item in the file it keeps about you. You do not need us or anyone else to do it, and the bureau cannot charge you for it.",
            T,
          ),
          heading("7. Accurate information stays", T),
          para("Accurate information cannot be permanently removed from the files of a consumer reporting agency.", T),
          heading("8. When information becomes obsolete", T),
          para(
            "Most negative information becomes obsolete 7 years after it happened, and from then on a consumer reporting agency may no longer include it in a report. Bankruptcies can be reported for up to 10 years. These limits do not apply to a report used for credit or life insurance of $150,000 or more, or for a job paying $75,000 a year or more.",
            T,
          ),
          heading("9. Nonprofit credit counseling", T),
          para(
            "Nonprofit credit counseling services are available in Texas and may help you at low or no cost. One way to find an approved agency is the list kept by the U.S. Trustee Program of the Department of Justice, at justice.gov/ust.",
            T,
          ),
          heading("10. Our registration", T),
          para(
            `${company} is registered with the Texas Secretary of State as a credit services organization, registration number ${termText(terms, "texasRegistrationNumber", locale)}. You may ask to see our registration statement.`,
            T,
          ),
        ];
  return {
    key: "texas_disclosure",
    title: pick(locale, "Declaración informativa de Texas", "Texas disclosure statement"),
    law: "Tex. Fin. Code §393.105",
    reviewStatus: "attorney_pending",
    statutes: [TEXAS_DISCLOSURE_REQUIREMENTS],
    verified: TEXAS_DISCLOSURE_REQUIREMENTS.verified,
    blocks,
  };
}

// ── 3. Consent to electronic records ────────────────────────────────────

function esignConsent(terms: ResolvedTerms, locale: L): AgreementDocument {
  const email = termText(terms, "companyEmail", locale);
  const address = termText(terms, "companyAddress", locale);
  const blocks: Block[] =
    locale === "es"
      ? [
          para(
            "Usted acepta recibir en formato electrónico las declaraciones informativas, el contrato de servicios, el aviso de cancelación, la autorización y los avisos posteriores sobre este servicio, y firmarlos de forma electrónica escribiendo su nombre.",
          ),
          para(
            `Copia en papel: puede pedir en cualquier momento, sin costo, una copia en papel de cualquiera de estos documentos escribiendo a ${email} o a ${address}. También puede imprimirlos desde la aplicación, en «Mi acuerdo».`,
          ),
          para(
            "Puede retirar este consentimiento en cualquier momento escribiéndonos. Si lo retira antes de firmar, le entregaremos los documentos en papel. Retirarlo después no deshace lo que ya firmó.",
          ),
          para(
            "Lo que necesita: un teléfono o una computadora con conexión a internet y un navegador actualizado, para leer y guardar estos documentos. Si cambia su número de teléfono o su correo electrónico, avísenos para poder localizarle.",
          ),
          para("Este consentimiento se aplica únicamente a este servicio."),
        ]
      : [
          para(
            "You agree to receive the disclosure statements, the service agreement, the notice of cancellation, the authorization and later notices about this service in electronic form, and to sign them electronically by typing your name.",
          ),
          para(
            `Paper copy: you can ask at any time, at no cost, for a paper copy of any of these documents by writing to ${email} or to ${address}. You can also print them from the app, under "My agreement".`,
          ),
          para(
            "You can withdraw this consent at any time by writing to us. If you withdraw it before signing, we will give you the documents on paper. Withdrawing it later does not undo what you already signed.",
          ),
          para(
            "What you need: a phone or a computer with an internet connection and a current web browser, to read and keep these documents. If your phone number or email address changes, tell us so we can reach you.",
          ),
          para("This consent applies to this service only."),
        ];
  return {
    key: "esign_consent",
    title: pick(locale, "Consentimiento para documentos y firma electrónicos", "Consent to electronic records and signature"),
    law: "15 U.S.C. §7001(c) (E-SIGN Act)",
    reviewStatus: "attorney_pending",
    statutes: [],
    verified: false,
    blocks,
  };
}

// ── 4. The service contract ─────────────────────────────────────────────

const CONTRACT_CANCEL_ES =
  "Usted puede cancelar este contrato sin penalidad ni obligación en cualquier momento antes de la medianoche del 3.er día hábil posterior a la fecha en que firmó el contrato. Consulte el formulario de aviso de cancelación adjunto para una explicación de este derecho.";
const TEXAS_CONTRACT_CANCEL_ES =
  "Usted, el comprador, puede cancelar este contrato en cualquier momento antes de la medianoche del tercer día posterior a la fecha de la transacción. Consulte el formulario de aviso de cancelación adjunto para una explicación de este derecho.";

function contract(terms: ResolvedTerms, locale: L): AgreementDocument {
  const company = termText(terms, "companyLegalName", locale);
  const address = termText(terms, "companyAddress", locale);
  const email = termText(terms, "companyEmail", locale);
  const length = months(terms, locale);
  const fee = dollars(terms, "monthlyFee", locale);
  const TX: BlockOrigin = "texas_draft";

  const blocks: Block[] =
    locale === "es"
      ? [
          heading("1. Quiénes firman"),
          para(
            `Este contrato es entre ${company} (en adelante «${BRAND.name}» o «nosotros»), con domicilio principal en ${address}, y usted, la persona que firma al final («usted»). Lleva la fecha del día en que usted lo firma.`,
          ),
          heading("2. Lo que haremos para usted (los servicios)"),
          para("Realizaremos los siguientes servicios, y solo estos:"),
          ...serviceItems(terms, locale).map((text) => item(text)),
          heading("3. Lo que no hacemos y lo que no prometemos"),
          item(
            "No garantizamos ningún resultado. No prometemos que algún punto será corregido o quitado de su reporte, que su puntaje de crédito cambiará, ni que le aprobarán un préstamo, una tarjeta, un arrendamiento o una hipoteca. Los burós de crédito y las empresas que reportan la información deciden cómo responden a una disputa.",
          ),
          item(
            "Nadie puede lograr legalmente que se quite de un reporte de crédito información que es exacta, actual y verificable. No ayudamos con eso, y no preparamos una carta que diga algo que usted nos haya dicho que no es cierto.",
          ),
          item(
            "No somos un despacho de abogados y no damos asesoría legal. No somos un prestamista, un buró de crédito ni una empresa de liquidación de deudas, y no negociamos ni pagamos sus deudas.",
          ),
          item(
            "Usted puede disputar información inexacta por su cuenta, directamente ante los burós de crédito, sin costo. Usted nos paga por preparar y enviar las cartas en su lugar, no por algo que solo nosotros podamos hacer.",
          ),
          heading("4. Cuándo empieza el trabajo y cuánto dura"),
          para(
            "No empezamos ningún trabajo durante el periodo de cancelación. El trabajo empieza el primer día hábil después de que termina su derecho a cancelar sin penalidad (sección 7), siempre que ya tengamos su identificación, su comprobante de domicilio y su reporte de crédito.",
          ),
          para(
            `Duración estimada: calculamos que realizar los servicios tomará ${length} a partir del día en que empieza el trabajo. Cada ronda toma unos 40 días: los burós tienen por lo general 30 días para responder, y después importamos su reporte nuevo.`,
            TX,
          ),
          para("Es una estimación, no una promesa de resultado. Usted puede terminar el servicio en cualquier momento (sección 8)."),
          heading("5. Lo que cuesta (condiciones de pago)"),
          ...costItems(terms, locale).map((text) => item(text)),
          para(
            terms.plan
              ? neverInAdvance(terms.plan.terms, locale)
              : `Nunca cobramos por adelantado. No cobramos ni recibimos dinero ni ninguna otra cosa de valor por un servicio antes de haberlo realizado por completo (15 U.S.C. §1679b(b)). Cada cuota de ${fee} se cobra únicamente después de terminado el trabajo que paga: después de que la ronda de cartas de ese periodo fue preparada y enviada por correo.`,
          ),
          heading("6. Garantías y reembolsos"),
          para(
            "No damos ninguna garantía de resultados. Como solo cobramos después de realizar el trabajo, no hay pagos adelantados que reembolsar. Si le cobramos por error un trabajo que no se realizó, le devolvemos ese cobro dentro de los 10 días siguientes a su aviso.",
            TX,
          ),
          heading("7. Su derecho a cancelar en los primeros 3 días hábiles"),
          para(
            "Usted puede cancelar este contrato sin penalidad ni obligación en cualquier momento antes de la medianoche del 3.er día hábil posterior a la fecha en que lo firmó. Para contar los días hábiles no contamos sábados, domingos ni días feriados federales, y usamos la hora de Texas.",
          ),
          para(
            `Para cancelar puede tocar «Cancelar sin costo» en la aplicación, o enviar por correo o entregar el aviso de cancelación adjunto, o cualquier otro aviso por escrito, a nuestro domicilio (${address}) o a ${email}. Si cancela, no nos debe nada, y cualquier pago que hubiera hecho se le devuelve dentro de los 10 días siguientes a que recibamos su aviso.`,
          ),
          para("Este contrato lleva adjunto, por duplicado, un formulario de aviso de cancelación."),
          heading("8. Terminar el servicio más adelante"),
          para(
            "Pasado el periodo de cancelación, usted puede terminar el servicio en cualquier momento y por cualquier motivo, desde la aplicación o escribiéndonos. Terminar no tiene costo. Usted paga solo por el trabajo ya realizado por completo antes de que recibamos su solicitud.",
          ),
          para(
            "Nosotros podemos terminar el servicio si usted nos pide incluir en una carta información que nos ha dicho que es exacta, o si nos da información falsa.",
          ),
          heading("9. Lo que necesitamos de usted"),
          item("Que la información que nos dé sea verdadera, y que confirme como inexacto solo lo que de verdad considera inexacto."),
          item("Que mantenga activa su suscripción de monitoreo de crédito mientras dure el servicio."),
          item("Que nos dé una copia de su identificación oficial y de un comprobante de domicilio reciente."),
          item("Que nos avise cuando un buró, un acreedor o una agencia de cobranza le escriba: sus respuestas suelen llegar a su domicilio."),
          item("Que mantenga al día su domicilio y su teléfono."),
          heading("10. Su información"),
          para(
            "Usamos su información personal y sus reportes de crédito únicamente para realizar estos servicios. No los vendemos.",
          ),
          heading("11. Texas", TX),
          para(
            `${company} está registrada ante el Secretario de Estado de Texas como organización de servicios de crédito, con el número de registro ${termText(terms, "texasRegistrationNumber", locale)}. Mantenemos una fianza de $10,000 emitida por ${termText(terms, "bondSuretyName", locale)}, ${termText(terms, "bondSuretyAddress", locale)}.`,
            TX,
          ),
          para(
            `Nuestro agente en Texas autorizado para recibir notificaciones judiciales es ${termText(terms, "texasAgentName", locale)}, ${termText(terms, "texasAgentAddress", locale)}.`,
            TX,
          ),
          heading("12. Sus derechos no se pueden renunciar"),
          para(
            "Nada en este contrato le quita ningún derecho que usted tenga conforme a la ley federal de organizaciones de reparación de crédito (Credit Repair Organizations Act) o al capítulo 393 del Código de Finanzas de Texas. Cualquier parte de este contrato que lo intentara no tendría validez.",
          ),
          heading("13. Copias y firma electrónica"),
          para(
            "Usted firma este contrato de forma electrónica. Al firmar recibe una copia completa de este contrato, de las declaraciones informativas que recibió antes, del aviso de cancelación y de la autorización. Están disponibles en cualquier momento en la aplicación, en «Mi acuerdo», desde donde puede imprimirlas.",
          ),
          heading("14. Idioma"),
          para(
            "Le entregamos este contrato en el idioma en que le explicamos el servicio. Las declaraciones que exigen la ley federal y la ley de Texas aparecen en inglés, tal como la ley las redacta, con una traducción al español para su comodidad; en esas declaraciones prevalece el texto en inglés.",
            TX,
          ),
        ]
      : [
          heading("1. The parties"),
          para(
            `This agreement is between ${company} ("${BRAND.name}", "we" or "us"), whose principal place of business is ${address}, and you, the person who signs at the end ("you"). It is dated the day you sign it.`,
          ),
          heading("2. What we will do for you (the services)"),
          para("We will perform the following services, and only these:"),
          ...serviceItems(terms, locale).map((text) => item(text)),
          heading("3. What we do not do and do not promise"),
          item(
            "We do not guarantee any result. We do not promise that any item will be corrected or taken off your report, that your credit score will change, or that you will be approved for a loan, a card, a lease or a mortgage. The credit bureaus and the companies that report the information decide how they respond to a dispute.",
          ),
          item(
            "No one can lawfully have accurate, current and verifiable information taken off a credit report. We do not help with that, and we do not prepare a letter that says something you have told us is not true.",
          ),
          item(
            "We are not a law firm and we do not give legal advice. We are not a lender, a credit bureau or a debt settlement company, and we do not negotiate or pay your debts.",
          ),
          item(
            "You can dispute inaccurate information yourself, directly with the credit bureaus, at no cost. You are paying us to prepare and mail the letters for you, not for something only we can do.",
          ),
          heading("4. When the work starts and how long it lasts"),
          para(
            "We do not begin any work during the cancellation period. Work begins on the first business day after your right to cancel without penalty ends (section 7), provided we already have your identification, your proof of address and your credit report.",
          ),
          para(
            `Estimated length: we estimate that performing the services will take ${length} from the day work begins. Each round takes about 40 days: the bureaus generally have 30 days to answer, and we then import your new report.`,
            TX,
          ),
          para("This is an estimate, not a promise of any outcome. You can end the service at any time (section 8)."),
          heading("5. What it costs (payment terms)"),
          ...costItems(terms, locale).map((text) => item(text)),
          para(
            terms.plan
              ? neverInAdvance(terms.plan.terms, locale)
              : `We never charge in advance. We do not charge or receive any money or other valuable consideration for a service before that service has been fully performed (15 U.S.C. §1679b(b)). Each ${fee} fee is charged only after the work it pays for is complete: after that period's round of letters has been prepared and mailed.`,
          ),
          heading("6. Guarantees and refunds"),
          para(
            "We give no guarantee of results. Because we charge only after the work is performed, there is nothing paid in advance to refund. If we charge you by mistake for work that was not performed, we return that charge within 10 days of your telling us.",
            TX,
          ),
          heading("7. Your right to cancel in the first 3 business days"),
          para(
            "You may cancel this agreement without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed it. In counting business days we do not count Saturdays, Sundays or federal holidays, and we use Texas time.",
          ),
          para(
            `To cancel you can tap "Cancel at no cost" in the app, or mail or deliver the attached notice of cancellation, or any other written notice, to our address (${address}) or to ${email}. If you cancel you owe us nothing, and any payment you may have made is returned within 10 days after we receive your notice.`,
          ),
          para("A notice of cancellation form is attached to this agreement, in duplicate."),
          heading("8. Ending the service later"),
          para(
            "After the cancellation period you can still end the service at any time and for any reason, from the app or by writing to us. Ending it costs nothing. You pay only for work already fully performed before we receive your request.",
          ),
          para(
            "We may end the service if you ask us to put into a letter information you have told us is accurate, or if you give us false information.",
          ),
          heading("9. What we need from you"),
          item("That the information you give us is true, and that you confirm as inaccurate only what you really believe is inaccurate."),
          item("That you keep your credit monitoring subscription active while the service lasts."),
          item("A copy of your government identification and of a recent proof of address."),
          item("That you tell us when a bureau, a creditor or a debt collector writes to you: their answers usually go to your home address."),
          item("That you keep your address and phone number current."),
          heading("10. Your information"),
          para("We use your personal information and your credit reports only to perform these services. We do not sell them."),
          heading("11. Texas", TX),
          para(
            `${company} is registered with the Texas Secretary of State as a credit services organization, registration number ${termText(terms, "texasRegistrationNumber", locale)}. We maintain a $10,000 surety bond issued by ${termText(terms, "bondSuretyName", locale)}, ${termText(terms, "bondSuretyAddress", locale)}.`,
            TX,
          ),
          para(
            `Our agent in Texas authorized to receive service of process is ${termText(terms, "texasAgentName", locale)}, ${termText(terms, "texasAgentAddress", locale)}.`,
            TX,
          ),
          heading("12. Your rights cannot be waived"),
          para(
            "Nothing in this agreement takes away any right you have under the federal Credit Repair Organizations Act or chapter 393 of the Texas Finance Code. Any part of this agreement that tried to would have no effect.",
          ),
          heading("13. Copies and electronic signature"),
          para(
            'You sign this agreement electronically. When you sign, you receive a complete copy of this agreement, of the disclosure statements you received before it, of the notice of cancellation and of the authorization. They are available at any time in the app, under "My agreement", where you can print them.',
          ),
          heading("14. Language"),
          para(
            "We give you this agreement in the language in which we explained the service to you. The statements required by federal law and by Texas law appear in English, as the law words them, with a Spanish translation for convenience; for those statements the English text controls.",
            TX,
          ),
        ];

  // Spanish: the translation first, then the sentence exactly as the law words it.
  const signatureStatements: Block[] = [
    ...(locale === "es" ? [para(CONTRACT_CANCEL_ES, "translation", true)] : []),
    para(CROA_CONTRACT_CANCEL_SENTENCE.text, "federal_statute", true),
    ...(locale === "es" ? [para(TEXAS_CONTRACT_CANCEL_ES, "translation", true)] : []),
    para(TEXAS_CONTRACT_CANCEL_SENTENCE.text, "texas_statute", true),
    para(
      pick(
        locale,
        "Estas declaraciones las exige la ley, una federal y una de Texas, y por eso aparecen también en inglés, tal como la ley las redacta. Aplicamos el plazo más largo: 3 días hábiles.",
        "The two statements above are required by law, one federal and one Texas. The longer period applies: 3 business days.",
      ),
      TX,
    ),
  ];

  return {
    key: "contract",
    title: pick(locale, "Contrato de servicios", "Service agreement"),
    law: "15 U.S.C. §1679d(b); Tex. Fin. Code §393.201",
    reviewStatus: "attorney_pending",
    statutes: [CROA_CONTRACT_CANCEL_SENTENCE, TEXAS_CONTRACT_CANCEL_SENTENCE],
    verified: CROA_CONTRACT_CANCEL_SENTENCE.verified && TEXAS_CONTRACT_CANCEL_SENTENCE.verified,
    blocks,
    signatureStatements,
  };
}

// ── 5. Limited authorization ────────────────────────────────────────────

function authorization(terms: ResolvedTerms, locale: L): AgreementDocument {
  const company = termText(terms, "companyLegalName", locale);
  const address = termText(terms, "companyAddress", locale);
  const email = termText(terms, "companyEmail", locale);
  const blocks: Block[] =
    locale === "es"
      ? [
          para(`Autorizo a ${company} («${BRAND.name}») a hacer por mí lo siguiente, y nada más:`),
          item(
            "Preparar cartas de disputa por escrito, a mi nombre, sobre los puntos de mis reportes de crédito que yo revisé personalmente y confirmé en la aplicación como inexactos, incompletos, desactualizados o no verificables.",
          ),
          item(
            `Poner mi nombre y mi domicilio en esas cartas como remitente, y dejar constancia en los registros de ${BRAND.name} de que ${BRAND.name} las preparó.`,
          ),
          item(
            "Imprimir esas cartas y enviarlas por correo a los burós de crédito, a las empresas que reportaron la información y a las agencias de cobranza, con las copias de mi identificación y de mi comprobante de domicilio que entregué para ese fin.",
          ),
          item(
            "Preparar y enviar cartas de seguimiento sobre esos mismos puntos, en rondas posteriores, cuando un reporte nuevo muestre que un punto no fue corregido ni quitado, hasta que yo indique lo contrario.",
          ),
          item(
            "Obtener mis reportes de crédito a través de mi suscripción de monitoreo, y recibir y leer las respuestas que los burós, los acreedores y las agencias de cobranza envíen sobre estas disputas, incluidas las que yo les reenvíe.",
          ),
          heading("Límites de esta autorización"),
          item(
            `${BRAND.name} nunca decide qué es inexacto. Solo los puntos que yo confirmo, uno por uno, pueden entrar en una carta. ${BRAND.name} no puede agregar un punto, cambiar mi respuesta ni elegir un motivo por mí.`,
          ),
          item(
            `Esta autorización no permite a ${BRAND.name}: abrir, cerrar o modificar ninguna cuenta; hablar por teléfono en mi nombre con un acreedor o una agencia de cobranza; negociar, liquidar o pagar ninguna deuda; solicitar crédito; actuar como mi abogado; ni firmar ningún documento distinto de las cartas de disputa aquí descritas.`,
          ),
          item("No es un poder general."),
          item(
            `Puedo revocar esta autorización en cualquier momento, desde la aplicación o escribiendo a ${BRAND.name} a ${address} o a ${email}. Cuando ${BRAND.name} recibe mi revocación deja de preparar y enviar cartas. Las cartas ya enviadas no se pueden recuperar.`,
          ),
          item("Termina por sí sola cuando mi contrato de servicios se cancela o termina."),
          para("Confirmo que la información que doy es verdadera según mi leal saber y entender."),
        ]
      : [
          para(`I authorize ${company} ("${BRAND.name}") to do the following for me, and nothing else:`),
          item(
            "Prepare written dispute letters, in my name, about the items on my credit reports that I personally reviewed and confirmed in the app as inaccurate, incomplete, outdated or unverifiable.",
          ),
          item(
            `Put my name and address on those letters as the sender, and keep a record at ${BRAND.name} that ${BRAND.name} prepared them.`,
          ),
          item(
            "Print those letters and mail them to the credit bureaus, to the companies that reported the information and to debt collectors, with the copies of my identification and proof of address that I provided for that purpose.",
          ),
          item(
            "Prepare and mail follow-up letters about those same items, in later rounds, when a new report shows an item was not corrected or taken off, until I say otherwise.",
          ),
          item(
            "Obtain my credit reports through my monitoring subscription, and receive and read the answers that bureaus, creditors and debt collectors send about these disputes, including the ones I forward.",
          ),
          heading("Limits of this authorization"),
          item(
            `${BRAND.name} never decides what is inaccurate. Only the items I confirm, one by one, can go into a letter. ${BRAND.name} may not add an item, change my answer or choose a reason for me.`,
          ),
          item(
            `This authorization does not allow ${BRAND.name} to: open, close or change any account; speak by telephone on my behalf with a creditor or a debt collector; negotiate, settle or pay any debt; apply for credit; act as my attorney; or sign any document other than the dispute letters described here.`,
          ),
          item("It is not a general power of attorney."),
          item(
            `I can revoke this authorization at any time, from the app or by writing to ${BRAND.name} at ${address} or ${email}. Once ${BRAND.name} receives my revocation it stops preparing and mailing letters. Letters already mailed cannot be taken back.`,
          ),
          item("It ends by itself when my service agreement is cancelled or ends."),
          para("I confirm that the information I give is true to the best of my knowledge."),
        ];
  return {
    key: "authorization",
    title: pick(
      locale,
      "Autorización limitada para preparar y enviar cartas de disputa",
      "Limited authorization to prepare and mail dispute letters",
    ),
    law: pick(locale, "Borrador de la empresa; no lo redacta una ley", "Company draft; not worded by a statute"),
    reviewStatus: "attorney_pending",
    statutes: [],
    verified: false,
    blocks,
  };
}

// ── 6. Notice of cancellation ───────────────────────────────────────────

const CANCELLATION_FORM_ES = {
  statement:
    "Usted puede cancelar este contrato, sin ninguna penalidad ni obligación, en cualquier momento antes de la medianoche del 3.er día que comienza después de la fecha en que usted firmó el contrato.",
  howTo: (name: string, address: string, date: string) =>
    `Para cancelar este contrato, envíe por correo o entregue una copia firmada y fechada de este aviso de cancelación, o cualquier otro aviso por escrito, a ${name}, en ${address}, antes de la medianoche del ${date}`,
  closing: "Por este medio cancelo esta transacción,",
  dateLabel: "fecha",
  signatureLabel: "firma del comprador",
};

const TEXAS_FORM_ES = {
  statement:
    "Usted puede cancelar este contrato, sin ninguna penalidad ni obligación, dentro de los tres días siguientes a la fecha en que se firmó el contrato.",
  refund:
    "Si usted cancela, cualquier pago que haya hecho conforme a este contrato le será devuelto dentro de los 10 días siguientes a la fecha en que el vendedor reciba su aviso de cancelación.",
  howTo: (name: string, address: string, date: string) =>
    `Para cancelar este contrato, envíe por correo o entregue una copia firmada y fechada de este aviso de cancelación, u otro aviso por escrito, a: ${name}, en ${address}, a más tardar a la medianoche del ${date}`,
  closing: "Por este medio cancelo esta transacción.",
};

function cancellationNotice(terms: ResolvedTerms, locale: L, fill: AgreementFill): AgreementDocument {
  // The official forms are English, so a placeholder inside them is English too.
  const name = termText(terms, "companyLegalName", "en");
  const address = termText(terms, "companyAddress", "en");
  const nameEs = termText(terms, "companyLegalName", "es");
  const addressEs = termText(terms, "companyAddress", "es");
  const dateEn = fill.deadline ? formatDeadlineDate(fill.deadline, "en") : deadlineSlot(fill, "en");
  const dateEs = fill.deadline ? formatDeadlineDate(fill.deadline, "es") : deadlineSlot(fill, "es");
  const F: BlockOrigin = "federal_statute";
  const TS: BlockOrigin = "texas_statute";
  const line = "______________________________";

  const federalOfficial: Block[] = [
    heading(CROA_CANCELLATION_FORM.heading, F),
    para(CROA_CANCELLATION_FORM.statement, F, true),
    para(CROA_CANCELLATION_FORM.howTo(name, address, dateEn), F, true),
    para(CROA_CANCELLATION_FORM.closing, F, true),
    blank(`${line} (${CROA_CANCELLATION_FORM.dateLabel})`, F, true),
    blank(`${line} (${CROA_CANCELLATION_FORM.signatureLabel})`, F, true),
  ];
  const texasOfficial: Block[] = [
    heading(TEXAS_CANCELLATION_FORM.heading, TS),
    para(TEXAS_CANCELLATION_FORM.statement, TS, true),
    para(TEXAS_CANCELLATION_FORM.refund, TS, true),
    para(TEXAS_CANCELLATION_FORM.howTo(name, address, dateEn), TS, true),
    para(TEXAS_CANCELLATION_FORM.closing, TS, true),
    blank(`${line} (${TEXAS_CANCELLATION_FORM.dateLabel})`, TS, true),
    blank(`${line} (${TEXAS_CANCELLATION_FORM.signatureLabel})`, TS, true),
  ];

  const blocks: Block[] =
    locale === "es"
      ? [
          para(
            "Este formulario va adjunto a su contrato, por duplicado. Úselo solo si quiere cancelar. También puede cancelar con un toque en la aplicación, en «Mi acuerdo»; no necesita enviar este formulario para hacerlo.",
          ),
          para(
            "La ley federal y la ley de Texas redactan cada una su propio aviso, en inglés. De cada uno aparece primero la traducción al español y después el texto oficial en inglés. Puede firmar y enviar cualquiera de los dos.",
            "texas_draft",
          ),
          heading("Aviso de cancelación (ley federal, traducción al español)", "translation"),
          para(CANCELLATION_FORM_ES.statement, "translation", true),
          para(CANCELLATION_FORM_ES.howTo(nameEs, addressEs, dateEs), "translation", true),
          para(CANCELLATION_FORM_ES.closing, "translation", true),
          blank(`${line} (${CANCELLATION_FORM_ES.dateLabel})`, "translation", true),
          blank(`${line} (${CANCELLATION_FORM_ES.signatureLabel})`, "translation", true),
          ...federalOfficial,
          heading("Aviso de cancelación (ley de Texas, traducción al español)", "translation"),
          para(TEXAS_FORM_ES.statement, "translation", true),
          para(TEXAS_FORM_ES.refund, "translation", true),
          para(TEXAS_FORM_ES.howTo(nameEs, addressEs, dateEs), "translation", true),
          para(TEXAS_FORM_ES.closing, "translation", true),
          blank(`${line} (${CANCELLATION_FORM_ES.dateLabel})`, "translation", true),
          blank(`${line} (${CANCELLATION_FORM_ES.signatureLabel})`, "translation", true),
          ...texasOfficial,
          para(
            "La fecha escrita en este aviso es el final del 3.er día hábil después de su firma, sin contar sábados, domingos ni días feriados federales, en hora de Texas. Es el plazo más largo de los que dan las dos leyes.",
            "texas_draft",
          ),
        ]
      : [
          para(
            'This form is attached to your agreement, in duplicate. Use it only if you want to cancel. You can also cancel with one tap in the app, under "My agreement"; you do not need to send this form to do so.',
          ),
          para(
            "Federal law and Texas law each word their own notice. Both follow. You can sign and send either one.",
            "texas_draft",
          ),
          ...federalOfficial,
          heading("Notice under Texas law", "texas_draft"),
          ...texasOfficial,
          para(
            "The date written in this notice is the end of the 3rd business day after you signed, not counting Saturdays, Sundays or federal holidays, in Texas time. It is the longer of the periods the two laws give.",
            "texas_draft",
          ),
        ];

  return {
    key: "cancellation_notice",
    title: pick(locale, "Aviso de cancelación", "Notice of cancellation"),
    law: "15 U.S.C. §1679e(b); Tex. Fin. Code §393.202(b)",
    reviewStatus: "attorney_pending",
    statutes: [CROA_CANCELLATION_FORM, TEXAS_CANCELLATION_FORM],
    verified: CROA_CANCELLATION_FORM.verified && TEXAS_CANCELLATION_FORM.verified,
    blocks,
  };
}

// ── The set ─────────────────────────────────────────────────────────────

/** Every document of the agreement, in the order the client meets them. */
export function agreementDocuments(locale: L, terms: ResolvedTerms, fill: AgreementFill = {}): AgreementDocument[] {
  return [
    federalDisclosure(locale),
    texasDisclosure(terms, locale),
    esignConsent(terms, locale),
    contract(terms, locale),
    authorization(terms, locale),
    cancellationNotice(terms, locale, fill),
  ];
}

export function agreementDocument(
  key: DocumentKey,
  locale: L,
  terms: ResolvedTerms,
  fill: AgreementFill = {},
): AgreementDocument {
  return agreementDocuments(locale, terms, fill).find((d) => d.key === key)!;
}

/** One document as plain text: title, then each passage on its own line, signature statements last. */
export function documentText(document: AgreementDocument): string {
  const lines = [`# ${document.title}`, ...document.blocks.map(blockLine)];
  if (document.signatureStatements) lines.push(...document.signatureStatements.map(blockLine));
  return lines.join("\n");
}

function blockLine(block: Block): string {
  const mark = block.kind === "heading" ? "## " : block.kind === "item" ? "- " : "";
  return `${mark}${block.bold ? `**${block.text}**` : block.text}`;
}

function hashOf(version: string, locale: L, documents: AgreementDocument[]): string {
  return sha256Hex([`version: ${version}`, `locale: ${locale}`, ...documents.map(documentText)].join("\n\n"));
}

/**
 * SHA-256 of exactly what the client is shown when they sign: every document
 * of this version, in this language, with these terms filled in. The date in
 * the notice of cancellation is not part of it (it does not exist until the
 * moment of signing); the signature record keeps that date on its own.
 */
export function documentHash(version: string, locale: L, resolvedTerms: ResolvedTerms): string {
  return hashOf(version, locale, agreementDocuments(locale, resolvedTerms));
}

/** The same, for the documents of step 1 only: what the client acknowledged before seeing the contract. */
export function disclosureHash(version: string, locale: L, resolvedTerms: ResolvedTerms): string {
  return hashOf(
    version,
    locale,
    agreementDocuments(locale, resolvedTerms).filter((d) => DISCLOSURE_STEP.includes(d.key)),
  );
}
