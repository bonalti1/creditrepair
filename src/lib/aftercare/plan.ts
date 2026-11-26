import { utilization } from "../learn/calculators";
import type { ReportItem } from "../domain/types";
import type { AftercareSourceKey } from "./sources";

// "Build your credit" (/construir): a short checklist for every client, from
// day one, not only after disputes. Pure: the words, and the order and notes
// that come from the client's own report and goal.
//
// Rules (src/lib/__tests__/aftercare.test.ts):
//  - General information, labelled as such. Every line passes
//    checkClaimGuardrails and checkMarketingCopy, in English and Spanish.
//  - No promise about a score, no number of points, no date. We say why a
//    habit matters in plain words and what to do; the bureaus and lenders decide.
//  - Products are explained neutrally, with pros, cons and costs. None is
//    "recommended"; the partner offers below the plan are optional and ranked
//    by what they cost the client (offers.ts).
//  - Notes from the report state facts that are on it ("2 open cards"), never
//    what will happen to them.

export type L = "es" | "en";
type Bi = Record<L, string>;

export const PLAN_KEYS = ["on_time", "utilization", "oldest_open", "add_positive", "inquiries", "check_reports"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Home-ready milestones the client marks themselves (the others come from the case). */
export const HOME_MARK_KEYS = ["home_positive_accounts", "home_savings", "home_loan_officer"] as const;
export type HomeMarkKey = (typeof HOME_MARK_KEYS)[number];

/** Every "Mark as done" key. The same list as the check in migration 0030. */
export const AFTERCARE_MARK_KEYS = [...PLAN_KEYS, ...HOME_MARK_KEYS] as const;
export type AftercareMarkKey = (typeof AFTERCARE_MARK_KEYS)[number];

export function isMarkKey(key: string): key is AftercareMarkKey {
  return (AFTERCARE_MARK_KEYS as readonly string[]).includes(key);
}

export interface TradelineOption {
  key: "secured_card" | "credit_builder_loan" | "rent_utility" | "authorized_user";
  title: Bi;
  how: Bi;
  pros: Record<L, string[]>;
  cons: Record<L, string[]>;
  cost: Bi;
  /** What changes with an ITIN instead of an SSN. */
  itin: Bi;
}

export interface PlanItem {
  key: PlanKey;
  title: Bi;
  /** Why it matters, in plain words. */
  why: Bi;
  /** What to do: short steps. */
  steps: Record<L, string[]>;
  sources: AftercareSourceKey[];
  /** The Aprende tool this item leads to. */
  tool?: "utilizacion";
  /** The Aprende lesson that explains more. */
  lesson?: string;
  options?: TradelineOption[];
}

export const TRADELINE_OPTIONS: TradelineOption[] = [
  {
    key: "secured_card",
    title: { en: "Secured credit card", es: "Tarjeta de crédito asegurada" },
    how: {
      en: "You leave a cash deposit, and the deposit is usually your limit. You use it like any card and pay the bill.",
      es: "Dejas un depósito en efectivo, y casi siempre ese depósito es tu límite. La usas como cualquier tarjeta y pagas la cuenta.",
    },
    pros: {
      en: ["Many people can open one even with little or no history.", "Some let you move to a regular card later."],
      es: ["Mucha gente puede abrir una aunque tenga poco o nada de historial.", "Algunas te dejan pasar a una tarjeta normal después."],
    },
    cons: {
      en: ["Your deposit is tied up while the card is open.", "Not every card reports to all three bureaus. Ask before you apply."],
      es: ["Tu depósito queda apartado mientras la tarjeta está abierta.", "No todas reportan a los tres burós. Pregunta antes de pedirla."],
    },
    cost: {
      en: "A deposit you usually get back when you close it in good standing. Some charge an annual fee, and interest if you carry a balance.",
      es: "Un depósito que casi siempre te devuelven al cerrarla al corriente. Algunas cobran una cuota anual, e intereses si dejas saldo.",
    },
    itin: {
      en: "Some banks and credit unions accept an ITIN. Ask before you apply.",
      es: "Algunos bancos y cooperativas aceptan ITIN. Pregunta antes de pedirla.",
    },
  },
  {
    key: "credit_builder_loan",
    title: { en: "Credit-builder loan", es: "Préstamo para construir crédito" },
    how: {
      en: "The lender keeps a small loan in a locked account. You pay it in monthly parts, and you get the money at the end.",
      es: "El prestamista guarda un préstamo pequeño en una cuenta bloqueada. Lo pagas en partes cada mes, y recibes el dinero al final.",
    },
    pros: {
      en: ["Your payments are reported as a loan.", "You end with savings."],
      es: ["Tus pagos se reportan como un préstamo.", "Al final te queda un ahorro."],
    },
    cons: {
      en: ["A late payment is reported too.", "A CFPB study found it helped people with no other debt more than people already carrying debt."],
      es: ["Un pago tarde también se reporta.", "Un estudio de la CFPB encontró que ayudó más a quien no tenía otras deudas que a quien ya tenía deudas."],
    },
    cost: {
      en: "Usually interest and sometimes a fee. Ask for the total cost before you sign.",
      es: "Casi siempre intereses y a veces una cuota. Pide el costo total antes de firmar.",
    },
    itin: {
      en: "Many credit unions offer them. Some accept an ITIN.",
      es: "Muchas cooperativas de crédito los ofrecen. Algunas aceptan ITIN.",
    },
  },
  {
    key: "rent_utility",
    title: { en: "Rent and utility reporting", es: "Reporte de renta y servicios" },
    how: {
      en: "A service sends your rent or utility payments to one or more bureaus. Your landlord may already offer one.",
      es: "Un servicio manda tus pagos de renta o de luz y agua a uno o más burós. Tu arrendador quizá ya ofrece uno.",
    },
    pros: {
      en: ["It uses payments you already make.", "Some lenders also look at rent history."],
      es: ["Usa pagos que ya haces.", "Algunos prestamistas también miran tu historial de renta."],
    },
    cons: {
      en: ["Some report only to one bureau.", "Some also report late payments.", "Not every scoring model counts it."],
      es: ["Algunos reportan solo a un buró.", "Algunos también reportan pagos tarde.", "No todos los modelos de puntaje lo cuentan."],
    },
    cost: {
      en: "From no fee to a setup fee plus a monthly fee. Check before you sign up.",
      es: "Desde sin cuota hasta una cuota de inicio más una cuota mensual. Revísalo antes de inscribirte.",
    },
    itin: {
      en: "Ask the service which numbers it accepts.",
      es: "Pregúntale al servicio qué números acepta.",
    },
  },
  {
    key: "authorized_user",
    title: { en: "Authorized user", es: "Usuario autorizado" },
    how: {
      en: "Someone you trust adds you to their card. The account's history can show on your report.",
      es: "Alguien de confianza te agrega a su tarjeta. El historial de esa cuenta puede aparecer en tu reporte.",
    },
    pros: {
      en: ["No new loan for you.", "An older account with on-time payments can be part of your file."],
      es: ["No es un préstamo nuevo para ti.", "Una cuenta vieja con pagos a tiempo puede ser parte de tu expediente."],
    },
    cons: {
      en: [
        "Their late payments or high balance can show on your report too.",
        "Not every card issuer reports authorized users.",
        "Never pay a company to add you to a stranger's card.",
      ],
      es: [
        "Sus pagos tarde o un saldo alto también pueden aparecer en tu reporte.",
        "No todos los bancos reportan a los usuarios autorizados.",
        "Nunca le pagues a una empresa para que te agregue a la tarjeta de un desconocido.",
      ],
    },
    cost: {
      en: "Usually at no cost. Agree on the rules first: who spends and who pays.",
      es: "Casi siempre sin costo. Pónganse de acuerdo antes: quién gasta y quién paga.",
    },
    itin: {
      en: "The card issuer decides which details it needs to add you.",
      es: "El banco de la tarjeta decide qué datos necesita para agregarte.",
    },
  },
];

export const PLAN_ITEMS: PlanItem[] = [
  {
    key: "on_time",
    title: { en: "Pay every bill on time", es: "Paga cada cuenta a tiempo" },
    why: {
      en: "Your payment history shows, month by month, whether you paid on time. It is one of the things that counts most in common scores.",
      es: "Tu historial de pagos muestra, mes por mes, si pagaste a tiempo. Es de lo que más cuenta en los puntajes comunes.",
    },
    steps: {
      en: [
        "Turn on autopay for at least the minimum on each card and loan.",
        "Set a reminder a few days before each due date.",
        "If a payment will be late, call the lender before the due date and ask about your options.",
      ],
      es: [
        "Activa el pago automático de al menos el mínimo en cada tarjeta y préstamo.",
        "Pon un recordatorio unos días antes de cada fecha límite.",
        "Si un pago se va a atrasar, llama al prestamista antes de la fecha y pregunta tus opciones.",
      ],
    },
    sources: ["cfpbGoodScore"],
    lesson: "pagos",
  },
  {
    key: "utilization",
    title: { en: "Keep card balances low", es: "Mantén bajos los saldos de tus tarjetas" },
    why: {
      en: "Utilization is how much of your card limits you use. Many experts suggest under 30%, and lower is often better.",
      es: "La utilización es cuánto usas de los límites de tus tarjetas. Muchos expertos sugieren menos del 30%, y más bajo suele ser mejor.",
    },
    steps: {
      en: [
        "Use the calculator to see your number.",
        "Pay before the statement date, so a lower balance is reported.",
        "If you can, aim for under 10% on each card.",
      ],
      es: [
        "Usa la calculadora para ver tu número.",
        "Paga antes de la fecha de corte, así se reporta un saldo más bajo.",
        "Si puedes, busca usar menos del 10% en cada tarjeta.",
      ],
    },
    sources: ["cfpbGoodScore", "lowerUtilization"],
    tool: "utilizacion",
    lesson: "utilizacion",
  },
  {
    key: "oldest_open",
    title: { en: "Keep your oldest accounts open", es: "Mantén abiertas tus cuentas más viejas" },
    why: {
      en: "The age of your accounts is part of your history. Closing an old card can also lower your total limit.",
      es: "La edad de tus cuentas es parte de tu historial. Cerrar una tarjeta vieja también puede bajar tu límite total.",
    },
    steps: {
      en: [
        "Before you close a card, check how old it is and what its limit is.",
        "If it has no annual fee, a small charge you pay off each month keeps it in use.",
        "If it has a fee, ask the bank about a no-fee card instead of closing it.",
      ],
      es: [
        "Antes de cerrar una tarjeta, revisa qué tan vieja es y cuál es su límite.",
        "Si no cobra cuota anual, un cargo pequeño que pagas cada mes la mantiene en uso.",
        "Si cobra cuota, pregúntale al banco por una tarjeta sin cuota en vez de cerrarla.",
      ],
    },
    sources: ["cfpbGoodScore"],
  },
  {
    key: "add_positive",
    title: { en: "Add positive accounts, carefully", es: "Suma cuentas positivas, con cuidado" },
    why: {
      en: "A file with few accounts gives lenders little to look at. Each new account should be one you can pay on time.",
      es: "Un expediente con pocas cuentas les da a los prestamistas poco que mirar. Cada cuenta nueva debe ser una que puedas pagar a tiempo.",
    },
    steps: {
      en: [
        "Read the four options below, with their pros, cons and costs.",
        "Pick at most one at a time, and only if the cost fits your budget.",
        "Ask whether it reports to Equifax, Experian and TransUnion.",
      ],
      es: [
        "Lee las cuatro opciones de abajo, con sus pros, contras y costos.",
        "Elige como máximo una a la vez, y solo si el costo cabe en tu presupuesto.",
        "Pregunta si reporta a Equifax, Experian y TransUnion.",
      ],
    },
    sources: ["cfpbBuildCredit", "cfpbCreditBuilderLoans", "cfpbCreditVisible", "cfpbYmygCredit", "cfpbUtilityReporting"],
    options: TRADELINE_OPTIONS,
  },
  {
    key: "inquiries",
    title: { en: "Apply for new credit only when you need it", es: "Pide crédito nuevo solo cuando lo necesites" },
    why: {
      en: "Each application usually adds a hard inquiry, which other lenders can see for about two years.",
      es: "Cada solicitud casi siempre suma una consulta dura, que otros prestamistas pueden ver por unos dos años.",
    },
    steps: {
      en: [
        "Space out applications for new cards and loans.",
        "When you shop for a mortgage, compare lenders within 45 days: those checks count as one inquiry.",
        "Avoid new cards or a car loan while you apply for a mortgage.",
      ],
      es: [
        "Deja tiempo entre solicitudes de tarjetas y préstamos.",
        "Cuando compares hipotecas, hazlo en 45 días: esas consultas cuentan como una sola.",
        "Evita tarjetas nuevas o un préstamo de auto mientras pides una hipoteca.",
      ],
    },
    sources: ["cfpbInquiry", "cfpbMortgageInquiries"],
    lesson: "consultas",
  },
  {
    key: "check_reports",
    title: { en: "Check your reports regularly", es: "Revisa tus reportes seguido" },
    why: {
      en: "Mistakes happen. When you see your reports often, you can tell your team about anything that looks wrong.",
      es: "Los errores pasan. Si ves tus reportes seguido, puedes avisarle a tu equipo de algo que se vea mal.",
    },
    steps: {
      en: [
        "Weekly reports at no cost are at AnnualCreditReport.com, the only official site.",
        "With an ITIN, you ask each bureau by mail. See the ITIN guide.",
        "Look for accounts you do not know and inquiries you did not ask for.",
      ],
      es: [
        "Los reportes semanales sin costo están en AnnualCreditReport.com, el único sitio oficial.",
        "Con ITIN, los pides a cada buró por correo. Mira la guía para ITIN.",
        "Busca cuentas que no conoces y consultas que no pediste.",
      ],
    },
    sources: ["ftcWeekly", "experianItin"],
    lesson: "reporte",
  },
];

// ── Personalizing it from the client's own report ───────────────────────

export interface PlanInput {
  items: readonly ReportItem[];
  goal: string | null;
  idType: "ssn" | "itin" | null;
  now: Date;
}

export interface ReportFacts {
  openCards: number;
  cardBalance: number;
  cardLimit: number;
  /** Whole percent, or null with no open card limits. */
  utilizationPercent: number | null;
  openAccounts: number;
  oldestOpen: { name: string; openedAt: string } | null;
  /** Accounts with a late mark in the last 24 months. */
  accountsWithLates: number;
  /** Hard inquiries in the last 12 months. */
  recentHardInquiries: number;
}

const DAY = 24 * 60 * 60 * 1000;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const isClosed = (d: Record<string, unknown>) => Boolean(str(d.closedAt)) || /closed|cerrad|paid in full|transferred/i.test(`${str(d.status)} ${str(d.paymentStatus)}`);
const isCollection = (d: Record<string, unknown>) => /collection|cobranza|charge.?off/i.test(`${str(d.accountType)} ${str(d.status)} ${str(d.paymentStatus)}`);
const isCard = (d: Record<string, unknown>) => /card|revolving|tarjeta|line of credit/i.test(str(d.accountType)) && (num(d.creditLimit) ?? 0) > 0;

/** The same account at several bureaus counts once (creditor + masked number). */
const accountKey = (i: ReportItem) => `${i.name.trim().toLowerCase()}|${str((i.data as Record<string, unknown>).accountNumberMasked)}`;

export function reportFacts(items: readonly ReportItem[], now: Date): ReportFacts {
  const seen = new Set<string>();
  const accounts: Array<{ item: ReportItem; d: Record<string, unknown> }> = [];
  for (const item of items) {
    if (item.category !== "tradeline") continue;
    const key = accountKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ item, d: item.data as Record<string, unknown> });
  }
  const open = accounts.filter(({ d }) => !isClosed(d) && !isCollection(d));
  const cards = open.filter(({ d }) => isCard(d));
  const util = utilization(cards.map(({ d }) => ({ balance: num(d.balance) ?? 0, limit: num(d.creditLimit) ?? 0 })));
  const dated = open.filter(({ d }) => !Number.isNaN(Date.parse(str(d.openedAt)))).sort((a, b) => Date.parse(str(a.d.openedAt)) - Date.parse(str(b.d.openedAt)));
  const since24 = now.getTime() - 730 * DAY;
  const accountsWithLates = accounts.filter(({ d }) => {
    const history = Array.isArray(d.paymentHistory) ? (d.paymentHistory as Array<{ month?: string; status?: string }>) : [];
    return history.some((h) => /^\d+$/.test(String(h.status ?? "")) && Date.parse(`${h.month ?? ""}-01`) >= since24);
  }).length;
  const since12 = now.getTime() - 365 * DAY;
  const inquiries = new Set(
    items
      .filter((i) => i.category === "inquiry" && i.negative && Date.parse(str((i.data as Record<string, unknown>).date)) >= since12)
      .map((i) => `${i.name.toLowerCase()}|${str((i.data as Record<string, unknown>).date)}`),
  ).size;
  return {
    openCards: cards.length,
    cardBalance: util.totalBalance,
    cardLimit: util.totalLimit,
    utilizationPercent: util.percent,
    openAccounts: open.length,
    oldestOpen: dated[0] ? { name: dated[0].item.name, openedAt: str(dated[0].d.openedAt) } : null,
    accountsWithLates,
    recentHardInquiries: inquiries,
  };
}

