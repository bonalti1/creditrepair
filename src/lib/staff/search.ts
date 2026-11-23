import { LETTER_CATALOGUE } from "../letters/library";
import { SHELL_TEXT } from "./i18n/ui/shell";
import { MORE_NAV, PRIMARY_NAV } from "./nav";
import { can, visibleClients, type Capability, type Viewer } from "./permissions";
import type { StaffClient } from "./types";

// The console's search (Ctrl/Cmd+K, the box in the header, and «Buscar» in the
// phone's «Más» sheet; Credit Repair Cloud added the same on Sep 11, 2026).
// Type a page, a client's name or phone, a referral partner, a letter
// template or something to do ("send rounds", "import report"), and jump.
//
// Role scope: a client is found only when this member may see them, through
// the same rule the clients list uses (visibleClients: an administrator
// everyone, a specialist their assigned clients, sales the people they
// brought in). With a database the list itself comes from the member's own
// connection, so row level security has already left the others out. A page,
// partner, template or action is found only when the role may open it.
//
// Both languages match, whatever the console's language: "enviar rondas" and
// "send rounds" find the same thing. Accents and case do not matter. Pure.

export type SearchKind = "action" | "page" | "client" | "partner" | "letter";

export interface SearchEntry {
  id: string;
  kind: SearchKind;
  /** In the console's language. */
  label: string;
  detail: string | null;
  href: string;
  /** Normalized words and phrases it is found by (both languages). */
  terms: string[];
  /** Digits of a phone number, matched by digits only. */
  phoneDigits?: string;
}

export interface SearchResult extends SearchEntry {
  score: number;
}

export interface SearchSources {
  viewer: Viewer | null;
  locale: "es" | "en";
  /** Every client loaded for this member (the list is filtered again here by role). */
  clients: ReadonlyArray<Pick<StaffClient, "id" | "firstName" | "lastName" | "phone" | "assignedTo" | "salesperson" | "email" | "state">>;
  /** Referral partners this member may read (empty for a role that may not). */
  partners?: ReadonlyArray<{ id: string; name: string; company: string | null; phone?: string | null }>;
}

