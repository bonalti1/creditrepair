import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachDemoAutopilot, DEMO_CHANNELS, DEMO_SETTINGS } from "../autopilot/demo";
import { BLOCK_TEXT, BLOCK_TEXT_EN, FOLLOWUP_TEXT_EN } from "../autopilot/followups";
import { workQueue, STATUS_LABELS } from "../autopilot/queue";
import { RESOLUTION_LABEL_EN } from "../autopilot/resolutions";
import type { AutopilotEnv } from "../autopilot/types";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { CHANNEL_LABEL_EN } from "../leads/source";
import { CHIP_TEXT_EN, chipText } from "../letters/versions/source";
import { STATUS_LABEL_EN } from "../letters/versions/versions";
import { seededBook } from "../mail/data";
import { demoClientsWithMail } from "../mail/demo";
import { FURNISHER_FIELD_LABEL_EN } from "../mail/furnishers";
import { returnReason } from "../mail/tracking";
import { PARTNER_METRIC_INFO_EN } from "../partners/metrics";
import { COMMISSION_BASIS_LABEL_EN, PARTNER_STATUS_LABEL_EN } from "../partners/rules";
import { SALES_MAY_NOT_SAY_EN, SALES_MAY_SAY_EN } from "../sales/invite";
import { activityFeed, ACTIVITY_LABELS } from "../staff/activity";
import { answerProblems, bestMatch, DEMO_SAVED_ANSWERS, libraryReplyFor, type SavedAnswer } from "../staff/answers";
import { BILLING_STATE_LABELS, clientRows, CSV_COLUMN_NAMES } from "../staff/clientList";
import { checkStaffReply, RULE_REASONS } from "../staff/conversation";
import { buildDemoClients } from "../staff/demoClients";
import { DIGEST_TEMPLATE_BODIES, morningSummary } from "../staff/digest";
import { demoDraftCaller, draftProblems, draftReply, DRAFT_MESSAGES } from "../staff/drafts";
import {
  clientLanguage,
  DEFAULT_STAFF_LOCALE,
  initialStaffLocale,
  localeFromBrowser,
  normalizeStaffLocale,
  STAFF_LOCALES,
  staffLocaleFallback,
  type StaffLocale,
} from "../staff/i18n/locale";
import { MESSAGE_EN, staffMessage } from "../staff/i18n/messages";
import { SHELL_TEXT } from "../staff/i18n/ui/shell";
import { ALTI_HELP_TEXT } from "../staff/altiHelp";
import { VIDEO_TEXT } from "../video/labels";
import { DIMENSION_LABELS, OUTCOME_DEFINITION_TEXT } from "../staff/learning";
import { exceptionMessage, MESSAGE_BODIES, STAFF_MESSAGE_RULE_TEXT } from "../staff/messages";
import { METRIC_INFOS, PERIOD_LABELS } from "../staff/metrics";
import { CAPABILITY_LABELS, deniedReason, ROLE_LABELS, ROLE_SUMMARIES, SCOPE_LABELS } from "../staff/permissions";
import { HOUSE_RULE_TEXT, helpForPath, NEW_HIRE_CHECKLISTS, PLAYBOOKS, playbookFor, SCREEN_HELPS, SCREENS_TOURS, TOUR_STEP_TEXT } from "../staff/playbook";
import { DEFAULT_PREFERENCES, DIGEST_CHANNEL_LABELS, formatDigestTime, normalizePreferences, preferencesFromRow, preferencesUpdateSchema, STAFF_TIME_ZONE_NAMES } from "../staff/preferences";
import { ACTOR_LABELS, clientExceptions, DOCUMENT_NAMES, EXCEPTION_KINDS, EXCEPTION_LABELS, nextStep, STAGE_ORDER, STAGE_TEXT } from "../staff/stage";
import { buildDemoTeam } from "../staff/team";
import { clientTimeline } from "../staff/timeline";
import type { StaffClient } from "../staff/types";

// The staff console's language (docs/STAFF.md, "Language"): English first,
// Spanish for a member who chooses it, and whatever goes to a client in the
// CLIENT's language. These tests walk every staff text table in both
// languages and fail on a missing language or on Spanish left in English.

const NOW = new Date("2026-12-07T15:00:00.000Z");
const ENV: AutopilotEnv = { settings: DEMO_SETTINGS, channels: DEMO_CHANNELS };
const ADMIN = { handle: "carmen", name: "Carmen Ruiz", role: "admin" as const };

