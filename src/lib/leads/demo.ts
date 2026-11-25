import { BRAND } from "../brand";
import { LEAD_GREETINGS } from "../integrations/whatsapp";
import { composeAutoReply, labelled } from "./autopilot";

const FAQ_QUESTION = "Hello, how long do the bureaus take to answer?";
import type { Lead, LeadAutoMessage, LeadMessage, LeadNote, LeadStageEvent, LeadThread } from "./types";

// DEMO DATA. Nobody here exists. Eleven invented leads, from every way in:
// WhatsApp, HighLevel forms, a referral partner, the chat signup, by hand.
// Times are relative to `now`, so the demo always looks like today. The
// phone numbers are 555 numbers.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface DemoLead {
  lead: Lead;
  messages: LeadMessage[];
  notes: LeadNote[];
  stageEvents: LeadStageEvent[];
  autoMessages: LeadAutoMessage[];
}

const base = (over: Partial<Lead> & Pick<Lead, "id" | "phone" | "source" | "createdAt">): Lead => ({
  name: null,
  locale: null,
  firstTouch: {},
  prospectId: null,
  salesperson: null,
  assignedAt: null,
  stage: "new",
  stageAt: null,
  invitedAt: null,
  signedAt: null,
  clientUserId: null,
  lastInboundAt: null,
  lastReplyAt: null,
  lastHumanAt: null,
  firstHumanReplyAt: null,
  lastMessage: null,
  optedOutAt: null,
  ...over,
});

/** Fills the lead's message facts from its conversation, as the database triggers do. */
function withFacts(entry: DemoLead): DemoLead {
  const { lead, messages } = entry;
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const inbound = sorted.filter((m) => m.role === "user");
  const replies = sorted.filter((m) => m.role === "assistant" && (m.source === "coach" || m.source === "human"));
  const human = sorted.filter((m) => m.role === "assistant" && m.source === "human");
  const last = sorted[sorted.length - 1];
  return {
    ...entry,
    messages: sorted,
    lead: {
      ...lead,
      lastInboundAt: inbound[inbound.length - 1]?.at ?? null,
      lastReplyAt: replies[replies.length - 1]?.at ?? null,
      lastHumanAt: human[human.length - 1]?.at ?? null,
      firstHumanReplyAt: human[0]?.at ?? null,
      lastMessage: last
        ? { at: last.at, role: last.role, source: last.source === "highlevel" ? "human" : last.source, excerpt: last.text.replace(/\s+/g, " ").slice(0, 160) }
        : null,
    },
  };
}

