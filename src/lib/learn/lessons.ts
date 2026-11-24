// "Aprende": short lessons about credit, in Spanish and English. Other
// companies give calculators; we explain. Each lesson is at most 150 words per
// language, in short sentences, and every line passes the claim rules
// (src/lib/__tests__/learn.test.ts).
//
// Sources. Every legal fact names the public page it comes from, with the day
// it was checked and how:
//   "verified"      The fact was confirmed on 2026-11-22 against the official
//                   page's own text, found by web search on that page's site
//                   (consumerfinance.gov, consumer.ftc.gov, ftc.gov,
//                   identitytheft.gov, law.cornell.edu for the statute). The
//                   pages themselves could not be opened from the build
//                   environment, so a person should open each link once before
//                   launch (docs/LEARN.md).
//   "needs_review"  Could not be confirmed online. The lesson marks it, and
//                   the screen says "Pendiente de revisión" beside the source.
//
// Who presents each lesson (docs/BRAND.md): "assistant" is Alti, the AI
// assistant, for the lessons that explain how credit works; the lesson says he
// is AI. "team" marks the two lessons about protecting yourself, the team's own
// words about how an honest company works: they show a team icon, never a
// character (Alti is the AI, and the robot is the mailing system).

export type LessonLocale = "es" | "en";
export type SourceStatus = "verified" | "needs_review";

export interface LessonSource {
  /** Who publishes it: "CFPB", "FTC", … */
  publisher: string;
  title: string;
  url: string;
  /** YYYY-MM-DD */
  checkedOn: string;
  status: SourceStatus;
  /** What exactly was checked, or why it could not be. */
  covers: string;
}

export interface Lesson {
  slug: string;
  character: "assistant" | "team";
  /** The tool this lesson leads to, if any. */
  tool?: "utilizacion" | "cuanto-tiempo";
  title: Record<LessonLocale, string>;
  /** One line for the list. */
  summary: Record<LessonLocale, string>;
  /** Paragraphs. */
  body: Record<LessonLocale, string[]>;
  sources: LessonSource[];
}

const CHECKED = "2026-11-22";

