import { BRAND } from "../brand";

// What the client reads in onboarding about adding a household member. Plain
// facts about the process: no promise, no price (the discount is described,
// never quoted: the amount is in the plan the client reads before signing).

export const HOUSEHOLD_COPY = {
  en: {
    title: "Anyone at home joining too?",
    lead: `Your spouse, partner or a family member can sign up with ${BRAND.name} too, with an account of their own. If your plan has a household discount, it applies to both of you.`,
    private: "Nothing of yours is shared with them, and nothing of theirs with you: each person has their own login, agreement, report and decisions.",
    add: "Add a household member",
    notNow: "Not now",
    firstName: "Their first name",
    lastName: "Their last name",
    phone: "Their mobile number",
    phoneHint: "Their own number: it's how they get their invite and sign in.",
    email: "Their email (optional)",
    relationship: "Relationship",
    language: "Their language",
    english: "English",
    spanish: "Spanish",
    save: "Add them",
    doneTitle: (name: string) => `${name} has their own invite`,
    doneBody: "Send it to them now, or later. Our team also has it. They'll sign up on their own, at their own pace.",
    send: "Send their invite on WhatsApp",
    continue: "Continue",
  },
  es: {
    title: "¿Alguien de tu hogar se une también?",
    lead: `Tu cónyuge, tu pareja o un familiar también puede registrarse en ${BRAND.name}, con su propia cuenta. Si tu plan tiene descuento de hogar, aplica para los dos.`,
    private: "Nada de lo tuyo se comparte con esa persona, ni nada de lo suyo contigo: cada quien tiene su propio acceso, acuerdo, reporte y decisiones.",
    add: "Agregar a alguien de mi hogar",
    notNow: "Ahora no",
    firstName: "Su nombre",
    lastName: "Su apellido",
    phone: "Su celular",
    phoneHint: "Su propio número: así recibe su invitación y entra a su cuenta.",
    email: "Su correo (opcional)",
    relationship: "Relación",
    language: "Su idioma",
    english: "Inglés",
    spanish: "Español",
    save: "Agregar",
    doneTitle: (name: string) => `${name} ya tiene su propia invitación`,
    doneBody: "Mándasela ahora o después. Nuestro equipo también la tiene. Se registra por su cuenta, a su ritmo.",
    send: "Enviar su invitación por WhatsApp",
    continue: "Continuar",
  },
} as const;

/** Where a household member added before sign-in waits on the device until OnboardingSync sends it. */
export const PENDING_HOUSEHOLD_KEY = "bonalti.householdMember";
