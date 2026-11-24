import { sha256Hex } from "../agreement/sha256";
import { BRAND } from "../brand";
import { partnerDisplay } from "../partners/sharing";
import type { PartnerKind } from "../partners/rules";

// "Connect me with a loan officer": the client asks to be introduced.
//
// Who: the partner who referred the client, when that partner is a loan
// officer or a real estate agent; otherwise a partner loan officer an
// administrator marked as accepting new clients (partners.accepting_clients,
// migration 0030), chosen by the client from a list sorted by name.
//
// With consent and a disclosure: the client reads exactly what is sent (their
// name, phone and goal, nothing from the credit file), that Credalti is not a
// lender, that they do not have to use this loan officer, and whether Credalti
// is paid for the introduction (it is not: partner commissions are off until
// the attorney approves, docs/PARTNERS.md). The text is versioned and hashed
// like the sharing consent; the server recomputes the hash.

export type L = "es" | "en";

export const INTRO_CONSENT_VERSION = "2026-11-presentacion-v1";

export interface IntroPartner {
  id: string;
  name: string;
  company: string | null;
  kind: PartnerKind;
}

export type IntroHow = "referred" | "accepting";

export interface IntroText {
  lead: string;
  sends: string[];
  disclosure: string[];
}

export function introText(partner: Pick<IntroPartner, "name" | "company">, locale: L): IntroText {
  const who = partnerDisplay(partner);
  if (locale === "es") {
    return {
      lead: `Le pediremos a ${who} que te contacte.`,
      sends: ["Tu nombre, tu teléfono y tu meta (comprar casa).", "Nada de tu reporte, tus puntajes, tus cuentas ni tus documentos."],
      disclosure: [
        `${BRAND.name} no es un prestamista y no decide ni ofrece préstamos.`,
        `No tienes que usar a este oficial de préstamos. Puedes comparar con otros prestamistas cuando quieras.`,
        `${BRAND.name} no recibe ningún pago por esta presentación.`,
        "Puedes retirar esta solicitud en cualquier momento desde esta pantalla.",
      ],
    };
  }
  return {
    lead: `We will ask ${who} to contact you.`,
    sends: ["Your name, your phone number and your goal (buying a home).", "Nothing from your report, your scores, your accounts or your documents."],
    disclosure: [
      `${BRAND.name} is not a lender and does not decide or offer loans.`,
      "You do not have to use this loan officer. You can compare other lenders whenever you want.",
      `${BRAND.name} is not paid for this introduction.`,
      "You can withdraw this request at any time from this screen.",
    ],
  };
}

export function introPlainText(partner: Pick<IntroPartner, "name" | "company">, locale: L): string {
  const t = introText(partner, locale);
  const heads = locale === "es" ? ["Se envía:", "Aviso:"] : ["What is sent:", "Disclosure:"];
  return [t.lead, heads[0], ...t.sends.map((x) => `- ${x}`), heads[1], ...t.disclosure.map((x) => `- ${x}`)].join("\n");
}

export function introHash(partner: Pick<IntroPartner, "name" | "company">, locale: L, version: string = INTRO_CONSENT_VERSION): string {
  return sha256Hex([`version: ${version}`, `locale: ${locale}`, introPlainText(partner, locale)].join("\n\n"));
}

/** May this partner be offered for an introduction, and how? */
export function introRoute(
  referring: (IntroPartner & { status?: string }) | null,
  accepting: readonly IntroPartner[],
): { how: IntroHow; partners: IntroPartner[] } {
  if (referring && (referring.status === undefined || referring.status === "approved") && (referring.kind === "loan_officer" || referring.kind === "realtor")) {
    return { how: "referred", partners: [referring] };
  }
  return { how: "accepting", partners: [...accepting].filter((p) => p.kind === "loan_officer").sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)) };
}

// ── The demo: which invented loan officers accept new clients ───────────

const DEMO_ACCEPTING_KEY = "credalti.demoAccepting.v1";

export function readDemoAccepting(): string[] {
  try {
    const raw = window.localStorage.getItem(DEMO_ACCEPTING_KEY);
    if (raw) return (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string");
  } catch {
    // ignore
  }
  return ["p-jorge"];
}

export function writeDemoAccepting(ids: string[]): void {
  try {
    window.localStorage.setItem(DEMO_ACCEPTING_KEY, JSON.stringify(ids));
  } catch {
    // Kept for this visit only.
  }
}

/** Every sentence of the introduction, for the tests. */
export function introCopy(locale: L): string[] {
  const t = introText({ name: "María López", company: "ABC Lending" }, locale);
  return [t.lead, ...t.sends, ...t.disclosure];
}