const SRC = {
  ftcWeekly: {
    publisher: "FTC",
    title: "You now have permanent access to free weekly credit reports",
    url: "https://consumer.ftc.gov/consumer-alerts/2023/10/you-now-have-permanent-access-free-weekly-credit-reports",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Free weekly reports from the three bureaus are permanent; AnnualCreditReport.com is the only site authorized by law for them.",
  },
  cfpbCompanies: {
    publisher: "CFPB",
    title: "Consumer reporting companies",
    url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/consumer-reporting-companies/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "The CFPB keeps a list of the nationwide and specialty consumer reporting companies, Equifax, Experian and TransUnion among them.",
  },
  ftcUnderstanding: {
    publisher: "FTC",
    title: "Understanding Your Credit",
    url: "https://consumer.ftc.gov/articles/understanding-your-credit",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "General description of a credit report (accounts, balances, payment history, who asked for the report). The page's text could not be read; confirm it.",
  },
  ftcDisputing: {
    publisher: "FTC",
    title: "Disputing Errors on Your Credit Reports",
    url: "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Disputing mistakes costs nothing; the credit reporting company must investigate within 30 days unless it considers the dispute frivolous.",
  },
  ftcIllegalTrick: {
    publisher: "FTC",
    title: "Influencers are pushing this illegal trick to “fix” your credit report",
    url: "https://consumer.ftc.gov/consumer-alerts/2026/01/influencers-are-pushing-illegal-trick-fix-your-credit-report",
    checkedOn: CHECKED,
    status: "verified",
    covers: "The FTC warns against disputing information you know is accurate.",
  },
  cfpbHowLong: {
    publisher: "CFPB",
    title: "How long does negative information remain on my credit report?",
    url: "https://www.consumerfinance.gov/ask-cfpb/how-long-do-negative-information-remain-on-my-credit-report-en-323/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Most negative information can be reported for seven years; bankruptcies up to ten. The limits do not apply to a job paying more than $75,000 a year or to more than $150,000 of credit or life insurance.",
  },
  cfpbAccurate: {
    publisher: "CFPB",
    title: "Is it possible to remove accurate but negative information from my credit report?",
    url: "https://www.consumerfinance.gov/ask-cfpb/is-it-possible-to-remove-accurate-but-negative-information-from-my-credit-report-en-1249/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Accurate negative information generally cannot be removed; errors can be disputed at no cost.",
  },
  statute605: {
    publisher: "U.S. Code (Cornell LII)",
    title: "15 U.S.C. § 1681c (FCRA § 605)",
    url: "https://www.law.cornell.edu/uscode/text/15/1681c",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Collections and charge-offs: seven years, counted from 180 days after the delinquency that led to them began. Bankruptcy cases: ten years. Other adverse items: seven years.",
  },
  ftcFurnishers: {
    publisher: "FTC",
    title: "Consumer Reports: What Information Furnishers Need to Know",
    url: "https://www.ftc.gov/business-guidance/resources/consumer-reports-what-information-furnishers-need-know",
    checkedOn: CHECKED,
    status: "verified",
    covers: "The date of delinquency is when the late payment that led to the collection began, not the date the account went to collection.",
  },
  ftcAdvisoryKosmerl: {
    publisher: "FTC",
    title: "Advisory Opinion to Kosmerl (06-04-99)",
    url: "https://www.ftc.gov/legal-library/browse/advisory-opinions/advisory-opinion-kosmerl-06-04-99",
    checkedOn: CHECKED,
    status: "verified",
    covers: "A later payment or sale of the account does not restart the reporting period.",
  },
  cfpbCollections: {
    publisher: "CFPB",
    title: "How do collections affect my credit?",
    url: "https://www.consumerfinance.gov/ask-cfpb/how-do-collections-affect-my-credit-en-323/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "How a collection appears next to the original account. The page's text could not be read; confirm the wording about the same debt appearing twice.",
  },
  cfpbGoodScore: {
    publisher: "CFPB",
    title: "How do I get and keep a good credit score?",
    url: "https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Utilization is balances on open cards divided by their limits; many experts recommend using less than 30 percent of the total limit; pay on time.",
  },
  paymentHistoryTiming: {
    publisher: "CFPB",
    title: "Understand your credit score",
    url: "https://www.consumerfinance.gov/consumer-tools/credit-reports-and-scores/understand-your-credit-score/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "That a payment is usually reported late once it is 30 days past due, and that payment history weighs the most in common scores. Not confirmed online; review.",
  },
  identityTheftGov: {
    publisher: "FTC",
    title: "IdentityTheft.gov",
    url: "https://www.identitytheft.gov/",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Report identity theft and get an FTC Identity Theft Report and a recovery plan.",
  },
  ftcFreeze: {
    publisher: "FTC",
    title: "Credit Freezes and Fraud Alerts",
    url: "https://consumer.ftc.gov/articles/credit-freezes-and-fraud-alerts",
    checkedOn: CHECKED,
    status: "verified",
    covers: "A fraud alert is free, lasts one year, and is placed with one bureau, which tells the other two. A credit freeze is free, is placed with each bureau, and lasts until you lift it.",
  },
  ftcScams: {
    publisher: "FTC",
    title: "Spot the scams when fixing your credit",
    url: "https://consumer.ftc.gov/consumer-alerts/2026/01/spot-scams-when-fixing-your-credit",
    checkedOn: CHECKED,
    status: "verified",
    covers: "No one can legally remove accurate, up-to-date information. You can dispute mistakes yourself for free. Credit repair companies must give a written contract and a 3-day right to cancel, may not charge before they help you, and may not tell you to lie or to avoid the bureaus.",
  },
  ftcAllNegative: {
    publisher: "FTC",
    title: "Only scammers say they’ll remove all negative information from your credit report",
    url: "https://consumer.ftc.gov/consumer-alerts/2024/08/only-scammers-say-theyll-remove-all-negative-information-your-credit-report",
    checkedOn: CHECKED,
    status: "verified",
    covers: "Promising to remove all negative information is a scam sign.",
  },
  inquiriesTwoYears: {
    publisher: "CFPB",
    title: "What is a credit inquiry?",
    url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-credit-inquiry-en-1317/",
    checkedOn: CHECKED,
    status: "needs_review",
    covers: "Hard and soft inquiries, and that hard inquiries usually show for about two years (a bureau practice, not a rule in the FCRA). Not confirmed online; review the page and its exact address.",
  },
} as const satisfies Record<string, LessonSource>;

