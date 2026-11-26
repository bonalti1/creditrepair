import { defineText } from "../staff/i18n/text";
import { PACKAGE_TEXT } from "./packages";

// The words of the review overview and the recording script, for the team
// (docs/LIVE-FUNNEL.md). English first, Spanish for a member who chooses it;
// both pass the claim rules (a test walks them). Plain words, no score, no
// promise, never "we'll remove": the consumer decides what is inaccurate and
// the bureaus decide the outcome.

const FTC = "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports";
const FCRA_605 = "https://www.law.cornell.edu/uscode/text/15/1681c";
const CFPB_BUILD = "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/";

export const LIVE_SOURCES = { disputes: FTC, timeLimits: FCRA_605, building: CFPB_BUILD, official: "https://www.annualcreditreport.com" } as const;

export const LIVE_TEXT = defineText({
  en: {
    counts: {
      title: "What the report shows",
      accounts: "Accounts",
      openAccounts: "Open accounts",
      collections: "Collections",
      latePayments: "Accounts with a late payment",
      chargeOffs: "Charged off",
      inquiries: "Inquiries",
      publicRecords: "Public records",
      personalInfo: "Personal details reported",
      onceNote: "An account on more than one bureau is counted once.",
      perBureau: "By bureau",
      reportDate: (date: string) => `Report date: ${date}`,
      noBureau: "No bureau could be read.",
    },
    law: {
      title: "What the law lets them dispute",
      lines: [
        "Under the Fair Credit Reporting Act they may dispute anything on their report they believe is inaccurate or incomplete (§ 611).",
        "The bureau must investigate, usually within 30 days, and correct or delete what is inaccurate, incomplete or cannot be verified.",
        "Most negative information may be reported for 7 years, and a bankruptcy for up to 10 (§ 605). Collections and charge-offs count from 180 days after the first missed payment.",
        "Accurate information may stay on the report. Only they know what is accurate: they decide what, if anything, to dispute.",
      ],
      source: "Sources: FTC and 15 U.S.C. § 1681c",
    },
    limits: {
      title: "Time limits (§ 605)",
      intro: "The last day the law lets each negative item be reported, from the dates the report shows.",
      none: "No negative item shows the date the time limit counts from.",
      until: (date: string) => `until ${date}`,
      passed: (date: string) => `period ended ${date}`,
      types: { late_payment: "Late payment", collection: "Collection", charge_off: "Charge-off", bankruptcy: "Bankruptcy" },
    },
    checks: {
      title: "What the data checks noticed",
      intro: "Things the report's own data shows that may be inconsistent. They are not verdicts: only the person knows whether an item is accurate.",
      none: "The data checks noticed nothing inconsistent.",
      objective: "The data shows it",
      worth: "Worth a look",
    },
    doubtful: (n: number) => `${n} ${n === 1 ? "item" : "items"} the AI reader wasn't sure about: compare with the file before you mention ${n === 1 ? "it" : "them"}.`,
    warnings: "Notes from the reader",
    building: {
      title: "Credit-building basics",
      lines: [
        "Pay every bill on time: payment history matters most.",
        "Keep card balances low compared with their limits.",
        "Keep older accounts open when it makes sense.",
        "Apply only for the credit you need.",
        "Check your reports regularly at annualcreditreport.com.",
      ],
      source: "Source: CFPB",
    },
    fit: {
      title: "Which package may fit",
      intro: "A suggestion for your words, not a decision: the person chooses, and can change later.",
      suggested: "May fit best",
      either: "Either may fit",
      reasons: {
        goal_home: "They want to buy a home soon.",
        many_items: "Several negative items to go through.",
        public_record: "A public record is on the report.",
        collections: "Three or more collections.",
        few_items: "Only a few negative items.",
        no_negatives: "Nothing negative shows: building credit may matter more.",
      },
      complete: PACKAGE_TEXT.en.complete,
      diy: PACKAGE_TEXT.en.diy,
      upgrade: PACKAGE_TEXT.en.upgrade,
      charges: PACKAGE_TEXT.en.charges,
      approvedPlans: "Plans the attorney approved:",
      noPlans: "No plan is approved in the catalogue yet: say the plan is explained before signing.",
    },
    script: {
      title: "What to say (2 to 5 minutes)",
      steps: [
        "Hi, say their first name and yours. Thank them for sending their report.",
        "What the report shows, in plain words: the counts above. No scores.",
        "What the law lets them dispute: anything they believe is inaccurate, incomplete or that can't be verified. They decide.",
        "What the data checks noticed, if anything, as questions for them: “Is this right?”",
        "The time limits that apply, if any.",
        "The two packages, Complete first, with who each is for. Start with DIY, upgrade anytime and keep everything you've done.",
        "How each is charged: with Complete, they're charged each month right after their letters are mailed; DIY is a simple monthly subscription.",
        "Close: “Tap Get started and pick the package that fits you, or chat with us.” Results vary; the bureaus decide.",
      ],
      never: "Never: “we'll remove”, points, dates, guarantees, prices not in a plan, “free”, or what they should mark.",
    },
  },
  es: {
    counts: {
      title: "Lo que muestra el reporte",
      accounts: "Cuentas",
      openAccounts: "Cuentas abiertas",
      collections: "Cobranzas",
      latePayments: "Cuentas con un pago tarde",
      chargeOffs: "Dadas de baja (charge-off)",
      inquiries: "Consultas",
      publicRecords: "Registros públicos",
      personalInfo: "Datos personales reportados",
      onceNote: "Una cuenta que aparece en más de un buró se cuenta una vez.",
      perBureau: "Por buró",
      reportDate: (date: string) => `Fecha del reporte: ${date}`,
      noBureau: "No se pudo leer ningún buró.",
    },
    law: {
      title: "Lo que la ley le permite disputar",
      lines: [
        "Según la Ley de Informes de Crédito Justos (FCRA), puede disputar cualquier dato de su reporte que crea inexacto o incompleto (§ 611).",
        "El buró debe investigar, por lo general en 30 días, y corregir o borrar lo que sea inexacto, incompleto o no se pueda verificar.",
        "La mayoría de la información negativa se puede reportar 7 años, y una bancarrota hasta 10 (§ 605). Las cobranzas y los charge-offs cuentan desde 180 días después del primer pago atrasado.",
        "La información correcta puede quedarse en el reporte. Solo la persona sabe qué es correcto: ella decide qué disputar, si algo.",
      ],
      source: "Fuentes: FTC y 15 U.S.C. § 1681c",
    },
    limits: {
      title: "Plazos de la ley (§ 605)",
      intro: "El último día en que la ley permite reportar cada dato negativo, según las fechas del reporte.",
      none: "Ningún dato negativo muestra la fecha desde la que cuenta el plazo.",
      until: (date: string) => `hasta el ${date}`,
      passed: (date: string) => `el plazo terminó el ${date}`,
      types: { late_payment: "Pago tarde", collection: "Cobranza", charge_off: "Charge-off", bankruptcy: "Bancarrota" },
    },
    checks: {
      title: "Lo que notaron las revisiones de datos",
      intro: "Cosas que los propios datos del reporte muestran y que podrían no cuadrar. No son veredictos: solo la persona sabe si un dato es correcto.",
      none: "Las revisiones de datos no notaron nada que no cuadre.",
      objective: "Los datos lo muestran",
      worth: "Vale la pena mirarlo",
    },
    doubtful: (n: number) => `${n} ${n === 1 ? "dato" : "datos"} en ${n === 1 ? "el" : "los"} que el lector con IA no estuvo seguro: compáralos con el archivo antes de mencionarlos.`,
    warnings: "Notas del lector",
    building: {
      title: "Lo básico para construir crédito",
      lines: [
        "Paga cada cuenta a tiempo: el historial de pagos es lo que más pesa.",
        "Mantén los saldos de tus tarjetas bajos comparados con sus límites.",
        "Mantén abiertas las cuentas más antiguas cuando tenga sentido.",
        "Pide solo el crédito que necesitas.",
        "Revisa tus reportes seguido en annualcreditreport.com.",
      ],
      source: "Fuente: CFPB",
    },
    fit: {
      title: "Qué paquete le puede quedar",
      intro: "Una sugerencia para tus palabras, no una decisión: la persona elige, y puede cambiar después.",
      suggested: "Le puede quedar mejor",
      either: "Le puede quedar cualquiera",
      reasons: {
        goal_home: "Quiere comprar casa pronto.",
        many_items: "Varios datos negativos que revisar.",
        public_record: "Hay un registro público en el reporte.",
        collections: "Tres o más cobranzas.",
        few_items: "Solo unos pocos datos negativos.",
        no_negatives: "No aparece nada negativo: construir crédito puede importar más.",
      },
      complete: PACKAGE_TEXT.es.complete,
      diy: PACKAGE_TEXT.es.diy,
      upgrade: PACKAGE_TEXT.es.upgrade,
      charges: PACKAGE_TEXT.es.charges,
      approvedPlans: "Planes que aprobó el abogado:",
      noPlans: "Todavía no hay un plan aprobado en el catálogo: di que el plan se explica antes de firmar.",
    },
    script: {
      title: "Qué decir (de 2 a 5 minutos)",
      steps: [
        "Saluda con su nombre y di el tuyo. Agradécele por mandar su reporte.",
        "Lo que muestra el reporte, en palabras sencillas: los números de arriba. Sin puntajes.",
        "Lo que la ley le permite disputar: lo que crea inexacto, incompleto o que no se pueda verificar. Ella decide.",
        "Lo que notaron las revisiones de datos, si algo, como preguntas: «¿Esto es correcto?»",
        "Los plazos de la ley que apliquen, si hay.",
        "Los dos paquetes, primero Complete, con para quién es cada uno. Puede empezar con DIY, cambiar a Complete cuando quiera y conservar todo lo que ya hizo.",
        "Cómo se cobra cada uno: con Complete, se cobra cada mes justo después de enviar sus cartas; DIY es una suscripción mensual sencilla.",
        "Cierra: «Toca Empezar y elige el paquete que te quede, o escríbenos». Los resultados varían; los burós deciden.",
      ],
      never: "Nunca: «vamos a quitar», puntos, fechas, garantías, precios que no estén en un plan, «gratis», ni qué debe marcar.",
    },
  },
});