export function buildDemoLeadRecords(now: Date): DemoLead[] {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const msg = (id: string, ago: number, role: LeadMessage["role"], source: LeadMessage["source"], text: string, authorName?: string): LeadMessage => ({
    id,
    at: at(ago),
    role,
    source,
    text,
    ...(authorName ? { authorName } : {}),
  });
  const greeting = (id: string, ago: number, locale: "en" | "es") => msg(id, ago, "assistant", "journey", LEAD_GREETINGS[locale]);
  // The autopilot's real answer to the question, from the website's FAQ.
  const auto = composeAutoReply(FAQ_QUESTION, { firstAnswer: false, locale: "en", sendSignupLink: true, appUrl: "https://credalti.com", salesperson: "luis" });
  const faqReply = "body" in auto ? auto.body : labelled(LEAD_GREETINGS.en, "en");

  const leads: DemoLead[] = [
    {
      lead: base({ id: "lead-rosa", phone: "+17135550141", name: "Rosa Elena Gutiérrez", locale: "es", source: "whatsapp", createdAt: at(40 * MIN), firstTouch: { channel: "whatsapp" }, salesperson: "ana", assignedAt: at(39 * MIN), state: "TX" }),
      messages: [
        msg("rosa-1", 40 * MIN, "user", "journey", "Hola, vi su anuncio en Facebook. ¿Cómo funciona?"),
        greeting("rosa-2", 40 * MIN - 5_000, "es"),
        msg("rosa-3", 26 * MIN, "user", "journey", "Vivo en Houston y quiero comprar casa el próximo año. ¿Me pueden ayudar a revisar mi reporte?"),
      ],
      notes: [],
      stageEvents: [],
      autoMessages: [],
    },
    {
      lead: base({
        id: "lead-marcus",
        phone: "+17135550152",
        name: "Marcus Bell",
        locale: "en",
        source: "highlevel",
        createdAt: at(2 * DAY + 3 * HOUR),
        firstTouch: { campaign: "Home buyers Nov", utm: { source: "facebook", campaign: "home-buyers-nov" } },
        prospectId: "p-marcus",
        salesperson: "ana",
        assignedAt: at(2 * DAY + 3 * HOUR),
        stage: "contacted",
        stageAt: at(2 * DAY),
        goal: "mortgage",
        state: "TX",
        highlevelContactId: "hlDemo0152",
      }),
      messages: [
        msg("marcus-1", 2 * DAY + 2 * HOUR, "user", "journey", "Hi, I filled out your form. I want to buy a house next year."),
        msg("marcus-2", 2 * DAY + 1 * HOUR, "assistant", "human", "Hi Marcus, I'm Ana from Credalti. Thanks for writing! I can explain how we work: you review your report and tell us what looks inaccurate, and our team prepares and mails the dispute letters. Which state do you live in?", "Ana"),
        msg("marcus-3", 2 * DAY + 50 * MIN, "user", "journey", "Texas, in Katy."),
        msg("marcus-4", 2 * DAY + 20 * MIN, "assistant", "human", "Great, we work in Texas. The plan is explained in the agreement before you sign, and you have 3 business days to cancel. Want me to send you the link to start?", "Ana"),
        msg("marcus-5", 2 * HOUR + 10 * MIN, "user", "journey", "Yes please. Also, do I need to pay for the credit monitoring separately?"),
      ],
      notes: [{ id: "n-marcus-1", at: at(2 * DAY), author: "ana", text: "Wants to buy in Katy next spring. Asked about monitoring." }],
      stageEvents: [{ id: "se-marcus-1", at: at(2 * DAY), from: "new", to: "contacted", by: "ana" }],
      autoMessages: [],
    },
    {
      lead: base({
        id: "lead-daniela",
        phone: "+12815550163",
        name: "Daniela Ortiz",
        locale: "es",
        source: "partner",
        createdAt: at(4 * DAY),
        firstTouch: { partnerId: "p-laura", partnerName: "Laura Benítez", partnerCode: "laura-benitez" },
        prospectId: "p-daniela",
        salesperson: "ana",
        assignedAt: at(4 * DAY),
        stage: "qualified",
        stageAt: at(DAY + 4 * HOUR),
        invitedAt: at(20 * HOUR),
        goal: "mortgage",
        state: "TX",
      }),
      messages: [
        msg("dan-1", 3 * DAY + 20 * HOUR, "assistant", "human", "Hola Daniela, soy Ana de Credalti. Laura Benítez nos pasó tu contacto. ¿Te puedo explicar cómo trabajamos?", "Ana"),
        msg("dan-2", 3 * DAY + 18 * HOUR, "user", "journey", "Sí, claro. Laura me dijo que ustedes ayudan con el reporte antes de pedir la hipoteca."),
        msg("dan-3", 3 * DAY + 17 * HOUR, "assistant", "human", "Así es: tú revisas tu reporte y nos dices qué está inexacto; nosotros preparamos y enviamos las cartas. Los burós deciden el resultado. ¿Vives en Texas?", "Ana"),
        msg("dan-4", DAY + 5 * HOUR, "user", "journey", "Sí, en Sugar Land. Me interesa empezar."),
        msg("dan-5", 20 * HOUR, "assistant", "human", "¡Perfecto! Te mando tu enlace personal para empezar. Lees el acuerdo con calma antes de firmar.", "Ana"),
      ],
      notes: [{ id: "n-dan-1", at: at(DAY + 4 * HOUR), author: "ana", text: "Referida por Laura. Quiere hipoteca en primavera." }],
      stageEvents: [
        { id: "se-dan-1", at: at(3 * DAY + 20 * HOUR), from: "new", to: "contacted", by: "ana" },
        { id: "se-dan-2", at: at(DAY + 4 * HOUR), from: "contacted", to: "qualified", by: "ana" },
      ],
      autoMessages: [],
    },
    {
      lead: base({ id: "lead-210", phone: "+12105550178", source: "whatsapp", createdAt: at(18 * MIN), firstTouch: { channel: "whatsapp" }, state: null }),
      messages: [msg("210-1", 18 * MIN, "user", "journey", "Hi is this the credit repair? How much is it per month?"), greeting("210-2", 18 * MIN - 4_000, "en")],
      notes: [],
      stageEvents: [],
      autoMessages: [{ id: "am-210", at: at(15 * MIN), kind: "handoff", status: "handed_off", reason: "billing", body: null }],
    },
    {
      lead: base({
        id: "lead-james",
        phone: "+18325550184",
        name: "James Carter",
        locale: "en",
        source: "signup_chat",
        createdAt: at(5 * HOUR),
        firstTouch: { caseRef: "CR-7KQ4M" },
        salesperson: "luis",
        assignedAt: at(5 * HOUR),
        clientUserId: "u-james",
        signup: { caseRef: "CR-7KQ4M", step: "identity", wantsPerson: true },
        state: "TX",
      }),
      messages: [msg("james-1", 3 * HOUR, "user", "journey", "Hi, I started signing up with Alti (CR-7KQ4M) and I'd like to talk to someone before I upload my ID.")],
      notes: [],
      stageEvents: [],
      autoMessages: [{ id: "am-james", at: at(3 * HOUR - 2 * MIN), kind: "handoff", status: "handed_off", reason: "wants_person", body: null }],
    },
    {
      lead: base({
        id: "lead-lucia",
        phone: "+17135550195",
        name: "Lucía Ramos",
        locale: "es",
        source: "highlevel",
        createdAt: at(9 * DAY),
        firstTouch: { campaign: "Casa propia oct" },
        prospectId: "p-lucia",
        salesperson: "luis",
        assignedAt: at(9 * DAY),
        stage: "qualified",
        stageAt: at(7 * DAY),
        invitedAt: at(6 * DAY),
        signedAt: at(3 * DAY),
        clientUserId: "u-lucia",
        state: "TX",
      }),
      messages: [
        msg("lucia-1", 9 * DAY, "user", "journey", "Hola, llené el formulario de casa propia."),
        msg("lucia-2", 9 * DAY - 25 * MIN, "assistant", "human", "Hola Lucía, soy Luis de Credalti. ¡Gracias por escribir! ¿Te explico cómo trabajamos?", "Luis"),
        msg("lucia-3", 6 * DAY + 2 * HOUR, "user", "journey", "Ya entendí, quiero empezar."),
        msg("lucia-4", 6 * DAY, "assistant", "human", "Te mando tu enlace. Lee el acuerdo con calma.", "Luis"),
      ],
      notes: [],
      stageEvents: [
        { id: "se-lucia-1", at: at(8 * DAY), from: "new", to: "contacted", by: "luis" },
        { id: "se-lucia-2", at: at(7 * DAY), from: "contacted", to: "qualified", by: "luis" },
      ],
      autoMessages: [],
    },
    {
      lead: base({ id: "lead-pedro", phone: "+19565550113", name: "Pedro Salas", locale: "es", source: "manual", createdAt: at(12 * DAY), prospectId: "p-pedro", salesperson: "luis", assignedAt: at(12 * DAY), stage: "closed_lost", stageAt: at(5 * DAY), state: "TX" }),
      messages: [
        msg("pedro-1", 12 * DAY - HOUR, "assistant", "human", "Hola Pedro, soy Luis de Credalti. Me pasaron tu número en el evento del sábado. ¿Te explico cómo trabajamos?", "Luis"),
        msg("pedro-2", 11 * DAY, "user", "journey", "Ahorita no tengo tiempo, luego te escribo."),
      ],
      notes: [{ id: "n-pedro-1", at: at(5 * DAY), author: "luis", text: "Sin respuesta en una semana. Cerrado." }],
      stageEvents: [{ id: "se-pedro-1", at: at(5 * DAY), from: "contacted", to: "closed_lost", by: "luis" }],
      autoMessages: [],
    },
    {
      lead: base({ id: "lead-kevin", phone: "+12145550126", name: "Kevin Nguyen", locale: "en", source: "highlevel", createdAt: at(6 * DAY), firstTouch: { campaign: "Credit builder Nov" }, prospectId: "p-kevin", salesperson: "ana", assignedAt: at(6 * DAY), stage: "not_interested", stageAt: at(4 * DAY), state: "TX" }),
      messages: [
        msg("kevin-1", 6 * DAY - 30 * MIN, "user", "journey", "Hi, I got your form link."),
        msg("kevin-2", 6 * DAY - 70 * MIN, "assistant", "human", "Hi Kevin, I'm Ana from Credalti. Happy to explain how the service works. What's your goal?", "Ana"),
        msg("kevin-3", 4 * DAY + HOUR, "user", "journey", "I decided to wait for now, thanks."),
      ],
      notes: [],
      stageEvents: [{ id: "se-kevin-1", at: at(4 * DAY), from: "contacted", to: "not_interested", by: "ana" }],
      autoMessages: [],
    },
    {
      lead: base({ id: "lead-teresa", phone: "+17135550137", name: "Teresa Villa", locale: "es", source: "whatsapp", createdAt: at(DAY + 6 * HOUR), salesperson: "ana", assignedAt: at(DAY + 6 * HOUR), stage: "contacted", stageAt: at(DAY + 5 * HOUR), state: "TX" }),
      messages: [
        msg("teresa-1", DAY + 6 * HOUR, "user", "journey", "Buenas, ¿ustedes ayudan con el crédito?"),
        greeting("teresa-2", DAY + 6 * HOUR - 5_000, "es"),
        msg("teresa-3", DAY + 5 * HOUR, "assistant", "human", "Hola Teresa, soy Ana de Credalti. Sí: revisas tu reporte con nosotros y preparamos las cartas de lo que tú digas que está inexacto. ¿En qué estado vives?", "Ana"),
        msg("teresa-4", 55 * MIN, "user", "journey", "Ya me escribieron tres personas distintas y nadie me contesta lo que pregunté. Esto es muy molesto."),
      ],
      notes: [],
      stageEvents: [{ id: "se-teresa-1", at: at(DAY + 5 * HOUR), from: "new", to: "contacted", by: "ana" }],
      autoMessages: [{ id: "am-teresa", at: at(52 * MIN), kind: "handoff", status: "handed_off", reason: "complaint", body: null }],
    },
    {
      lead: base({ id: "lead-angela", phone: "+13465550149", name: "Angela Moore", locale: "en", source: "highlevel", createdAt: at(70 * MIN), firstTouch: { campaign: "Credit builder Nov", utm: { source: "instagram" } }, prospectId: "p-angela", salesperson: "luis", assignedAt: at(70 * MIN), goal: "card", state: "TX" }),
      messages: [],
      notes: [],
      stageEvents: [],
      autoMessages: [],
    },
    {
      lead: base({ id: "lead-faq", phone: "+12815550190", name: null, locale: "en", source: "whatsapp", createdAt: at(DAY + 2 * HOUR), salesperson: "luis", assignedAt: at(DAY + 2 * HOUR), state: null }),
      messages: [
        msg("faq-1", DAY + 2 * HOUR, "user", "journey", FAQ_QUESTION),
        msg("faq-2", DAY + 2 * HOUR - 3 * MIN, "assistant", "coach", faqReply),
        msg("faq-3", DAY + HOUR, "assistant", "human", `Hi! I'm Luis from ${BRAND.name}. Happy to answer anything else. What would you like to work on?`, "Luis"),
      ],
      notes: [],
      stageEvents: [],
      autoMessages: [{ id: "am-faq", at: at(DAY + 2 * HOUR - 3 * MIN), kind: "faq", status: "sent", reason: null, body: "" }],
    },
  ];
  return leads.map(withFacts).map((entry) => ({
    ...entry,
    autoMessages: entry.autoMessages.map((m) => (m.body === "" ? { ...m, body: entry.messages.find((x) => x.source === "coach")?.text ?? null } : m)),
    lead: { ...entry.lead, handoff: latestHandoff(entry) },
  }));
}

/** The newest hand-off nobody answered after. */
function latestHandoff(entry: Pick<DemoLead, "autoMessages" | "lead">): Lead["handoff"] {
  const handoff = [...entry.autoMessages].reverse().find((m) => m.kind === "handoff");
  if (!handoff || !handoff.reason) return null;
  if (entry.lead.lastHumanAt && entry.lead.lastHumanAt >= handoff.at) return null;
  return { at: handoff.at, reason: handoff.reason as NonNullable<Lead["handoff"]>["reason"] };
}

export function buildDemoLeads(now: Date): Lead[] {
  return buildDemoLeadRecords(now).map((e) => e.lead);
}

export function buildDemoThread(now: Date, id: string): LeadThread | null {
  const entry = buildDemoLeadRecords(now).find((e) => e.lead.id === id);
  return entry ? { lead: entry.lead, messages: entry.messages, notes: entry.notes, stageEvents: entry.stageEvents, autoMessages: entry.autoMessages, external: null } : null;
}

export { latestHandoff, withFacts };
export type { DemoLead };