export interface PersonalItem {
  item: PlanItem;
  /** One sentence from the client's own report or goal, or null. */
  note: string | null;
  /** Lower comes first. */
  rank: number;
}

const money = (n: number, locale: L) => `$${Math.round(n).toLocaleString(locale === "es" ? "es-MX" : "en-US")}`;
const monthYear = (iso: string, locale: L) =>
  new Date(iso).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A note from the report for one item: a fact on it, never what will happen. */
export function itemNote(key: PlanKey, facts: ReportFacts, input: Pick<PlanInput, "goal" | "idType">, locale: L): string | null {
  const es = locale === "es";
  switch (key) {
    case "on_time":
      if (facts.accountsWithLates === 0) return null;
      return es
        ? `Tu reporte muestra pagos tarde en ${facts.accountsWithLates === 1 ? "1 cuenta" : `${facts.accountsWithLates} cuentas`} en los últimos 2 años. Si alguno no es correcto, díselo a tu equipo.`
        : `Your report shows late payments on ${facts.accountsWithLates === 1 ? "1 account" : `${facts.accountsWithLates} accounts`} in the last 2 years. If one is not correct, tell your team.`;
    case "utilization":
      if (facts.openCards === 0 || facts.utilizationPercent === null) {
        return es ? "Tu reporte más reciente no muestra tarjetas abiertas con límite." : "Your latest report shows no open cards with a limit.";
      }
      return es
        ? `En tu reporte más reciente, tus tarjetas abiertas usan ${money(facts.cardBalance, locale)} de ${money(facts.cardLimit, locale)}: cerca del ${facts.utilizationPercent}%.`
        : `On your latest report, your open cards use ${money(facts.cardBalance, locale)} of ${money(facts.cardLimit, locale)}: about ${facts.utilizationPercent}%.`;
    case "oldest_open":
      if (!facts.oldestOpen) return null;
      return es
        ? `Tu cuenta abierta más vieja en tu reporte: ${facts.oldestOpen.name}, abierta en ${monthYear(facts.oldestOpen.openedAt, locale)}.`
        : `Your oldest open account on your report: ${facts.oldestOpen.name}, opened in ${monthYear(facts.oldestOpen.openedAt, locale)}.`;
    case "add_positive":
      if (facts.openAccounts === 0) {
        return es ? "Tu reporte no muestra cuentas abiertas todavía. Es común, y es un buen punto de partida." : "Your report shows no open accounts yet. That is common, and a good place to start.";
      }
      return es
        ? `Tu reporte muestra ${facts.openAccounts === 1 ? "1 cuenta abierta" : `${facts.openAccounts} cuentas abiertas`}.`
        : `Your report shows ${facts.openAccounts === 1 ? "1 open account" : `${facts.openAccounts} open accounts`}.`;
    case "inquiries": {
      const goalNote = input.goal === "mortgage" ? (es ? " Como tu meta es comprar casa, esto importa más." : " Since your goal is buying a home, this matters more.") : "";
      if (facts.recentHardInquiries === 0) return goalNote ? goalNote.trim() : null;
      return es
        ? `Tu reporte muestra ${facts.recentHardInquiries === 1 ? "1 consulta dura" : `${facts.recentHardInquiries} consultas duras`} en los últimos 12 meses.${goalNote}`
        : `Your report shows ${facts.recentHardInquiries === 1 ? "1 hard inquiry" : `${facts.recentHardInquiries} hard inquiries`} in the last 12 months.${goalNote}`;
    }
    case "check_reports":
      return input.idType === "itin"
        ? es
          ? "Con ITIN, AnnualCreditReport.com puede no funcionar en línea. La guía para ITIN explica cómo pedirlos por correo."
          : "With an ITIN, AnnualCreditReport.com may not work online. The ITIN guide explains how to ask by mail."
        : null;
  }
}