/**
 * Spanish that should not be in an English text: accented letters, ¿ ¡, and
 * common Spanish words. Names of people (Spanish names are fine in English)
 * are not words on this list.
 */
const SPANISH_MARKERS =
  /[áéíóúñ¿¡]|\b(el|la|los|las|del|que|para|con|sin|una|uno|unos|su|sus|tu|tus|es|está|están|cliente|clientes|ronda|rondas|carta|cartas|equipo|aquí|hoy|ayer|mañana|todavía|nada|cuando|porque|pero|también|ningún|ninguna|hay|puede|pueden|debe|guardar|enviar|cancelar|editar|ver|solo|cobro|cobros|pago|reporte|socio|socios|abogado|plantilla|piloto)\b/i;

/**
 * Allowed in English: the language's own name, brand names, a link or a path,
 * and the Spanish characters an English sentence names on purpose (the letter
 * editor tells a member to remove "ñ and the ¿ ¡ marks").
 */
const ALLOWED_IN_ENGLISH = /Español|AltiBot|Credalti|Equifax|Experian|TransUnion|\bde\b|https?:\/\/\S+|\/equipo\S*|ñ and the ¿ ¡/g;

/** What a client or a teammate typed is quoted as typed: “…” and «…» are left out of the check. */
const QUOTED = /“[^”]*”|«[^»]*»/g;

function spanishIn(text: string, { quotes = false } = {}): string | null {
  const allowed = text.replace(ALLOWED_IN_ENGLISH, "");
  const cleaned = quotes ? allowed.replace(QUOTED, "") : allowed;
  const match = cleaned.match(SPANISH_MARKERS);
  return match ? match[0] : null;
}