/** Lowercase, no accents, single spaces: "Rondas Enviadas" → "rondas enviadas". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PAGE_TERMS: Record<string, string> = {
  home: "inicio work queue cola trabajo hoy today dashboard",
  clients: "clientes client list lista leads prospectos",
  answers: "respuestas preguntas questions saved answers mensajes messages",
  invite: "invitar invitacion enlace link sales ventas",
  creditors: "acreedores furnishers address book direcciones collectors cobradores",
  activity: "actividad who did what quien hizo log",
  autopilot: "piloto automatico autopilot followups recordatorios",
  business: "negocio numeros business metrics dashboard",
  partners: "socios partners referrals referidos",
  team: "equipo team members roles miembros",
  letters: "cartas letters templates plantillas library biblioteca",
  plans: "planes plans billing cobros tarjetas cards household hogar",
  invoices: "facturas invoices cobros payments pagos chargebacks",
  profile: "perfil profile language idioma resumen summary",
  welcome: "bienvenida welcome tour guia",
};

interface ActionDef {
  id: string;
  en: string;
  es: string;
  detailEn: string;
  detailEs: string;
  href: string;
  needs?: Capability;
  terms: string;
}

const ACTIONS: ActionDef[] = [
  { id: "send-rounds", en: "Send rounds", es: "Enviar rondas", detailEn: "Letters ready to mail", detailEs: "Cartas listas para enviar", href: "/equipo/enviar", needs: "rounds.send", terms: "mail mandar send rounds enviar rondas cartas letters" },
  { id: "print-letters", en: "Print letters", es: "Imprimir cartas", detailEn: "Print a batch in the office", detailEs: "Imprimir un lote en la oficina", href: "/equipo/imprimir", needs: "rounds.send", terms: "print imprimir batch lote" },
  { id: "import-report", en: "Import report", es: "Importar reporte", detailEn: "Pick the client, then “Import report”", detailEs: "Elige al cliente y luego «Importar reporte»", href: "/equipo/clientes", needs: "reports.import", terms: "import importar report reporte credit pdf upload subir" },
  { id: "add-client", en: "Add client", es: "Agregar cliente", detailEn: "A lead added by hand, with their invite", detailEs: "Un prospecto a mano, con su invitación", href: "/equipo/clientes?agregar=1", needs: "clients.add", terms: "add agregar new nuevo client cliente lead prospecto" },
  { id: "invite", en: "Invite a client", es: "Invitar a un cliente", detailEn: "Their link and message", detailEs: "Su enlace y mensaje", href: "/equipo/invitar", needs: "clients.invite", terms: "invite invitar link enlace whatsapp household hogar" },
  { id: "answer", en: "Answer questions", es: "Responder preguntas", detailEn: "Questions waiting for a person", detailEs: "Preguntas que esperan a una persona", href: "/equipo/respuestas", needs: "clients.reply", terms: "answer responder reply questions preguntas" },
  { id: "new-plan", en: "New plan", es: "Nuevo plan", detailEn: "A billing plan draft", detailEs: "Un borrador de plan de cobro", href: "/equipo/planes?nuevo=1", needs: "billing.plans", terms: "new nuevo plan billing cobro" },
  { id: "card-brands", en: "Accepted cards", es: "Tarjetas aceptadas", detailEn: "Visa, Mastercard, Amex, Discover", detailEs: "Visa, Mastercard, Amex, Discover", href: "/equipo/planes#tarjetas", needs: "billing.plans", terms: "cards tarjetas amex discover visa mastercard brands marcas" },
];

/** Everything this member may find, in their language. */
export function searchIndex(sources: SearchSources): SearchEntry[] {
  const { viewer, locale } = sources;
  const role = viewer?.role;
  const entries: SearchEntry[] = [];
  const es = locale === "es";

  for (const action of ACTIONS) {
    if (action.needs && !can(role, action.needs)) continue;
    entries.push({
      id: `action:${action.id}`,
      kind: "action",
      label: es ? action.es : action.en,
      detail: es ? action.detailEs : action.detailEn,
      href: action.href,
      terms: [normalize(action.en), normalize(action.es), normalize(action.terms)],
    });
  }

  for (const item of [...PRIMARY_NAV, ...MORE_NAV]) {
    if (item.needs && !can(role, item.needs)) continue;
    const en = SHELL_TEXT.en.nav[item.label];
    const esLabel = SHELL_TEXT.es.nav[item.label];
    entries.push({
      id: `page:${item.href}`,
      kind: "page",
      label: es ? esLabel : en,
      detail: item.href,
      href: item.href,
      terms: [normalize(en), normalize(esLabel), normalize(PAGE_TERMS[item.label] ?? "")],
    });
  }

  // The same scope as the clients list: only the people this member may see.
  for (const client of visibleClients(viewer, [...sources.clients])) {
    const name = `${client.firstName} ${client.lastName}`.trim();
    const digits = client.phone.replace(/\D/g, "");
    entries.push({
      id: `client:${client.id}`,
      kind: "client",
      label: name || client.phone,
      detail: formatDigits(digits),
      href: `/equipo/clientes/${client.id}`,
      terms: [normalize(name), ...(client.email ? [normalize(client.email)] : [])],
      phoneDigits: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits,
    });
  }

  if (can(role, "partners.view")) {
    for (const partner of sources.partners ?? []) {
      entries.push({
        id: `partner:${partner.id}`,
        kind: "partner",
        label: partner.name,
        detail: partner.company,
        href: `/equipo/socios#socio-${partner.id}`,
        terms: [normalize(partner.name), ...(partner.company ? [normalize(partner.company)] : [])],
        ...(partner.phone ? { phoneDigits: partner.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") } : {}),
      });
    }
  }

  if (can(role, "letters.edit")) {
    for (const letter of LETTER_CATALOGUE) {
      entries.push({
        id: `letter:${letter.key}`,
        kind: "letter",
        label: es ? letter.title.es : letter.title.en,
        detail: letter.key,
        href: `/equipo/cartas?carta=${letter.key}`,
        terms: [normalize(letter.title.en), normalize(letter.title.es), normalize(letter.key.replace(/_/g, " "))],
      });
    }
  }
  return entries;
}

function formatDigits(digits: string): string | null {
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : null;
}

/** How well one entry matches the query; 0 for no match. */
export function matchScore(entry: SearchEntry, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const digits = query.replace(/\D/g, "");
  let best = 0;
  // A phone number, typed with or without its punctuation: 3 digits or more.
  if (entry.phoneDigits && digits.length >= 3 && digits.length === query.replace(/[\s()+.-]/g, "").length) {
    const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (entry.phoneDigits.startsWith(d)) best = 90;
    else if (entry.phoneDigits.includes(d)) best = 70;
  }
  const label = normalize(entry.label);
  const tokens = q.split(" ");
  for (const term of [label, ...entry.terms]) {
    if (!term) continue;
    const words = term.split(" ");
    if (term === q) best = Math.max(best, 100);
    else if (term.startsWith(q)) best = Math.max(best, 85);
    else if (words.some((w) => w.startsWith(q))) best = Math.max(best, 65);
    else if (tokens.length > 1 && tokens.every((t) => words.some((w) => w.startsWith(t)))) best = Math.max(best, 60);
    // Inside a word: only in the name itself, never in a keyword ("ros" is not "cobros").
    else if (q.length >= 3 && term === label && term.includes(q)) best = Math.max(best, 35);
  }
  // The label itself counts a little more than a keyword.
  if (best > 0 && (label === q || label.startsWith(q))) best += 5;
  return best;
}

const KIND_ORDER: readonly SearchKind[] = ["action", "page", "client", "partner", "letter"];

/**
 * The best matches for what was typed, best first (ties: actions, then pages,
 * clients, partners, templates). With nothing typed: the actions and the
 * everyday pages, to start from.
 */
export function searchStaff(query: string, sources: SearchSources, limit = 12): SearchResult[] {
  const index = searchIndex(sources);
  if (!normalize(query)) {
    return index
      .filter((e) => e.kind === "action" || (e.kind === "page" && PRIMARY_NAV.some((n) => `page:${n.href}` === e.id)))
      .slice(0, limit)
      .map((e) => ({ ...e, score: 0 }));
  }
  // "import rosa" / "importar rosa": the import for that client, straight to their importer.
  const [first, ...rest] = normalize(query).split(" ");
  const forClient: SearchResult[] = [];
  if (first && first.length >= 3 && rest.length > 0 && ("import".startsWith(first) || "importar".startsWith(first) || first.startsWith("import")) && can(sources.viewer?.role, "reports.import")) {
    const who = rest.join(" ");
    for (const entry of index) {
      if (entry.kind !== "client") continue;
      const score = matchScore(entry, who);
      if (score === 0) continue;
      forClient.push({
        ...entry,
        id: `action:import:${entry.id}`,
        kind: "action",
        label: sources.locale === "es" ? `Importar reporte · ${entry.label}` : `Import report · ${entry.label}`,
        href: `${entry.href}?importar=1`,
        score: score + 10,
      });
    }
  }
  return [...forClient, ...index.map((entry) => ({ ...entry, score: matchScore(entry, query) }))]
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export const SEARCH_KIND_LABEL: Record<"es" | "en", Record<SearchKind, string>> = {
  en: { action: "Do", page: "Page", client: "Client", partner: "Partner", letter: "Letter template" },
  es: { action: "Hacer", page: "Página", client: "Cliente", partner: "Socio", letter: "Plantilla de carta" },
};