export const LESSONS: Lesson[] = [
  {
    slug: "reporte",
    character: "assistant",
    title: { es: "Qué es tu reporte de crédito", en: "What your credit report is" },
    summary: { es: "Una lista de cómo usas el crédito.", en: "A list of how you use credit." },
    body: {
      es: [
        "Tu reporte de crédito es una lista de cómo usas el crédito. Dice qué cuentas tienes, cuánto debes y si pagas a tiempo. También dice quién lo ha pedido.",
        "Lo arman empresas que se llaman burós de crédito. Los bancos y las tiendas les mandan tus datos, casi siempre cada mes.",
        "Cuando pides un préstamo, una tarjeta o a veces una renta, la empresa puede mirar tu reporte. Por eso es bueno que esté correcto.",
        "Tu puntaje se calcula con lo que dice tu reporte. Pero el puntaje y el reporte no son lo mismo.",
        "Puedes ver tus reportes gratis cada semana en AnnualCreditReport.com. Es el único sitio que la ley autoriza para eso.",
      ],
      en: [
        "Your credit report is a list of how you use credit. It shows your accounts, how much you owe and whether you pay on time. It also shows who asked for it.",
        "Companies called credit bureaus put it together. Banks and stores send them your information, usually every month.",
        "When you ask for a loan, a card or sometimes a rental, the company may look at your report. That is why it should be correct.",
        "Your score is worked out from what your report says. But the score and the report are not the same thing.",
        "You can see your reports for free every week at AnnualCreditReport.com. It is the only site the law authorizes for that.",
      ],
    },
    sources: [SRC.ftcUnderstanding, SRC.ftcWeekly],
  },
  {
    slug: "buros",
    character: "assistant",
    title: { es: "Los 3 burós de crédito", en: "The 3 credit bureaus" },
    summary: { es: "Equifax, Experian y TransUnion.", en: "Equifax, Experian and TransUnion." },
    body: {
      es: [
        "Hay tres burós grandes en Estados Unidos: Equifax, Experian y TransUnion. Son empresas privadas, no parte del gobierno.",
        "Cada uno tiene su propio reporte sobre ti. No siempre reciben los mismos datos. Por eso tus tres reportes pueden ser distintos.",
        "Si algo está mal en uno, puede estar bien en otro. Hay que revisar los tres.",
        "También existen otras empresas más pequeñas que guardan datos, por ejemplo de cuentas de banco o de rentas. La CFPB, una agencia del gobierno, tiene la lista.",
        "Ningún buró decide si te dan un préstamo. Eso lo decide la empresa que presta.",
      ],
      en: [
        "There are three big credit bureaus in the United States: Equifax, Experian and TransUnion. They are private companies, not part of the government.",
        "Each one has its own report about you. They do not always get the same information. So your three reports can be different.",
        "If something is wrong on one, it may be right on another. It is worth checking all three.",
        "There are also smaller companies that keep information, for example about bank accounts or rentals. The CFPB, a government agency, keeps the list.",
        "No bureau decides whether you get a loan. The lender decides that.",
      ],
    },
    sources: [SRC.cfpbCompanies, SRC.ftcWeekly],
  },
  {
    slug: "disputa",
    character: "assistant",
    title: { es: "Qué es una disputa, y qué no es", en: "What a dispute is, and what it is not" },
    summary: { es: "Pedir que revisen algo que crees que está mal.", en: "Asking them to check something you believe is wrong." },
    body: {
      es: [
        "Una disputa es pedirle al buró que revise algo de tu reporte que crees que está mal o incompleto. Por ejemplo, una cuenta que no es tuya o una fecha equivocada.",
        "Disputar es gratis. Lo puedes hacer tú mismo, por internet, por teléfono o por carta.",
        "El buró tiene que investigar, casi siempre en unos 30 días, y decirte qué encontró.",
        "Una disputa no es una forma de quitar algo que es correcto. Si la información es cierta y está al día, se queda.",
        "Nunca disputes algo que sabes que es verdad. La FTC, una agencia del gobierno, advierte que eso no es legal.",
        "En Credalti, tú decides qué está mal. Nosotros solo enviamos cartas sobre eso.",
      ],
      en: [
        "A dispute is asking the bureau to check something on your report that you believe is wrong or incomplete. For example, an account that is not yours or a wrong date.",
        "Disputing is free. You can do it yourself, online, by phone or by mail.",
        "The bureau has to investigate, usually within about 30 days, and tell you what it found.",
        "A dispute is not a way to take off something that is correct. If the information is true and up to date, it stays.",
        "Never dispute something you know is true. The FTC, a government agency, warns that this is not legal.",
        "At Credalti, you decide what is wrong. We only send letters about that.",
      ],
    },
    sources: [SRC.ftcDisputing, SRC.cfpbAccurate, SRC.ftcIllegalTrick],
  },
  {
    slug: "cuanto-tiempo",
    character: "assistant",
    tool: "cuanto-tiempo",
    title: { es: "Cuánto tiempo se queda algo en tu reporte", en: "How long things stay on your report" },
    summary: { es: "Casi siempre 7 años. La bancarrota, hasta 10.", en: "Usually 7 years. Bankruptcy, up to 10." },
    body: {
      es: [
        "La ley de reportes de crédito pone un límite de tiempo a lo negativo.",
        "La mayoría de las cosas negativas, como los pagos tarde, se pueden reportar por 7 años.",
        "Una cuenta en cobranza o dada de baja también tiene 7 años. Se cuentan desde 180 días después de tu primer atraso en esa deuda. No desde que la mandaron a cobranza.",
        "Una bancarrota se puede reportar hasta por 10 años.",
        "Pagar la deuda o que la vendan a otra empresa no reinicia ese tiempo.",
        "Hay excepciones. Por ejemplo, si pides un trabajo de más de $75,000 al año, o más de $150,000 en crédito o seguro de vida.",
        "Lo que es correcto se queda hasta que se cumple su tiempo.",
      ],
      en: [
        "The credit reporting law puts a time limit on negative items.",
        "Most negative items, like late payments, can be reported for 7 years.",
        "A collection or a charged-off account also has 7 years. They are counted from 180 days after your first missed payment on that debt. Not from when it went to collection.",
        "A bankruptcy can be reported for up to 10 years.",
        "Paying the debt, or the debt being sold to another company, does not restart that time.",
        "There are exceptions. For example, a job that pays more than $75,000 a year, or more than $150,000 of credit or life insurance.",
        "What is correct stays until its time is up.",
      ],
    },
    sources: [SRC.cfpbHowLong, SRC.statute605, SRC.ftcAdvisoryKosmerl],
  },
  {
    slug: "cobranza",
    character: "assistant",
    title: { es: "Cómo leer una cuenta en cobranza", en: "How to read a collection account" },
    summary: { es: "Quién cobra, cuánto y desde cuándo.", en: "Who is collecting, how much, and since when." },
    body: {
      es: [
        "Una cuenta en cobranza es una deuda que la empresa original dejó de cobrar. Se la pasó o se la vendió a una agencia de cobranza.",
        "Mira estas cosas: el nombre de la agencia, el nombre del acreedor original, el saldo y la fecha del primer atraso.",
        "La fecha del primer atraso es muy importante. De ella depende cuánto tiempo se puede reportar.",
        "La misma deuda puede aparecer dos veces: una con el acreedor original y otra con la agencia. Revisa que el saldo no se cobre dos veces.",
        "Pregúntate: ¿reconozco esta deuda? ¿El saldo es correcto? ¿Las fechas son correctas? Si algo no cuadra, puedes disputarlo.",
      ],
      en: [
        "A collection account is a debt the original company stopped collecting. It passed it on, or sold it, to a collection agency.",
        "Look at these things: the agency's name, the original creditor's name, the balance and the date of the first missed payment.",
        "The date of the first missed payment matters a lot. It decides how long the account can be reported.",
        "The same debt can show up twice: once with the original creditor and once with the agency. Check that the balance is not counted twice.",
        "Ask yourself: do I know this debt? Is the balance right? Are the dates right? If something does not add up, you can dispute it.",
      ],
    },
    sources: [SRC.ftcFurnishers, SRC.statute605, SRC.cfpbCollections],
  },
  {
    slug: "utilizacion",
    character: "assistant",
    tool: "utilizacion",
    title: { es: "Qué es la utilización", en: "What utilization is" },
    summary: { es: "Cuánto usas de tus límites de crédito.", en: "How much of your credit limits you use." },
    body: {
      es: [
        "La utilización es cuánto usas de tus tarjetas, comparado con sus límites.",
        "Se calcula así: el total de lo que debes en tus tarjetas abiertas, dividido entre el total de sus límites.",
        "Por ejemplo: debes $300 y tu límite es $1,000. Tu utilización es 30%.",
        "Muchos expertos recomiendan usar menos del 30% de tu límite total. Cada modelo de puntaje lo mide a su manera.",
        "La utilización cambia cada mes, con el saldo que tu banco reporta. Por eso puede subir o bajar rápido.",
        "Con la calculadora puedes ver tu utilización. No te dice un puntaje: solo hace la cuenta.",
      ],
      en: [
        "Utilization is how much of your cards you use, compared with their limits.",
        "Here is the math: the total you owe on your open cards, divided by the total of their limits.",
        "For example: you owe $300 and your limit is $1,000. Your utilization is 30%.",
        "Many experts suggest using less than 30% of your total limit. Each scoring model measures it its own way.",
        "Utilization changes every month, with the balance your bank reports. So it can go up or down fast.",
        "The calculator shows your utilization. It does not give a score: it only does the math.",
      ],
    },
    sources: [SRC.cfpbGoodScore],
  },
  {
    slug: "pagos",
    character: "assistant",
    title: { es: "Cómo funciona tu historial de pagos", en: "How your payment history works" },
    summary: { es: "Cada pago a tiempo, y cada atraso, queda anotado.", en: "Every on-time payment, and every late one, is recorded." },
    body: {
      es: [
        "Tu historial de pagos muestra, mes por mes, si pagaste a tiempo.",
        "Un pago casi siempre se reporta como tarde cuando ya pasaron 30 días de la fecha límite. Después puede decir 60, 90 o 120 días tarde.",
        "Pagar a tiempo cada mes es de lo que más cuenta en los puntajes comunes.",
        "Si te atrasaste, ponerte al día ayuda a que no siga creciendo el atraso. El atraso que ya pasó se queda en el reporte si es correcto.",
        "Revisa que cada atraso sea cierto. Mira el mes, la cuenta y cuántos días dice.",
        "Un consejo: el pago automático del mínimo ayuda a no olvidar la fecha.",
      ],
      en: [
        "Your payment history shows, month by month, whether you paid on time.",
        "A payment is usually reported late once it is 30 days past the due date. After that it can say 60, 90 or 120 days late.",
        "Paying on time every month is one of the things that counts most in common scores.",
        "If you fell behind, catching up keeps the late payment from growing. A late payment that already happened stays on the report if it is correct.",
        "Check that each late payment is true. Look at the month, the account and how many days it says.",
        "A tip: automatic payment of the minimum helps you not miss the date.",
      ],
    },
    sources: [SRC.paymentHistoryTiming, SRC.cfpbGoodScore],
  },
  {
    slug: "consultas",
    character: "assistant",
    title: { es: "Consultas duras y blandas", en: "Hard and soft inquiries" },
    summary: { es: "Quién miró tu reporte, y por qué.", en: "Who looked at your report, and why." },
    body: {
      es: [
        "Una consulta es cuando alguien pide ver tu reporte.",
        "Una consulta dura pasa cuando tú pides crédito, como una tarjeta o un préstamo. Otros prestamistas la pueden ver.",
        "Una consulta blanda pasa cuando tú miras tu propio reporte, o cuando te mandan una oferta. No la ven los prestamistas.",
        "Las consultas duras casi siempre se ven por unos 2 años.",
        "Revisa la lista. ¿Ves una consulta dura de una empresa a la que nunca le pediste crédito? Puede ser un error o una señal de robo de identidad.",
      ],
      en: [
        "An inquiry is when someone asks to see your report.",
        "A hard inquiry happens when you ask for credit, like a card or a loan. Other lenders can see it.",
        "A soft inquiry happens when you check your own report, or when you get an offer in the mail. Lenders do not see it.",
        "Hard inquiries usually show for about 2 years.",
        "Check the list. If you see a hard inquiry from a company you never asked for credit, it may be a mistake or a sign of identity theft.",
      ],
    },
    sources: [SRC.inquiriesTwoYears],
  },
  {
    slug: "robo-de-identidad",
    character: "team",
    title: { es: "Cómo detectar el robo de identidad", en: "How to spot identity theft" },
    summary: { es: "Señales, y qué hacer en IdentityTheft.gov.", en: "Warning signs, and what to do at IdentityTheft.gov." },
    body: {
      es: [
        "Hay robo de identidad cuando alguien usa tus datos para abrir cuentas o pedir crédito.",
        "Señales: cuentas que no abriste, consultas que no pediste, direcciones donde nunca viviste, o cobros que no reconoces.",
        "Si te pasa, entra a IdentityTheft.gov. Es la página oficial de la FTC. Ahí haces tu reporte y te da un plan paso a paso.",
        "Puedes poner una alerta de fraude gratis por un año. Llamas a un buró y ese buró avisa a los otros dos.",
        "También puedes congelar tu crédito gratis. Se pide en cada uno de los tres burós y dura hasta que tú lo quites.",
        "Tu equipo puede ayudarte con las cartas, si tú lo pides.",
      ],
      en: [
        "Identity theft is when someone uses your information to open accounts or get credit.",
        "Signs: accounts you did not open, inquiries you did not ask for, addresses where you never lived, or charges you do not know.",
        "If it happens, go to IdentityTheft.gov. It is the FTC's official site. You report it there and get a step-by-step plan.",
        "You can place a free fraud alert for one year. You call one bureau and that bureau tells the other two.",
        "You can also freeze your credit for free. You ask each of the three bureaus, and it lasts until you lift it.",
        "Your team can help you with the letters, if you ask.",
      ],
    },
    sources: [SRC.identityTheftGov, SRC.ftcFreeze],
  },
  {
    slug: "estafas",
    character: "team",
    title: { es: "Cómo protegerte de estafas de crédito", en: "How to protect yourself from credit scams" },
    summary: { es: "Lo que la ley prohíbe, y lo que puedes hacer gratis.", en: "What the law forbids, and what you can do for free." },
    body: {
      es: [
        "Nadie puede quitar legalmente de tu reporte algo que es correcto y está al día. Ninguna empresa, tampoco nosotros.",
        "Tú mismo puedes disputar errores con los burós, gratis. No necesitas pagarle a nadie. Todo lo que hace una empresa como Credalti lo puedes hacer tú.",
        "La ley protege a quien contrata una empresa de crédito. Te tienen que dar un contrato por escrito. Tienes 3 días hábiles para cancelar sin costo. No te pueden cobrar antes de hacer el trabajo.",
        "Ten cuidado con una empresa que te promete quitar todo lo negativo o te pide pagar antes. También si te dice que no hables con los burós, o te pide mentir.",
        "Si ves algo así, avísale a la FTC en ReportFraud.ftc.gov.",
      ],
      en: [
        "No one can legally take off your report something that is correct and up to date. No company can, and neither can we.",
        "You can dispute errors with the bureaus yourself, for free. You do not need to pay anyone. Everything a company like Credalti does, you can do yourself.",
        "The law protects people who hire a credit company. They must give you a written contract. You have 3 business days to cancel at no cost. They cannot charge you before the work is done.",
        "Be careful with a company that promises to take off everything negative or asks you to pay first. Also if it tells you not to talk to the bureaus, or asks you to lie.",
        "If you see that, tell the FTC at ReportFraud.ftc.gov.",
      ],
    },
    sources: [SRC.ftcScams, SRC.ftcAllNegative, SRC.cfpbAccurate],
  },
];

export function getLesson(slug: string): Lesson | undefined {
  return LESSONS.find((l) => l.slug === slug);
}

/** A lesson as one text, for "Escuchar". */
export function lessonReadAloud(lesson: Lesson, locale: LessonLocale): string {
  return [`${lesson.title[locale]}.`, ...lesson.body[locale]].join(" ");
}

export const LESSON_WORD_LIMIT = 150;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** "22 de noviembre de 2026" / "November 22, 2026" for a YYYY-MM-DD day. */
export function checkedOnLabel(day: string, locale: LessonLocale): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