/** Every string in a table, functions called with sample values, with its path. Links and paths are not words. */
function leaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return /(^|\.)href$/.test(path) ? [] : [[path, value]];
  if (typeof value === "function") {
    try {
      const out = (value as (...args: unknown[]) => unknown)("Ana", "Ana", 2, 3);
      return typeof out === "string" ? [[`${path}()`, out]] : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

/** The shape of a table: its keys, recursively, without the values. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

// The tables that hold both languages, keyed by locale.
const BILINGUAL_TABLES: Record<string, Record<StaffLocale, unknown>> = {
  SHELL_TEXT,
  ALTI_HELP_TEXT,
  STAGE_TEXT,
  EXCEPTION_LABELS,
  ACTOR_LABELS,
  DOCUMENT_NAMES,
  ROLE_LABELS,
  ROLE_SUMMARIES,
  SCOPE_LABELS,
  CAPABILITY_LABELS,
  METRIC_INFOS,
  PERIOD_LABELS,
  PLAYBOOKS,
  SCREEN_HELPS,
  HOUSE_RULE_TEXT,
  NEW_HIRE_CHECKLISTS,
  SCREENS_TOURS,
  TOUR_STEP_TEXT,
  ACTIVITY_LABELS,
  BILLING_STATE_LABELS,
  CSV_COLUMN_NAMES,
  STATUS_LABELS,
  DIGEST_CHANNEL_LABELS,
  STAFF_TIME_ZONE_NAMES,
  DIMENSION_LABELS,
  OUTCOME_DEFINITION_TEXT,
  RULE_REASONS,
  STAFF_MESSAGE_RULE_TEXT,
  DIGEST_TEMPLATE_BODIES,
  DRAFT_MESSAGES,
  VIDEO_TEXT,
};

// English-only twins of Spanish tables that live where their rule lives.
const ENGLISH_TABLES: Record<string, unknown> = {
  FURNISHER_FIELD_LABEL_EN,
  PARTNER_STATUS_LABEL_EN,
  COMMISSION_BASIS_LABEL_EN,
  STATUS_LABEL_EN,
  CHIP_TEXT_EN,
  RESOLUTION_LABEL_EN,
  BLOCK_TEXT_EN,
  FOLLOWUP_TEXT_EN,
  CHANNEL_LABEL_EN,
  PARTNER_METRIC_INFO_EN,
  SALES_MAY_SAY_EN,
  SALES_MAY_NOT_SAY_EN,
  MESSAGE_EN,
};

describe("staff language: the model", () => {
  it("is English or Spanish, English by default", () => {
    expect(STAFF_LOCALES).toEqual(["en", "es"]);
    expect(DEFAULT_STAFF_LOCALE).toBe("en");
    expect(staffLocaleFallback()).toBe("en");
    expect(normalizeStaffLocale("es")).toBe("es");
    expect(normalizeStaffLocale("fr")).toBeNull();
    expect(normalizeStaffLocale(null)).toBeNull();
  });

  it("starts from the member's saved choice, else a Spanish browser, else English", () => {
    expect(localeFromBrowser("es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(localeFromBrowser("en-US,en;q=0.9,es;q=0.8")).toBe("en");
    expect(localeFromBrowser(["fr-FR", "es-419"])).toBe("es");
    expect(localeFromBrowser(["fr-FR", "de"])).toBe("en");
    expect(localeFromBrowser(null)).toBe("en");
    expect(localeFromBrowser("")).toBe("en");
    expect(initialStaffLocale(null, "es-MX")).toBe("es");
    expect(initialStaffLocale("en", "es-MX")).toBe("en");
    expect(initialStaffLocale("es", "en-US")).toBe("es");
    expect(initialStaffLocale(undefined, undefined)).toBe("en");
  });

  it("is kept on the member's preferences: nothing chosen until they choose", () => {
    expect(DEFAULT_PREFERENCES.locale).toBeNull();
    expect(normalizePreferences({ ...DEFAULT_PREFERENCES, locale: "es" }).locale).toBe("es");
    expect(normalizePreferences({ ...DEFAULT_PREFERENCES, locale: "xx" as never }).locale).toBeNull();
    expect(preferencesUpdateSchema.safeParse({ locale: "es" }).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ locale: "en" }).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ locale: "fr" }).success).toBe(false);
    const row = { user_id: "u", digest_enabled: true, digest_channel: "email", digest_time: "08:30", time_zone: "America/Chicago", locale: "es" };
    expect(preferencesFromRow(row as never).locale).toBe("es");
    expect(preferencesFromRow({ ...row, locale: null } as never).locale).toBeNull();
    expect(formatDigestTime("08:30", "en")).toBe("8:30 AM");
  });

  it("the console reads the member's language from the server first, and switches from the menu and the profile", () => {
    const layout = readFileSync("src/app/equipo/layout.tsx", "utf8");
    expect(layout).toMatch(/accept-language/);
    expect(layout).toMatch(/localeFromBrowser/);
    expect(layout).toMatch(/getStaffLocaleChoice/);
    const shell = readFileSync("src/components/staff/StaffShell.tsx", "utf8");
    expect(shell).toMatch(/export function LanguageSwitch/);
    expect(shell).toMatch(/data-testid="language-switch"/);
    expect(readFileSync("src/app/equipo/perfil/page.tsx", "utf8")).toMatch(/LanguageSwitch/);
    const provider = readFileSync("src/lib/staff/i18n/StaffLocale.tsx", "utf8");
    expect(provider).toMatch(/\/api\/staff\/preferences/);
    expect(provider).toMatch(/writeDemoPreferences/);
  });
});

describe("staff language: every table in both languages", () => {
  for (const [name, table] of Object.entries(BILINGUAL_TABLES)) {
    it(`${name}: English and Spanish, the same keys, no Spanish in the English`, () => {
      expect(Object.keys(table).sort()).toEqual(["en", "es"]);
      expect(shape(table.en), `${name}: the languages have different keys`).toEqual(shape(table.es));
      const english = leaves(table.en);
      expect(english.length).toBeGreaterThan(0);
      for (const [path, text] of english) {
        expect(text.trim(), `${name}.en.${path} is empty`).not.toBe("");
        expect(spanishIn(text), `${name}.en.${path}: «${text}»`).toBeNull();
      }
      // The Spanish is not the English copied over (a sentence of three words or more).
      const spanish = new Map(leaves(table.es));
      for (const [path, text] of english) {
        if (text.split(/\s+/).length >= 3 && !/^\{\{|^https?:/.test(text)) {
          expect(spanish.get(path), `${name}.es.${path} is the English`).not.toBe(text);
        }
      }
    });
  }

  for (const [name, table] of Object.entries(ENGLISH_TABLES)) {
    it(`${name}: no Spanish left in it`, () => {
      const english = leaves(table);
      expect(english.length).toBeGreaterThan(0);
      for (const [path, text] of english) expect(spanishIn(text), `${name}.${path}: «${text}»`).toBeNull();
    });
  }

  it("the follow-up block reasons have an English twin for each", () => {
    expect(Object.keys(BLOCK_TEXT_EN).sort()).toEqual(Object.keys(BLOCK_TEXT).sort());
  });

  it("nothing a teammate reads promises a result, in either language", () => {
    for (const locale of STAFF_LOCALES) {
      const lines = [
        ...STAGE_ORDER.flatMap((s) => [STAGE_TEXT[locale][s].label, STAGE_TEXT[locale][s].description]),
        ...Object.values(EXCEPTION_LABELS[locale]),
        ...Object.values(ROLE_SUMMARIES[locale]),
        ...STAFF_MESSAGE_RULE_TEXT[locale],
        ...HOUSE_RULE_TEXT[locale],
      ];
      for (const line of lines) expect(checkClaimGuardrails(line), `${locale}: ${line}`).toEqual([]);
    }
  });

  it("every exception kind has a playbook card and a label in both languages", () => {
    for (const kind of EXCEPTION_KINDS) {
      for (const locale of STAFF_LOCALES) {
        expect(EXCEPTION_LABELS[locale][kind], `${locale} ${kind}`).toBeTruthy();
        expect(playbookFor(kind, locale).steps.length).toBeGreaterThanOrEqual(3);
      }
      expect(playbookFor(kind, "en")).not.toEqual(playbookFor(kind, "es"));
    }
    expect(helpForPath("/equipo", "en").title).not.toBe(helpForPath("/equipo", "es").title);
  });

  it("a chip's label and help follow the member's language; the attorney's packet keeps its English", () => {
    expect(chipText("partidas", "en").label).toBe("Item list");
    expect(chipText("partidas", "es").label).toBe("Lista de partidas");
  });
});

describe("staff language: the screens", () => {
  /** Every .tsx under a folder. */
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
    });
  }
  const screens = [...files("src/app/equipo"), ...files("src/components/staff")];

  /** The literal pairs in t("…", "…") / t(`…`, `…`): Spanish first, English second. */
  function pairs(source: string): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const pattern = /\bt\(\s*(["`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(["`])((?:\\.|(?!\3)[^\\])*)\3\s*,?\s*\)/g;
    for (const match of source.matchAll(pattern)) out.push([match[2]!, match[4]!]);
    return out;
  }

  it("every screen speaks the member's language", () => {
    const untranslated = screens.filter((file) => {
      const source = readFileSync(file, "utf8");
      // A screen with words on it uses the console's language; a few pieces have no words of their own.
      return /[áéíóúñ]/.test(source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")) && !/useTx|useText|useStaffLocale|locale/.test(source);
    });
    expect(untranslated).toEqual([]);
  });

  it("every inline pair has an English side with no Spanish in it", () => {
    let count = 0;
    for (const file of screens) {
      for (const [es, en] of pairs(readFileSync(file, "utf8"))) {
        count += 1;
        // Template placeholders are code, not words.
        const english = en.replace(/\$\{[^}]*\}/g, "");
        expect(spanishIn(english), `${file}: t(«${es}», «${en}»)`).toBeNull();
        if (english.split(/\s+/).length >= 3) expect(en, `${file}: the English is the Spanish`).not.toBe(es);
      }
    }
    // The console has hundreds of them; a count far below means the pattern stopped matching.
    expect(count).toBeGreaterThan(800);
  });
});

describe("staff language: the sentences the console builds", () => {
  const team = buildDemoTeam(NOW);
  const clients = attachDemoAutopilot(demoClientsWithMail(buildDemoClients(NOW), NOW), NOW);
  const context = { furnishers: seededBook(), autopilot: ENV };
  const names = [
    ...new Set([...clients.flatMap((c) => [c.firstName, c.lastName, ...c.lastName.split(" ")]), ...team.members.flatMap((m) => m.name.split(" "))]),
  ].sort((a, b) => b.length - a.length);
  const withoutNames = (line: string) => names.reduce((text, name) => text.split(name).join("·"), line);

  it("in English: notices, next steps, timelines, the client list, the activity feed and the queue", () => {
    const lines: string[] = [];
    for (const client of clients) {
      for (const e of clientExceptions(client, NOW, { ...context, locale: "en" })) lines.push(e.sentence, e.actionLabel);
      lines.push(nextStep(client, NOW, "en").text);
      for (const entry of clientTimeline(client, NOW, "en")) lines.push(entry.text);
    }
    for (const row of clientRows(clients, ADMIN, NOW, ENV, "en")) lines.push(row.step.text);
    for (const entry of activityFeed(clients, team.members, team.events, "en")) lines.push(entry.text);
    for (const item of workQueue(clients, NOW, { ...context, locale: "en" })) {
      lines.push(item.why, item.action.label, item.triedSummary ?? "", ...item.tried.map((line) => line.text));
    }
    expect(lines.length).toBeGreaterThan(100);
    // What a client or a teammate typed is quoted as typed, and people's names stay theirs:
    // only the console's own words are checked.
    for (const line of lines.filter(Boolean)) expect(spanishIn(withoutNames(line), { quotes: true }), line).toBeNull();
  });

  it("in Spanish for a member who chose it", () => {
    const client = clients.find((c) => clientExceptions(c, NOW, { ...context, locale: "es" }).length > 0)!;
    const es = clientExceptions(client, NOW, { ...context, locale: "es" })[0]!;
    const en = clientExceptions(client, NOW, { ...context, locale: "en" })[0]!;
    expect(es.kind).toBe(en.kind);
    expect(es.sentence).not.toBe(en.sentence);
    expect(spanishIn(es.sentence)).not.toBeNull();
    expect(nextStep(client, NOW, "es").text).not.toBe(nextStep(client, NOW, "en").text);
    expect(deniedReason("billing.refund", "en")).toBe("Only an administrator can refund charges.");
    expect(spanishIn(deniedReason("billing.refund", "es"))).not.toBeNull();
  });

  it("the morning summary goes in the member's language", () => {
    const en = morningSummary(ADMIN, clients, NOW, context, "https://app.test", "en");
    const es = morningSummary(ADMIN, clients, NOW, context, "https://app.test", "es");
    expect(en.text).toMatch(new RegExp(`^Good morning, Carmen\\. Today: ${en.count} things? · ~${en.minutes} minutes\\.`));
    expect(es.text).toMatch(/^Buenos días, Carmen\. Hoy: /);
    expect(en.locale).toBe("en");
    expect(es.locale).toBe("es");
    expect(spanishIn(withoutNames(en.text), { quotes: true }), en.text).toBeNull();
    expect(morningSummary(ADMIN, clients, NOW, context).locale).toBe("en");
  });

  it("a check's or a route's message reaches an English member in English", () => {
    expect(staffMessage("No se pudo guardar.", "en")).toBe("Couldn't save.");
    expect(staffMessage("No se pudo guardar.", "es")).toBe("No se pudo guardar.");
    expect(staffMessage("Ya hay un cliente con este teléfono: Rosa Díaz.", "en")).toBe("There's already a client with this phone number: Rosa Díaz.");
    expect(staffMessage("La dirección no se puede leer: Falta la ciudad.", "en")).toBe("The address can't be read: The city is missing.");
    expect(staffMessage("La ficha «Lista de partidas» va una sola vez.", "en")).toBe("The “Item list” chip goes in only once.");
    expect(staffMessage("Something new", "en")).toBe("Something new");
    expect(returnReason("Address Not Found", "en")).not.toMatch(SPANISH_MARKERS);
  });
});

describe("staff language: what goes to a client is in the CLIENT's language", () => {
  const base = buildDemoClients(NOW)[0]!;
  const english: StaffClient = { ...base, locale: "en" };
  const spanish: StaffClient = { ...base, locale: "es" };
  const unknown: StaffClient = { ...base, locale: undefined };

  it("a client with no saved language is written to in English", () => {
    expect(clientLanguage(unknown)).toBe("en");
    expect(clientLanguage(english)).toBe("en");
    expect(clientLanguage(spanish)).toBe("es");
    expect(clientLanguage(null)).toBe("en");
  });

  it("WhatsApp drafts follow the client, whatever the member's language", () => {
    const clients = demoClientsWithMail(buildDemoClients(NOW), NOW);
    let checked = 0;
    for (const client of clients) {
      for (const exception of clientExceptions(client, NOW, { furnishers: seededBook(), locale: "en" })) {
        const es = exceptionMessage({ ...client, locale: "es" }, exception);
        const en = exceptionMessage({ ...client, locale: "en" }, exception);
        expect(es).toMatch(/^Hola \p{L}+, te escribe el equipo de Credalti\./u);
        expect(en).toMatch(/^Hi \p{L}+, this is the Credalti team\./u);
        // The client's own question is quoted as they asked it.
        expect(spanishIn(en.replace(client.firstName, "·"), { quotes: true }), en).toBeNull();
        expect(checkClaimGuardrails(en), en).toEqual([]);
        expect(checkClaimGuardrails(es), es).toEqual([]);
        // The member's language plays no part: the exception was built for an English console.
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(Object.keys(MESSAGE_BODIES.en).sort()).toEqual(Object.keys(MESSAGE_BODIES.es).sort());
  });

  it("the AltiBot draft is written in the client's language", async () => {
    const asking = buildDemoClients(NOW).find((c) => c.questions.some((q) => !q.answeredAt))!;
    expect(asking).toBeTruthy();
    const prompts: string[] = [];
    const caller: typeof demoDraftCaller = async (input) => {
      prompts.push(input.user);
      return demoDraftCaller(input);
    };
    const en = await draftReply({ client: { ...asking, locale: "en" }, role: "admin", now: NOW, locale: "es" }, caller);
    const es = await draftReply({ client: { ...asking, locale: "es" }, role: "admin", now: NOW, locale: "en" }, caller);
    expect(en).toMatchObject({ ok: true });
    expect(es).toMatchObject({ ok: true });
    if (en.ok && es.ok) {
      expect(en.draft).toMatch(/^Hi /);
      expect(es.draft).toMatch(/^Hola /);
    }
    expect(prompts[0]).toMatch(/INGLÉS/);
    expect(prompts[1]).toMatch(/ESPAÑOL/);
  });

  it("saved answers have a language, and only those in the client's are suggested", () => {
    const languages = new Set(DEMO_SAVED_ANSWERS.map((a) => a.language));
    expect(languages).toEqual(new Set(["en", "es"]));
    const approved = DEMO_SAVED_ANSWERS.filter((a) => a.status === "approved");
    const englishMatch = bestMatch("When do my letters go out?", approved, undefined, "en");
    const spanishMatch = bestMatch("¿Cuándo salen mis cartas?", approved, undefined, "es");
    if (englishMatch) expect(englishMatch.answer.language).toBe("en");
    if (spanishMatch) expect(spanishMatch.answer.language).toBe("es");
    expect(englishMatch ?? spanishMatch).toBeTruthy();
    // A Spanish answer is never offered to an English-speaking client, however close the words.
    const onlySpanish: SavedAnswer[] = approved.filter((a) => a.language === "es");
    for (const answer of onlySpanish) expect(bestMatch(answer.question, onlySpanish, undefined, "en")).toBeNull();
    expect(libraryReplyFor(onlySpanish[0]!.question, onlySpanish, "en")).toBeNull();
    // The English answers pass the same rules as the Spanish ones.
    for (const answer of DEMO_SAVED_ANSWERS.filter((a) => a.language === "en")) {
      expect(answerProblems({ question: answer.question, answer: answer.answer }, "Rosa", "en"), answer.answer).toEqual([]);
      expect(spanishIn(answer.answer), answer.answer).toBeNull();
    }
  });

  it("the client page shows the client's language wherever staff write to a client", () => {
    const tag = readFileSync("src/components/staff/ui.tsx", "utf8");
    expect(tag).toMatch(/export function ClientLanguageTag/);
    expect(tag).toMatch(/data-testid="client-language"/);
    expect(readFileSync("src/components/staff/Conversation.tsx", "utf8")).toMatch(/<ClientLanguageTag/);
    expect(readFileSync("src/components/staff/WorkQueue.tsx", "utf8")).toMatch(/<ClientLanguageTag/);
    expect(readFileSync("src/components/staff/AddClient.tsx", "utf8")).toMatch(/<ClientLanguageTag|lang/);
  });
});

describe("staff language: the reply guardrails, in English too", () => {
  it("block English promises, with the reason in the member's language", () => {
    for (const text of [
      "We guarantee the collection will be deleted from your report.",
      "We will remove the late payments from your credit report.",
      "Your score will go up 100 points in 30 days.",
      "You'll be approved for a mortgage after this.",
    ]) {
      const en = checkStaffReply(text, "en");
      expect(en.length, text).toBeGreaterThan(0);
      for (const problem of en) expect(spanishIn(problem.why), problem.why).toBeNull();
      const es = checkStaffReply(text, "es");
      expect(es.length).toBe(en.length);
      expect(es[0]!.why).not.toBe(en[0]!.why);
    }
  });

  it("block Spanish promises the same way", () => {
    expect(checkStaffReply("Te garantizamos que borramos esa cuenta.", "en").length).toBeGreaterThan(0);
  });

  it("stop a draft that tells the client what to mark, in either language", () => {
    expect(draftProblems("You should mark this account as inaccurate.", "en").length).toBeGreaterThan(0);
    expect(draftProblems("Deberías marcar esa cuenta.", "en").length).toBeGreaterThan(0);
    expect(draftProblems("Hi Rosa, thanks for writing. I'll check your case today and write back here.", "en")).toEqual([]);
  });
});
