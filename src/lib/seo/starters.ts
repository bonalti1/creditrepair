import type { Guide, GuideSource } from "./types";

// The starter guides: four drafts on real questions Texans search, in English
// and Spanish, shipped UNPUBLISHED. They are demo content in the demo and the
// first drafts on the database (the migration seeds nothing: an administrator
// adds them from «Guides» → «Add the starter drafts»). Before any is
// published a person opens every source, reads both languages and ticks the
// boxes; an administrator publishes (docs/SEO.md).
//
// How they were written: every statement of law cites the statute or the
// federal agency that says it (15 U.S.C. = the U.S. Code; Tex. Fin. Code =
// the Texas Finance Code). The timelines in FCRA § 611 were confirmed against
// search results from uscode.house.gov and govinfo.gov on 2026-11-25; the
// other citations follow the same sections docs/LEARN.md and docs/AGREEMENT.md
// use, which were checked the same way. The official pages could not be
// opened from the build machine, so the person's «I opened every source»
// tick is the real check. Amounts in § 605(b) are not quoted (no amounts in
// marketing copy); the guide says the section sets them.

const law = (title: number, section: string) => `https://www.law.cornell.edu/uscode/text/${title}/${section}`;

const S: Record<string, GuideSource> = {
  "fcra-611": { id: "fcra-611", label: "Fair Credit Reporting Act, procedure in case of disputed accuracy", cite: "15 U.S.C. § 1681i (FCRA § 611)", url: law(15, "1681i") },
  "fcra-605": { id: "fcra-605", label: "Fair Credit Reporting Act, requirements relating to information contained in consumer reports", cite: "15 U.S.C. § 1681c (FCRA § 605)", url: law(15, "1681c") },
  "fcra-623": { id: "fcra-623", label: "Fair Credit Reporting Act, responsibilities of furnishers of information", cite: "15 U.S.C. § 1681s-2 (FCRA § 623)", url: law(15, "1681s-2") },
  "reg-v": { id: "reg-v", label: "Regulation V, direct disputes with furnishers", cite: "12 C.F.R. § 1022.43", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1022/subpart-E/section-1022.43" },
  "croa-1679a": { id: "croa-1679a", label: "Credit Repair Organizations Act, findings, purposes and definitions", cite: "15 U.S.C. § 1679a", url: law(15, "1679a") },
  "croa-1679b": { id: "croa-1679b", label: "Credit Repair Organizations Act, prohibited practices", cite: "15 U.S.C. § 1679b", url: law(15, "1679b") },
  "croa-1679c": { id: "croa-1679c", label: "Credit Repair Organizations Act, disclosures", cite: "15 U.S.C. § 1679c", url: law(15, "1679c") },
  "croa-1679d": { id: "croa-1679d", label: "Credit Repair Organizations Act, contracts", cite: "15 U.S.C. § 1679d", url: law(15, "1679d") },
  "croa-1679e": { id: "croa-1679e", label: "Credit Repair Organizations Act, right to cancel", cite: "15 U.S.C. § 1679e", url: law(15, "1679e") },
  "croa-1679f": { id: "croa-1679f", label: "Credit Repair Organizations Act, noncompliance with the act", cite: "15 U.S.C. § 1679f", url: law(15, "1679f") },
  "croa-1679g": { id: "croa-1679g", label: "Credit Repair Organizations Act, civil liability", cite: "15 U.S.C. § 1679g", url: law(15, "1679g") },
  "tx-393": { id: "tx-393", label: "Texas Finance Code, chapter 393: credit services organizations", cite: "Tex. Fin. Code §§ 393.101, 393.105, 393.106, 393.201, 393.202, 393.401", url: "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.393.htm" },
  "ftc-study": { id: "ftc-study", label: "FTC: study of credit report accuracy, press release (2013)", cite: "FACTA § 319 study", url: "https://www.ftc.gov/news-events/news/press-releases/2013/02/ftc-study-five-percent-consumers-had-errors-their-credit-reports-could-result-less-favorable-terms" },
  "ftc-weekly": { id: "ftc-weekly", label: "FTC: your credit reports every week at AnnualCreditReport.com (2023)", cite: "", url: "https://consumer.ftc.gov/consumer-alerts/2023/10/you-now-have-permanent-access-free-weekly-credit-reports" },
  "ftc-disputes": { id: "ftc-disputes", label: "FTC: Disputing Errors on Your Credit Reports", cite: "", url: "https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports" },
  "ftc-furnishers": { id: "ftc-furnishers", label: "FTC: Consumer Reports, What Information Furnishers Need to Know", cite: "", url: "https://www.ftc.gov/business-guidance/resources/consumer-reports-what-information-furnishers-need-know" },
  "ftc-kosmerl": { id: "ftc-kosmerl", label: "FTC advisory opinion on the reporting period of paid collections (Kosmerl, 1999)", cite: "", url: "https://www.ftc.gov/legal-library/browse/advisory-opinions/advisory-opinion-kosmerl-06-04-99" },
  "ftc-scams": { id: "ftc-scams", label: "FTC consumer alert: spotting scams in credit services (2026)", cite: "", url: "https://consumer.ftc.gov/consumer-alerts/2026/01/spot-scams-when-fixing-your-credit" },
  "ftc-negative": { id: "ftc-negative", label: "FTC consumer alert on promises about negative information (2024)", cite: "", url: "https://consumer.ftc.gov/consumer-alerts/2024/08/only-scammers-say-theyll-remove-all-negative-information-your-credit-report" },
  "ftc-trick": { id: "ftc-trick", label: "FTC consumer alert on an illegal credit report trick (2026)", cite: "", url: "https://consumer.ftc.gov/consumer-alerts/2026/01/influencers-are-pushing-illegal-trick-fix-your-credit-report" },
  "cfpb-323": { id: "cfpb-323", label: "CFPB: How long does negative information remain on my credit report?", cite: "", url: "https://www.consumerfinance.gov/ask-cfpb/how-long-do-negative-information-remain-on-my-credit-report-en-323/" },
  "cfpb-accurate": { id: "cfpb-accurate", label: "CFPB: accurate negative information on a credit report", cite: "", url: "https://www.consumerfinance.gov/ask-cfpb/is-it-possible-to-remove-accurate-but-negative-information-from-my-credit-report-en-1249/" },
  "cfpb-complaint": { id: "cfpb-complaint", label: "CFPB: Submit a complaint", cite: "", url: "https://www.consumerfinance.gov/complaint/" },
};

const pick = (...ids: string[]) => ids.map((id) => S[id]!);

type Starter = Pick<Guide, "id" | "slug" | "topic" | "brief" | "phrase" | "body" | "sources">;

export const STARTER_GUIDES: readonly Starter[] = [
  // ── 1. Disputing an error ─────────────────────────────────────────────
  {
    id: "gd_starter_dispute",
    slug: "dispute-credit-report-error-texas",
    topic: "How to dispute an error on your credit report in Texas",
    brief: "For a Texan who found something wrong on a report. The steps, the bureau's deadlines under FCRA § 611, disputing with the furnisher, and what to do if it is not settled. Neutral: disputing is at no cost and can be done alone.",
    phrase: { en: "how to dispute an error on your credit report in Texas", es: "cómo disputar un error en tu reporte de crédito en Texas" },
    sources: pick("ftc-study", "ftc-weekly", "ftc-disputes", "fcra-611", "fcra-623", "reg-v", "cfpb-complaint", "cfpb-accurate", "croa-1679c"),
    body: {
      en: {
        title: "How to Dispute a Credit Report Error in Texas",
        description: "Texans have federal rights to dispute errors on a credit report at no cost. The steps, the deadlines and what to keep, in plain words.",
        intro:
          "Mistakes on credit reports happen. In a study for Congress, the FTC found that 1 in 5 people had an error on at least one of their three reports.[^ftc-study] If you live in Texas, federal law gives you the right to dispute what is wrong, and the bureau must look into it.[^fcra-611]",
        sections: [
          {
            heading: "Start with your three reports",
            paragraphs: [
              "You can get your reports from Equifax, Experian and TransUnion at no cost every week at [AnnualCreditReport.com](https://www.annualcreditreport.com).[^ftc-weekly] It is the site the FTC points to for this.[^ftc-weekly]",
              "Read every account, name and address. Note what you believe is wrong, and why. For example: an account that is not yours, a wrong balance or status, or a late payment you paid on time. You decide what is inaccurate.",
            ],
          },
          {
            heading: "Send your dispute to the bureau",
            paragraphs: [
              "Send your dispute to each bureau that shows the error, online, by mail or by phone.[^ftc-disputes] Say what is wrong, why, and what should change. Include copies of anything that supports you, never the originals.",
              "If you mail it, certified mail with a return receipt gives you proof of the date. Keep a copy of everything you send and everything you get back.[^ftc-disputes]",
            ],
          },
          {
            heading: "What the bureau must do, and by when",
            paragraphs: [
              "The bureau must investigate at no cost to you, usually within 30 days of receiving your dispute.[^fcra-611] That can grow by up to 15 days if you send more information during those 30 days.[^fcra-611]",
              "Within 5 business days, the bureau must pass your dispute to the company that reported the item.[^fcra-611] That company must investigate and report back to the bureau.[^fcra-623]",
              "If the item is inaccurate, incomplete or cannot be verified, the bureau must correct it or delete it.[^fcra-611] It must send you the results in writing within 5 business days after it finishes.[^fcra-611]",
              "A bureau may stop working on a dispute it considers frivolous, for example one with no information to look into. It must tell you within 5 business days, and say why.[^fcra-611]",
            ],
          },
          {
            heading: "Dispute with the company that reported it",
            paragraphs: [
              "You can also dispute in writing with the lender or collector that reported the information, at the address it gives for disputes.[^reg-v] In most cases it must investigate and answer within the same time a bureau has.[^reg-v]",
            ],
          },
          {
            heading: "If the answer does not settle it",
            paragraphs: [
              "You may ask the bureau to add a brief statement of the dispute to your file. Later reports show it, or a summary of it.[^fcra-611]",
              "You can send a complaint to the Consumer Financial Protection Bureau at [consumerfinance.gov/complaint](https://www.consumerfinance.gov/complaint/).[^cfpb-complaint] If you find new information, you can dispute again.",
              "A dispute is for errors. Accurate, current information can generally stay on a report for the time the law allows.[^cfpb-accurate]",
            ],
          },
          {
            heading: "On your own, or with a team",
            paragraphs: [
              "Disputing directly with the bureaus costs nothing, and you can do every step above yourself.[^croa-1679c][^fcra-611]",
              "Some people prefer a team to prepare and mail the letters for the items they say are wrong. If that is you, see [how Credalti works](/como-funciona) and [how our pricing works](/precios). Results vary, and the bureaus decide.",
            ],
          },
        ],
        faq: [
          { q: "Does it cost anything to dispute with a credit bureau?", a: "No. The bureau must investigate your dispute at no cost to you.[^fcra-611]" },
          { q: "How long does a credit bureau have to answer?", a: "Usually 30 days from receiving your dispute, or up to 45 days if you send more information during that time.[^fcra-611]" },
          { q: "Can I dispute an item that is accurate?", a: "A dispute is for information you believe is inaccurate or incomplete. Accurate, current information can generally stay on your report.[^cfpb-accurate]" },
          { q: "Should I dispute online or by mail?", a: "Either way works.[^ftc-disputes] Mail gives you a paper trail: keep copies and the date you sent it." },
        ],
      },
      es: {
        title: "Cómo disputar un error en tu reporte de crédito en Texas",
        description: "En Texas tienes derechos federales para disputar errores en tu reporte de crédito sin costo. Los pasos, los plazos y qué guardar, en palabras sencillas.",
        intro:
          "Los errores en los reportes de crédito pasan. En un estudio para el Congreso, la FTC encontró que 1 de cada 5 personas tenía un error en alguno de sus tres reportes.[^ftc-study] Si vives en Texas, la ley federal te da el derecho de disputar lo que está mal, y el buró debe investigarlo.[^fcra-611]",
        sections: [
          {
            heading: "Empieza por tus tres reportes",
            paragraphs: [
              "Puedes obtener tus reportes de Equifax, Experian y TransUnion sin costo cada semana en [AnnualCreditReport.com](https://www.annualcreditreport.com).[^ftc-weekly] Es el sitio que indica la FTC para esto.[^ftc-weekly]",
              "Lee cada cuenta, nombre y dirección. Anota lo que crees que está mal, y por qué. Por ejemplo: una cuenta que no es tuya, un saldo o estado incorrecto, o un pago tarde que pagaste a tiempo. Tú decides qué es inexacto.",
            ],
          },
          {
            heading: "Manda tu disputa al buró",
            paragraphs: [
              "Manda tu disputa a cada buró que muestre el error, por internet, por correo o por teléfono.[^ftc-disputes] Di qué está mal, por qué, y qué debe cambiar. Incluye copias de lo que te respalde, nunca los originales.",
              "Si la mandas por correo, el correo certificado con acuse de recibo te da prueba de la fecha. Guarda una copia de todo lo que mandes y de todo lo que te respondan.[^ftc-disputes]",
            ],
          },
          {
            heading: "Lo que debe hacer el buró, y en qué plazo",
            paragraphs: [
              "El buró debe investigar sin costo para ti, por lo general dentro de 30 días desde que recibe tu disputa.[^fcra-611] El plazo puede crecer hasta 15 días si mandas más información durante esos 30 días.[^fcra-611]",
              "Dentro de 5 días hábiles, el buró debe pasar tu disputa a la empresa que reportó el dato.[^fcra-611] Esa empresa debe investigar y responderle al buró.[^fcra-623]",
              "Si el dato es inexacto, está incompleto o no se puede verificar, el buró debe corregirlo o quitarlo.[^fcra-611] Debe mandarte el resultado por escrito dentro de 5 días hábiles después de terminar.[^fcra-611]",
              "Un buró puede dejar de trabajar una disputa que considere sin fundamento, por ejemplo una sin información que investigar. Debe avisarte dentro de 5 días hábiles, y decirte por qué.[^fcra-611]",
            ],
          },
          {
            heading: "Disputa con la empresa que lo reportó",
            paragraphs: [
              "También puedes disputar por escrito con el prestamista o el cobrador que reportó el dato, en la dirección que da para disputas.[^reg-v] En la mayoría de los casos debe investigar y responder en el mismo plazo que tiene un buró.[^reg-v]",
            ],
          },
          {
            heading: "Si la respuesta no lo resuelve",
            paragraphs: [
              "Puedes pedirle al buró que agregue a tu expediente una declaración breve sobre la disputa. Los reportes siguientes la muestran, o un resumen de ella.[^fcra-611]",
              "Puedes mandar una queja a la Oficina para la Protección Financiera del Consumidor (CFPB) en [consumerfinance.gov/complaint](https://www.consumerfinance.gov/complaint/).[^cfpb-complaint] Si encuentras información nueva, puedes disputar otra vez.",
              "Una disputa es para errores. La información correcta y vigente por lo general puede quedarse en un reporte el tiempo que permite la ley.[^cfpb-accurate]",
            ],
          },
          {
            heading: "Por tu cuenta, o con un equipo",
            paragraphs: [
              "Disputar directamente con los burós no cuesta nada, y puedes hacer tú mismo cada paso de arriba.[^croa-1679c][^fcra-611]",
              "Algunas personas prefieren que un equipo prepare y envíe las cartas por lo que ellas dicen que está mal. Si es tu caso, mira [cómo funciona Credalti](/como-funciona) y [cómo funcionan nuestros precios](/precios). Los resultados varían, y deciden los burós.",
            ],
          },
        ],
        faq: [
          { q: "¿Cuesta algo disputar con un buró de crédito?", a: "No. El buró debe investigar tu disputa sin costo para ti.[^fcra-611]" },
          { q: "¿Cuánto tiempo tiene un buró para responder?", a: "Por lo general 30 días desde que recibe tu disputa, o hasta 45 días si mandas más información en ese tiempo.[^fcra-611]" },
          { q: "¿Puedo disputar un dato que es correcto?", a: "Una disputa es para información que crees que es inexacta o está incompleta. La información correcta y vigente por lo general puede quedarse en tu reporte.[^cfpb-accurate]" },
          { q: "¿Disputo por internet o por correo?", a: "Las dos formas sirven.[^ftc-disputes] El correo te deja un registro en papel: guarda copias y la fecha en que lo mandaste." },
        ],
      },
    },
  },

  // ── 2. Texas credit services organizations ───────────────────────────
  {
    id: "gd_starter_texas_cso",
    slug: "texas-credit-services-organization-law",
    topic: "What a credit services organization must give you under Texas law",
    brief: "For a Texan comparing companies. Texas Finance Code chapter 393 (registration, bond, the disclosure statement, the contract, cancelling) and the federal CROA rules on top. How to check a company. No claim about Credalti's own registration.",
    phrase: { en: "Texas credit services organization law", es: "ley de organizaciones de servicios de crédito en Texas" },
    sources: pick("tx-393", "croa-1679b", "croa-1679c", "croa-1679d", "croa-1679e", "cfpb-accurate", "ftc-scams", "fcra-611"),
    body: {
      en: {
        title: "Texas Credit Services Organization Law: Your Rights",
        description: "Before a credit services company in Texas signs you up or takes payment, state and federal law say what it must give you. Here is the list.",
        intro:
          "In Texas, a company that helps with your credit for a fee is usually a credit services organization. Chapter 393 of the Texas Finance Code covers it.[^tx-393] A federal law, the Credit Repair Organizations Act, adds its own rules.[^croa-1679b] Knowing both helps you spot a company that follows them.",
        sections: [
          {
            heading: "Registered with the state, with a bond",
            paragraphs: [
              "A credit services organization must register with the Texas Secretary of State before it does business.[^tx-393] It must also keep a surety bond or a surety account, and file a copy with the Secretary of State.[^tx-393]",
              "The bond is there so that a client who is harmed can make a claim against it.[^tx-393] You can ask any company for its registration and the name of its surety.",
            ],
          },
          {
            heading: "A disclosure statement before you sign or pay",
            paragraphs: [
              "Before you sign a contract or pay anything, the company must give you a written statement.[^tx-393] It describes the services in detail, with their total cost, and explains your right to make a claim against the bond.[^tx-393]",
              "It also covers your right to review your credit file and to dispute errors directly with a bureau. It says when old information can no longer be reported, and where to find nonprofit credit counseling.[^tx-393]",
              "The company must keep a copy of that statement, signed by you, for two years.[^tx-393] Federal law adds a separate statement of your rights, «Consumer Credit File Rights Under State and Federal Law», which must also come before any contract.[^croa-1679c]",
            ],
          },
          {
            heading: "A written contract you can cancel",
            paragraphs: [
              "The contract must be in writing, dated and signed by you, with the payment terms, including the total you would pay.[^tx-393][^croa-1679d] It must describe the services in detail and give the company's name and principal business address.[^croa-1679d]",
              "Under federal law you may cancel without penalty before midnight of the third business day after you sign.[^croa-1679e] Texas law also requires two copies of a cancellation notice with the contract.[^tx-393]",
              "Under the Texas notice, any payment you made must be returned within 10 days after the company receives your cancellation.[^tx-393]",
            ],
          },
          {
            heading: "No payment before the work is done",
            paragraphs: [
              "Federal law says a credit repair organization may not charge or receive money for a service before that service is fully performed.[^croa-1679b]",
              "It may not make false or misleading statements about your credit, or advise you to change your identification to hide your credit record.[^croa-1679b]",
              "No company can legally have accurate, current information taken off your report.[^cfpb-accurate] A promise to do that is a warning sign.[^ftc-scams]",
            ],
          },
          {
            heading: "How Credalti handles these rules",
            paragraphs: [
              "Credalti works in Texas. You get the disclosures before you sign, and the contract shows how every charge works. With Credalti Complete, you're charged each month right after your letters are mailed, never before. Credalti DIY is a simple monthly subscription, charged after your 3 business days to cancel.[^croa-1679e] See [how it works](/como-funciona) and [how pricing works](/precios).",
              "You can still dispute errors with the bureaus on your own, at no cost.[^fcra-611] Results vary, and the bureaus decide.",
            ],
          },
        ],
        faq: [
          { q: "Does a credit services organization in Texas need a bond?", a: "Yes. It must keep a surety bond or a surety account and file a copy with the Texas Secretary of State.[^tx-393]" },
          { q: "Can a credit repair company charge me before doing the work?", a: "Federal law says it may not charge for a service before that service is fully performed.[^croa-1679b]" },
          { q: "How long do I have to cancel?", a: "Under federal law, until midnight of the third business day after you sign, without penalty.[^croa-1679e]" },
          { q: "Can I do this myself?", a: "Yes. You can dispute errors directly with the credit bureaus at no cost.[^fcra-611]" },
        ],
      },
      es: {
        title: "Ley de organizaciones de servicios de crédito en Texas",
        description: "Antes de que una empresa de servicios de crédito en Texas te inscriba o te cobre, la ley dice qué debe darte. Aquí está la lista.",
        intro:
          "En Texas, una empresa que te ayuda con tu crédito a cambio de un pago suele ser una organización de servicios de crédito. La regula el capítulo 393 del Código de Finanzas de Texas.[^tx-393] Una ley federal, la Ley de Organizaciones de Reparación de Crédito (CROA), agrega sus propias reglas.[^croa-1679b] Conocer las dos te ayuda a reconocer a una empresa que las cumple.",
        sections: [
          {
            heading: "Registrada en el estado, con una fianza",
            paragraphs: [
              "Una organización de servicios de crédito debe registrarse con la Secretaría de Estado de Texas antes de operar.[^tx-393] También debe tener una fianza o una cuenta de garantía, y presentar una copia ante la Secretaría de Estado.[^tx-393]",
              "La fianza existe para que un cliente perjudicado pueda reclamar contra ella.[^tx-393] Puedes pedirle a cualquier empresa su registro y el nombre de su afianzadora.",
            ],
          },
          {
            heading: "Una declaración antes de firmar o pagar",
            paragraphs: [
              "Antes de que firmes un contrato o pagues algo, la empresa debe darte una declaración por escrito.[^tx-393] Describe los servicios en detalle, con su costo total, y explica tu derecho a reclamar contra la fianza.[^tx-393]",
              "También explica tu derecho a revisar tu expediente de crédito y a disputar errores directamente con un buró. Dice cuándo la información vieja ya no se puede reportar, y dónde encontrar asesoría de crédito sin fines de lucro.[^tx-393]",
              "La empresa debe guardar una copia de esa declaración, firmada por ti, durante dos años.[^tx-393] La ley federal agrega otra declaración de tus derechos, «Consumer Credit File Rights Under State and Federal Law». También debe llegar antes de cualquier contrato.[^croa-1679c]",
            ],
          },
          {
            heading: "Un contrato por escrito que puedes cancelar",
            paragraphs: [
              "El contrato debe estar por escrito, con fecha y firmado por ti, con las condiciones de pago, incluido el total que pagarías.[^tx-393][^croa-1679d] Debe describir los servicios en detalle y dar el nombre y el domicilio principal de la empresa.[^croa-1679d]",
              "Según la ley federal puedes cancelar sin penalidad antes de la medianoche del tercer día hábil después de firmar.[^croa-1679e] La ley de Texas también exige dos copias de un aviso de cancelación junto con el contrato.[^tx-393]",
              "Según el aviso de Texas, lo que hayas pagado debe devolverse dentro de 10 días después de que la empresa reciba tu cancelación.[^tx-393]",
            ],
          },
          {
            heading: "Ningún cobro antes de hacer el trabajo",
            paragraphs: [
              "Según la ley federal, una empresa de reparación de crédito no puede cobrar por un servicio antes de haberlo hecho por completo.[^croa-1679b]",
              "No puede hacer declaraciones falsas o engañosas sobre tu crédito, ni aconsejarte cambiar tu identificación para ocultar tu historial.[^croa-1679b]",
              "Ninguna empresa puede legalmente hacer que se quite de tu reporte información correcta y vigente.[^cfpb-accurate] Prometer eso es una señal de alerta.[^ftc-scams]",
            ],
          },
          {
            heading: "Cómo cumple Credalti estas reglas",
            paragraphs: [
              "Credalti trabaja en Texas. Recibes las declaraciones antes de firmar y el contrato muestra cómo funciona cada cobro. Con Credalti Complete, se cobra cada mes justo después de enviar tus cartas, nunca antes. Credalti DIY es una suscripción mensual sencilla, que se cobra después de tus 3 días hábiles para cancelar.[^croa-1679e] Mira [cómo funciona](/como-funciona) y [cómo funcionan los precios](/precios).",
              "Aun así, puedes disputar errores con los burós por tu cuenta, sin costo.[^fcra-611] Los resultados varían, y deciden los burós.",
            ],
          },
        ],
        faq: [
          { q: "¿Una organización de servicios de crédito en Texas necesita una fianza?", a: "Sí. Debe tener una fianza o una cuenta de garantía y presentar una copia ante la Secretaría de Estado de Texas.[^tx-393]" },
          { q: "¿Una empresa de reparación de crédito me puede cobrar antes de hacer el trabajo?", a: "La ley federal dice que no puede cobrar por un servicio antes de haberlo hecho por completo.[^croa-1679b]" },
          { q: "¿Cuánto tiempo tengo para cancelar?", a: "Según la ley federal, hasta la medianoche del tercer día hábil después de firmar, sin penalidad.[^croa-1679e]" },
          { q: "¿Puedo hacerlo yo mismo?", a: "Sí. Puedes disputar errores directamente con los burós de crédito sin costo.[^fcra-611]" },
        ],
      },
    },
  },

  // ── 3. How long items stay ────────────────────────────────────────────
  {
    id: "gd_starter_how_long",
    slug: "how-long-items-stay-on-credit-report",
    topic: "How long items stay on a credit report under FCRA § 605",
    brief: "For someone with an old late payment or collection. The § 605 periods (7 years, 10 for bankruptcy, the 180-day rule for collections), what does not restart them, the § 605(b) exceptions without amounts, and checking the dates. Links to the calculator on /preguntas.",
    phrase: { en: "how long do negative items stay on your credit report", es: "cuánto duran los datos negativos en el reporte de crédito" },
    sources: pick("fcra-605", "cfpb-323", "ftc-furnishers", "ftc-kosmerl", "cfpb-accurate", "fcra-611", "ftc-weekly"),
    body: {
      en: {
        title: "How Long Negative Items Stay on Your Credit Report",
        description: "Under the FCRA, most negative items can be reported for seven years and bankruptcies for ten. How the clock works, and what does not restart it.",
        intro:
          "A federal law, the Fair Credit Reporting Act, sets how long negative information can be reported. The limits are in section 605 of that law.[^fcra-605] Here is how they work, in plain words.",
        sections: [
          {
            heading: "Seven years for most negative items",
            paragraphs: [
              "Late payments, accounts sent to collection, charged-off accounts and most other negative items can be reported for seven years.[^fcra-605][^cfpb-323]",
              "For a collection or a charge-off, the seven years start 180 days after the first missed payment that led to it.[^fcra-605] That date is the date of first delinquency, not the date a collector bought the debt.[^ftc-furnishers]",
            ],
          },
          {
            heading: "Ten years for bankruptcies",
            paragraphs: [
              "A bankruptcy can be reported for up to ten years from the date of the order for relief or the adjudication.[^fcra-605]",
              "Civil suits and judgments can be reported for seven years, or until the time limit to collect them runs out, whichever is longer.[^fcra-605]",
            ],
          },
          {
            heading: "What does not restart the clock",
            paragraphs: [
              "Paying a collection, settling it or having it sold to another collector does not restart the seven years.[^ftc-kosmerl][^fcra-605]",
              "A paid account can still show for the rest of its period, marked as paid. Accurate information can generally stay until its time is up.[^cfpb-accurate]",
              "If a collector reports a later date of first delinquency than the real one, that is an error you can dispute.[^fcra-611][^ftc-furnishers]",
            ],
          },
          {
            heading: "When the limits do not apply",
            paragraphs: [
              "The time limits do not apply to some reports used for large loans, large life insurance policies and some higher-paying jobs. Section 605(b) sets the amounts.[^fcra-605]",
              "Section 605 limits negative items. It sets no time limit for accurate positive information, such as an account paid on time.[^fcra-605]",
            ],
          },
          {
            heading: "Check the dates on your own report",
            paragraphs: [
              "Get your three reports at no cost every week at [AnnualCreditReport.com](https://www.annualcreditreport.com).[^ftc-weekly] Look at each negative item's dates. If an item is older than the law allows, you can dispute it with the bureau.[^fcra-611]",
              "The calculator «How long can this stay?» on our [questions page](/preguntas) does the arithmetic. If you want a team to prepare and mail letters for what you say is wrong, see [how it works](/como-funciona) and [pricing](/precios). Results vary.",
            ],
          },
        ],
        faq: [
          { q: "Does paying a collection restart the seven years?", a: "No. Paying, settling or selling the debt does not change the date the period started.[^ftc-kosmerl]" },
          { q: "How long can a bankruptcy stay on my report?", a: "Up to ten years from the date of the order for relief or the adjudication.[^fcra-605]" },
          { q: "Can a company take an accurate late payment off my report early?", a: "No one can make a bureau stop reporting accurate, current information. A bureau may stop sooner on its own, but nobody can promise it.[^cfpb-accurate]" },
        ],
      },
      es: {
        title: "Cuánto duran los datos negativos en tu reporte de crédito",
        description: "Según la FCRA, la mayoría de los datos negativos se pueden reportar siete años y las bancarrotas diez. Cómo corre el plazo, y qué no lo reinicia.",
        intro:
          "Una ley federal, la Ley de Informe Justo de Crédito (FCRA), fija cuánto tiempo se puede reportar la información negativa. Los límites están en la sección 605 de esa ley.[^fcra-605] Así funcionan, en palabras sencillas.",
        sections: [
          {
            heading: "Siete años para la mayoría de los datos negativos",
            paragraphs: [
              "Los pagos tarde, las cobranzas, las cuentas canceladas como pérdida y casi todos los demás datos negativos se pueden reportar siete años.[^fcra-605][^cfpb-323]",
              "En una cobranza o una cuenta cancelada como pérdida, los siete años empiezan 180 días después del primer pago atrasado que llevó a ella.[^fcra-605] Esa fecha es la del primer atraso, no la fecha en que un cobrador compró la deuda.[^ftc-furnishers]",
            ],
          },
          {
            heading: "Diez años para las bancarrotas",
            paragraphs: [
              "Una bancarrota se puede reportar hasta diez años desde la fecha de la orden de protección o de la declaración judicial.[^fcra-605]",
              "Las demandas civiles y las sentencias se pueden reportar siete años, o hasta que venza el plazo para cobrarlas, lo que sea más largo.[^fcra-605]",
            ],
          },
          {
            heading: "Lo que no reinicia el plazo",
            paragraphs: [
              "Pagar una cobranza, llegar a un acuerdo o que la vendan a otro cobrador no reinicia los siete años.[^ftc-kosmerl][^fcra-605]",
              "Una cuenta pagada puede seguir apareciendo el resto de su plazo, marcada como pagada. La información correcta por lo general puede quedarse hasta que se cumpla su tiempo.[^cfpb-accurate]",
              "Si un cobrador reporta una fecha de primer atraso más reciente que la real, es un error que puedes disputar.[^fcra-611][^ftc-furnishers]",
            ],
          },
          {
            heading: "Cuándo no aplican los límites",
            paragraphs: [
              "Los límites de tiempo no aplican a algunos reportes para préstamos grandes, pólizas de seguro de vida grandes y algunos empleos con salario alto. La sección 605(b) fija los montos.[^fcra-605]",
              "La sección 605 limita los datos negativos. No pone límite de tiempo a la información positiva correcta, como una cuenta pagada a tiempo.[^fcra-605]",
            ],
          },
          {
            heading: "Revisa las fechas en tu propio reporte",
            paragraphs: [
              "Obtén tus tres reportes sin costo cada semana en [AnnualCreditReport.com](https://www.annualcreditreport.com).[^ftc-weekly] Mira las fechas de cada dato negativo. Si un dato es más viejo de lo que permite la ley, puedes disputarlo con el buró.[^fcra-611]",
              "La calculadora «¿Hasta cuándo se puede reportar?» en nuestra [página de preguntas](/preguntas) hace la cuenta. Si quieres que un equipo prepare y envíe cartas por lo que tú dices que está mal, mira [cómo funciona](/como-funciona) y [los precios](/precios). Los resultados varían.",
            ],
          },
        ],
        faq: [
          { q: "¿Pagar una cobranza reinicia los siete años?", a: "No. Pagar, llegar a un acuerdo o que vendan la deuda no cambia la fecha en que empezó el plazo.[^ftc-kosmerl]" },
          { q: "¿Cuánto tiempo puede quedarse una bancarrota en mi reporte?", a: "Hasta diez años desde la fecha de la orden de protección o de la declaración judicial.[^fcra-605]" },
          { q: "¿Una empresa puede quitar antes de tiempo un pago tarde correcto?", a: "Nadie puede obligar a un buró a dejar de reportar información correcta y vigente. Un buró puede dejar de hacerlo antes por su cuenta, pero nadie lo puede prometer.[^cfpb-accurate]" },
        ],
      },
    },
  },

  // ── 4. What a credit repair company can and cannot do ────────────────
  {
    id: "gd_starter_croa",
    slug: "what-credit-repair-company-can-do",
    topic: "What a credit repair company can and cannot do under the CROA",
    brief: "For someone deciding whether to hire help. The Credit Repair Organizations Act: no charge before the work, no false statements, the disclosure and contract, 3 business days to cancel, no waiver, the right to sue, and the FTC's warning signs.",
    phrase: { en: "what a credit repair company can and cannot do", es: "qué puede hacer una empresa de reparación de crédito" },
    sources: pick("croa-1679a", "tx-393", "croa-1679b", "croa-1679c", "cfpb-accurate", "croa-1679d", "croa-1679e", "croa-1679f", "croa-1679g", "cfpb-complaint", "ftc-scams", "ftc-negative", "ftc-trick", "fcra-611"),
    body: {
      en: {
        title: "What a Credit Repair Company Can and Cannot Do",
        description: "The Credit Repair Organizations Act sets what these companies may promise, when they may charge and how you can cancel. The rules, in plain words.",
        intro:
          "A credit repair company is one that offers, for a fee, to help with your credit record. A federal law, the Credit Repair Organizations Act, sets rules for all of them.[^croa-1679a] In Texas, state law adds its own rules on registration, a bond and the disclosures.[^tx-393]",
        sections: [
          {
            heading: "What it cannot do",
            paragraphs: [
              "It cannot charge you for a service before that service is fully performed.[^croa-1679b]",
              "It cannot make false or misleading statements about your credit to a bureau or a lender, or advise you to.[^croa-1679b] It cannot suggest changing your identification to hide your credit record.[^croa-1679b]",
              "No company can legally have accurate, current and verifiable information taken off your report.[^croa-1679c][^cfpb-accurate]",
            ],
          },
          {
            heading: "What it must give you",
            paragraphs: [
              "Before any contract, it must give you a written statement of your rights, separate from the contract. Its title is «Consumer Credit File Rights Under State and Federal Law».[^croa-1679c]",
              "The contract must be in writing and signed by you. It must show the total you would pay, describe the services in detail and estimate how long they will take.[^croa-1679d]",
              "It must include a notice of cancellation form. You may cancel without penalty before midnight of the third business day after you sign.[^croa-1679e]",
            ],
          },
          {
            heading: "Your rights if it breaks the rules",
            paragraphs: [
              "You cannot give up these protections. A waiver is void and cannot be enforced against you.[^croa-1679f]",
              "If a company breaks the law, you can sue it for your losses or what you paid. A court may also add damages and your lawyer's fees.[^croa-1679g]",
              "You can also send a complaint to the [Consumer Financial Protection Bureau](https://www.consumerfinance.gov/complaint/).[^cfpb-complaint]",
            ],
          },
          {
            heading: "Warning signs",
            paragraphs: [
              "The FTC's warning signs include asking for payment before doing any work, and promising to take accurate negative information off your report.[^ftc-scams][^ftc-negative]",
              "Disputing information you know is accurate, or falsely claiming identity theft to hide it, is against the law.[^ftc-trick] A company that suggests it is not looking out for you.",
            ],
          },
          {
            heading: "On your own, or with Credalti",
            paragraphs: [
              "You can dispute errors directly with the bureaus at no cost.[^fcra-611] Would you rather have a team prepare and mail the letters for what you say is wrong? See [how Credalti works](/como-funciona) and [how pricing works](/precios).",
              "With Credalti Complete, you're charged each month right after your letters are mailed, never before, and you can end the service any time. Results vary, and the bureaus decide.",
            ],
          },
        ],
        faq: [
          { q: "Can a credit repair company charge in advance?", a: "Not for a service it has not fully performed yet.[^croa-1679b]" },
          { q: "Can a company promise to take negative items off my report?", a: "It cannot promise to have accurate, current information taken off. A bureau must correct or delete only information that is inaccurate, incomplete or cannot be verified.[^croa-1679c][^fcra-611]" },
          { q: "How do I cancel a contract?", a: "Send the notice of cancellation, or any written notice, before midnight of the third business day after you signed.[^croa-1679e]" },
        ],
      },
      es: {
        title: "Qué puede hacer una empresa de reparación de crédito",
        description: "La ley federal CROA fija qué pueden prometer estas empresas, cuándo pueden cobrar y cómo puedes cancelar. Las reglas, en palabras sencillas.",
        intro:
          "Una empresa de reparación de crédito es una que ofrece, a cambio de un pago, ayudarte con tu historial de crédito. Una ley federal, la Ley de Organizaciones de Reparación de Crédito (CROA), fija reglas para todas.[^croa-1679a] En Texas, la ley estatal agrega sus propias reglas sobre el registro, una fianza y las declaraciones.[^tx-393]",
        sections: [
          {
            heading: "Lo que no puede hacer",
            paragraphs: [
              "No puede cobrarte por un servicio antes de haberlo hecho por completo.[^croa-1679b]",
              "No puede hacer declaraciones falsas o engañosas sobre tu crédito a un buró o a un prestamista, ni aconsejarte hacerlas.[^croa-1679b] No puede sugerirte cambiar tu identificación para ocultar tu historial.[^croa-1679b]",
              "Ninguna empresa puede legalmente hacer que se quite de tu reporte información correcta, vigente y verificable.[^croa-1679c][^cfpb-accurate]",
            ],
          },
          {
            heading: "Lo que debe darte",
            paragraphs: [
              "Antes de cualquier contrato, debe darte por escrito una declaración de tus derechos, aparte del contrato. Su título es «Consumer Credit File Rights Under State and Federal Law».[^croa-1679c]",
              "El contrato debe estar por escrito y firmado por ti. Debe mostrar el total que pagarías, describir los servicios en detalle y estimar cuánto tiempo tomarán.[^croa-1679d]",
              "Debe incluir un formulario de aviso de cancelación. Puedes cancelar sin penalidad antes de la medianoche del tercer día hábil después de firmar.[^croa-1679e]",
            ],
          },
          {
            heading: "Tus derechos si no cumple",
            paragraphs: [
              "No puedes renunciar a estas protecciones. Una renuncia no vale y no se puede hacer cumplir contra ti.[^croa-1679f]",
              "Si una empresa no cumple la ley, puedes demandarla por tus pérdidas o por lo que pagaste. Un tribunal también puede agregar daños y los honorarios de tu abogado.[^croa-1679g]",
              "También puedes mandar una queja a la [Oficina para la Protección Financiera del Consumidor (CFPB)](https://www.consumerfinance.gov/complaint/).[^cfpb-complaint]",
            ],
          },
          {
            heading: "Señales de alerta",
            paragraphs: [
              "La FTC da señales de alerta: pedir un pago antes de hacer cualquier trabajo, o prometer quitar de tu reporte información negativa correcta.[^ftc-scams][^ftc-negative]",
              "Disputar información que sabes que es correcta, o decir falsamente que fuiste víctima de robo de identidad para ocultarla, va contra la ley.[^ftc-trick] Una empresa que lo sugiere no está cuidando de ti.",
            ],
          },
          {
            heading: "Por tu cuenta, o con Credalti",
            paragraphs: [
              "Puedes disputar errores directamente con los burós sin costo.[^fcra-611] ¿Prefieres que un equipo prepare y envíe las cartas por lo que tú dices que está mal? Mira [cómo funciona Credalti](/como-funciona) y [cómo funcionan los precios](/precios).",
              "Con Credalti Complete, se cobra cada mes justo después de enviar tus cartas, nunca antes, y puedes terminar el servicio cuando quieras. Los resultados varían, y deciden los burós.",
            ],
          },
        ],
        faq: [
          { q: "¿Una empresa de reparación de crédito puede cobrar por adelantado?", a: "No por un servicio que todavía no ha hecho por completo.[^croa-1679b]" },
          { q: "¿Una empresa puede prometer quitar datos negativos de mi reporte?", a: "No puede prometer que se quite información correcta y vigente. Un buró debe corregir o quitar solo la información inexacta, incompleta o que no se puede verificar.[^croa-1679c][^fcra-611]" },
          { q: "¿Cómo cancelo un contrato?", a: "Manda el aviso de cancelación, o cualquier aviso por escrito, antes de la medianoche del tercer día hábil después de haber firmado.[^croa-1679e]" },
        ],
      },
    },
  },
];

/** The starters as guides: drafts by the system, unpublished. The second waits for approval in the demo, so the flow can be tried. */
export function starterGuides(now: Date, by = "credalti"): Guide[] {
  const at = now.toISOString();
  return STARTER_GUIDES.map((s, i) => ({
    ...s,
    status: i === 1 ? "review" : "draft",
    checklist: {},
    aiDraft: false,
    approval: null,
    published: null,
    changesNote: null,
    createdBy: by,
    createdAt: at,
    updatedAt: at,
    sample: true,
  }));
}

/** Topics worth a guide, for «content gaps» when no guide covers them yet. Texas and federal only. */
export const GUIDE_TOPICS: ReadonlyArray<{ topic: string; phrase: { en: string; es: string } }> = [
  { topic: "How to read your credit report, line by line", phrase: { en: "how to read a credit report", es: "cómo leer un reporte de crédito" } },
  { topic: "Identity theft: the report, the fraud alert and the freeze", phrase: { en: "identity theft credit report steps", es: "robo de identidad reporte de crédito pasos" } },
  { topic: "Building credit with an ITIN in Texas", phrase: { en: "build credit with ITIN Texas", es: "crédito con ITIN en Texas" } },
  { topic: "Hard and soft credit inquiries", phrase: { en: "hard vs soft credit inquiry", es: "consulta de crédito dura y suave" } },
  { topic: "Collections: the original creditor and the collector", phrase: { en: "collection account on credit report", es: "cuenta en cobranza en el reporte de crédito" } },
];