/** The client's plan: every item, the ones their report points to first. */
export function personalPlan(input: PlanInput, locale: L): { facts: ReportFacts; items: PersonalItem[] } {
  const facts = reportFacts(input.items, input.now);
  const base: Record<PlanKey, number> = { on_time: 10, utilization: 20, add_positive: 30, oldest_open: 40, inquiries: 50, check_reports: 60 };
  if (facts.accountsWithLates > 0) base.on_time = 1;
  if ((facts.utilizationPercent ?? 0) > 30) base.utilization = 2;
  if (facts.openAccounts < 3) base.add_positive = 3;
  if (input.goal === "mortgage") base.inquiries = Math.min(base.inquiries, 15);
  if (input.idType === "itin") base.check_reports = Math.min(base.check_reports, 25);
  const items = PLAN_ITEMS.map((item) => ({ item, note: itemNote(item.key, facts, input, locale), rank: base[item.key] })).sort((a, b) => a.rank - b.rank || PLAN_KEYS.indexOf(a.item.key) - PLAN_KEYS.indexOf(b.item.key));
  return { facts, items };
}

/** Every sentence a client can read in the plan, for the claim and plain-language tests. */
export function planCopy(locale: L): string[] {
  const out: string[] = [];
  for (const item of PLAN_ITEMS) {
    out.push(item.title[locale], item.why[locale], ...item.steps[locale]);
    for (const o of item.options ?? []) out.push(o.title[locale], o.how[locale], ...o.pros[locale], ...o.cons[locale], o.cost[locale], o.itin[locale]);
  }
  return out;
}

/** The newest mark per key wins: done or not, with when. */
export type MarkState = Partial<Record<AftercareMarkKey, { done: boolean; at: string }>>;

export function marksFromRows(rows: ReadonlyArray<{ item_key?: unknown; done?: unknown; created_at?: unknown; seq?: unknown }>): MarkState {
  const sorted = [...rows].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  const out: MarkState = {};
  for (const r of sorted) {
    const key = String(r.item_key);
    if (!isMarkKey(key)) continue;
    out[key] = { done: r.done === true, at: new Date(String(r.created_at)).toISOString() };
  }
  return out;
}
