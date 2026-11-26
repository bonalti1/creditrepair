import { BRAND } from "../brand";
import { checkClaimGuardrails, checkMarketingCopy } from "../compliance/guardrails";
import type { ServiceMode } from "../service/mode";
import { longSentences } from "../ux/plainLanguage";
import {
  CHECKLIST_KEYS,
  COPY_FIELDS,
  IMAGE_TYPES,
  languagesOf,
  VIDEO_TYPES,
  type Bilingual,
  type ChecklistGroup,
  type ChecklistKey,
  type ContentPiece,
  type CopyField,
  type CopyLang,
} from "./types";

// The compliance and brand check every piece runs through, on every change,
// on the screen and again on the server before approval, scheduling and
// publishing. Two levels:
//
//   block  The piece cannot be approved (or published) while it is there.
//   warn   Worth fixing; a person decides.
//
// The words go through the same rules as the website and the ads
// (checkMarketingCopy and checkClaimGuardrails, src/lib/compliance/guardrails.ts),
// plus the rules the website's copy tests hold (nothing called "free", no
// outcome words, no score visuals, no price, no pressure; docs/WEBSITE.md) and
// the brand's character rules (docs/BRAND.md: Alti always labelled as AI,
// AltiBot a silent cameo). Every issue carries a plain explanation and what
// to do, in English and Spanish.

export type Severity = "block" | "warn";

export interface ContentIssue {
  /** Stable for one rule on one field in one language: "caption.en.no-free". */
  id: string;
  rule: string;
  severity: Severity;
  /** The field it was found in ("piece" for the whole piece, "assets" for the files, "links"). */
  field: CopyField | "piece" | "assets" | "links";
  lang: CopyLang | null;
  /** The words that tripped it, when there are some. */
  match: string | null;
  explain: Bilingual;
  fix: Bilingual;
}

const RULE_TEXT: Record<string, { explain: Bilingual; fix: Bilingual }> = {
  "no-guaranteed-deletions": {
    explain: { en: "It promises that something will come off a report. Nobody can promise that: the bureaus decide.", es: "Promete que algo saldrá de un reporte. Nadie puede prometerlo: deciden los burós." },
    fix: { en: "Say what we do (prepare and mail letters) and that results vary.", es: "Di lo que hacemos (preparar y enviar cartas) y que los resultados varían." },
  },
  "no-points-in-days": {
    explain: { en: "It names points and a time (\"100 points in 30 days\"). That is a promised result.", es: "Habla de puntos y un plazo (\"100 puntos en 30 días\"). Es un resultado prometido." },
    fix: { en: "Remove the numbers. Talk about the process instead.", es: "Quita los números. Habla del proceso." },
  },
  "no-accurate-removal": {
    explain: { en: "It suggests removing accurate information. We only dispute what the client says is inaccurate.", es: "Sugiere quitar información correcta. Solo disputamos lo que el cliente dice que es inexacto." },
    fix: { en: "Talk about errors and inaccurate items only.", es: "Habla solo de errores y datos inexactos." },
  },
  "diy-positioning": {
    explain: { en: "It says we fix, remove, clean or raise something. Those are outcomes, and outcomes are the bureaus' to decide.", es: "Dice que arreglamos, quitamos, limpiamos o subimos algo. Eso es un resultado, y lo deciden los burós." },
    fix: { en: "Say \"we prepare and mail the letters for you\".", es: "Di \"preparamos y enviamos las cartas por ti\"." },
  },
  "client-decides": {
    explain: { en: "It suggests the team picks what to dispute, or disputes everything negative. The client decides what is inaccurate.", es: "Sugiere que el equipo elige qué disputar, o que se disputa todo lo negativo. El cliente decide qué es inexacto." },
    fix: { en: "Say \"you tell us what is wrong on your report\".", es: "Di \"tú nos dices qué está mal en tu reporte\"." },
  },
  "self-serve-positioning": {
    explain: { en: "In self-serve mode the client sends their own letters, so \"we dispute\" is not true.", es: "En el modo de autoservicio el cliente envía sus cartas, así que \"disputamos\" no es cierto." },
    fix: { en: "Describe what the client does with our help.", es: "Describe lo que hace el cliente con nuestra ayuda." },
  },
  "no-real-estate-bait": {
    explain: { en: "Rent-to-own offers tied to credit are a known trap in this industry. We never use them.", es: "Las ofertas de renta con opción a compra ligadas al crédito son una trampa conocida. Nunca las usamos." },
    fix: { en: "Remove the offer.", es: "Quita la oferta." },
  },
  "no-outcome-promise": {
    explain: { en: "It promises or implies a result (\"improve your credit\", \"real results\", \"so you can buy a house\").", es: "Promete o insinúa un resultado (\"mejora tu crédito\", \"resultados reales\", \"para que compres casa\")." },
    fix: { en: "Describe the process; add \"results vary\".", es: "Describe el proceso; agrega \"los resultados varían\"." },
  },
  "no-approval-claims": {
    explain: { en: "Approvals belong to lenders. We never claim or imply one.", es: "Las aprobaciones son de los prestamistas. Nunca las prometemos ni insinuamos." },
    fix: { en: "Remove the approval claim.", es: "Quita lo de la aprobación." },
  },
  "no-free": {
    explain: { en: "Nothing we sell is free: the service is paid and monitoring is paid to the provider.", es: "Nada de lo que vendemos es gratis: el servicio se paga y el monitoreo se le paga al proveedor." },
    fix: { en: "Drop \"free\". \"At no cost\" is allowed only for disputing on your own, cancelling in 3 business days, or ending the service.", es: "Quita \"gratis\". \"Sin costo\" solo vale para disputar por tu cuenta, cancelar en 3 días hábiles o terminar el servicio." },
  },
  "no-outcome-words": {
    explain: { en: "Words like deleted, removed, fixed, guaranteed or approved read as a promised result.", es: "Palabras como eliminado, borrado, arreglado, garantizado o aprobado suenan a resultado prometido." },
    fix: { en: "Use process words: prepared, mailed, sent, reviewed.", es: "Usa palabras del proceso: preparadas, enviadas, revisadas." },
  },
  "no-score-visuals": {
    explain: { en: "Score numbers, \"+N points\" and before/after are score visuals. The brand never shows them in marketing.", es: "Números de puntaje, \"+N puntos\" y antes/después son visuales de puntaje. La marca nunca los muestra en publicidad." },
    fix: { en: "Remove the score talk. No dials, gauges, numbers or arrows in the visuals either.", es: "Quita lo del puntaje. Tampoco diales, medidores, números ni flechas en los visuales." },
  },
  "no-price": {
    explain: { en: "Amounts are never in marketing copy. Prices live only on the pricing page, from an attorney-approved plan.", es: "Los montos nunca van en la publicidad. Los precios están solo en la página de precios, de un plan aprobado por el abogado." },
    fix: { en: "Say \"our team explains the plan\" or link to the pricing page.", es: "Di \"nuestro equipo te explica el plan\" o enlaza a la página de precios." },
  },
  "no-money-back": {
    explain: { en: "There is no money-back guarantee (it is pending with the attorney).", es: "No hay garantía de devolución (está pendiente con el abogado)." },
    fix: { en: "Remove it. You may say the service can be ended any time.", es: "Quítala. Puedes decir que el servicio se puede terminar cuando quieras." },
  },
  "no-pressure": {
    explain: { en: "Pressure (\"act now\", \"last chance\", \"only today\") is not how we sell. Nobody is pushed to sign.", es: "La presión (\"actúa ya\", \"última oportunidad\", \"solo hoy\") no es como vendemos. A nadie se le presiona." },
    fix: { en: "Invite instead: \"Start my review when you're ready\".", es: "Invita: \"Empieza tu revisión cuando quieras\"." },
  },
  "alti-label": {
    explain: { en: "Alti appears or speaks, but the piece never says he is AI. He looks like a person, so it must say so every time.", es: "Aparece o habla Alti, pero la pieza no dice que es IA. Parece una persona, así que siempre hay que decirlo." },
    fix: { en: `Add the label "${BRAND.assistant} · ${BRAND.aiLabel.en}" on screen and in the text.`, es: `Agrega la etiqueta "${BRAND.assistant} · ${BRAND.aiLabel.es}" en pantalla y en el texto.` },
  },
  "alti-person": {
    explain: { en: "It presents Alti as a person or a teammate. He is an AI assistant.", es: "Presenta a Alti como persona o como alguien del equipo. Es un asistente con IA." },
    fix: { en: "Say he is the AI assistant.", es: "Di que es el asistente con IA." },
  },
  "altibot-speaks": {
    explain: { en: `${BRAND.cameo} is a small cameo only: he never speaks, narrates or is named in the copy.`, es: `${BRAND.cameo} es solo un cameo pequeño: nunca habla, narra ni se nombra en el texto.` },
    fix: { en: "Remove him from the words. If he appears, keep him small in the visuals.", es: "Quítalo del texto. Si aparece, que sea pequeño en los visuales." },
  },
  "results-vary": {
    explain: { en: "The piece talks about credit, reports or disputes but never says results vary.", es: "La pieza habla de crédito, reportes o disputas, pero no dice que los resultados varían." },
    fix: { en: "Add \"Results vary.\" to the caption or the on-screen text.", es: "Agrega \"Los resultados varían.\" al texto o a la pantalla." },
  },
  "monitoring-disclosure": {
    explain: { en: "It mentions credit monitoring, so it must say we earn a commission when someone subscribes.", es: "Menciona el monitoreo de crédito, así que debe decir que recibimos una comisión cuando alguien se suscribe." },
    fix: { en: `Add: "${BRAND.name} earns a commission from the monitoring service."`, es: `Agrega: "${BRAND.name} recibe una comisión del servicio de monitoreo."` },
  },
  "partner-paid": {
    explain: { en: "Partner material must say plainly whether partners are paid for referrals.", es: "El material para socios debe decir claramente si a los socios se les paga por referir." },
    fix: { en: "Add: \"The partner program pays no referral fees.\" (or the written terms, if fees are on).", es: "Agrega: \"El programa de socios no paga comisiones por referidos.\" (o los términos escritos, si hay comisiones)." },
  },
  "missing-translation": {
    explain: { en: "The piece is in both languages, but this field is written in one only.", es: "La pieza va en los dos idiomas, pero este campo está escrito en uno solo." },
    fix: { en: "Write the other version: the same claims, nothing more.", es: "Escribe la otra versión: lo mismo, nada más." },
  },
  "numbers-differ": {
    explain: { en: "The English and Spanish versions mention different numbers. They should say the same.", es: "Las versiones en inglés y español mencionan números distintos. Deben decir lo mismo." },
    fix: { en: "Check both versions say the same thing.", es: "Revisa que las dos versiones digan lo mismo." },
  },
  "long-sentence": {
    explain: { en: "A sentence over 25 words is hard to follow, more so on a phone.", es: "Una oración de más de 25 palabras cuesta seguirla, más en un teléfono." },
    fix: { en: "Split it in two.", es: "Divídela en dos." },
  },
  "empty": {
    explain: { en: "There are no words yet: a hook or a caption is needed before review.", es: "Todavía no hay texto: hace falta un gancho o un texto antes de revisar." },
    fix: { en: "Write the hook and the caption, or start from a template.", es: "Escribe el gancho y el texto, o empieza con una plantilla." },
  },
  "link-not-https": {
    explain: { en: "Every link must start with https://.", es: "Todo enlace debe empezar con https://." },
    fix: { en: "Use the https address.", es: "Usa la dirección https." },
  },
  "alt-text": {
    explain: { en: "An image has no description for people who cannot see it.", es: "Una imagen no tiene descripción para quien no puede verla." },
    fix: { en: "Describe what the picture shows in one sentence.", es: "Describe en una oración lo que muestra la imagen." },
  },
  "old-positioning": {
    explain: { en: "\"Do it yourself\" and \"Spanish-first\" describe the old product (the package's own name, Credalti DIY, is fine). Say \"in English or Spanish\".", es: "\"Hazlo tú mismo\" y \"español primero\" describen el producto anterior (el nombre del paquete, Credalti DIY, sí se puede usar). Di \"en inglés o en español\"." },
    fix: { en: "Use today's wording.", es: "Usa la forma de hoy." },
  },
};

/** The plain explanation of a rule; unknown rules (a new guardrail) still read sensibly. */
export function ruleText(rule: string): { explain: Bilingual; fix: Bilingual } {
  return (
    RULE_TEXT[rule] ?? {
      explain: { en: "It breaks one of the claim rules.", es: "Rompe una de las reglas de lo que podemos decir." },
      fix: { en: "Reword it around the process, not the outcome.", es: "Escríbelo sobre el proceso, no el resultado." },
    }
  );
}

interface TextRule {
  rule: string;
  severity: Severity;
  pattern: RegExp;
}

// Content-only rules (the website's copy tests hold the same ones for the site).
const TEXT_RULES: TextRule[] = [
  { rule: "no-free", severity: "block", pattern: /\bfree\b|\bgratis\b|\bgratuit[oa]s?\b/i },
  {
    rule: "no-outcome-words",
    severity: "block",
    pattern: /\b(deleted|removed|fixed|guaranteed|approved)\b|\b(eliminad[oa]s?|borrad[oa]s?|arreglad[oa]s?|aprobad[oa]s?|garantizad[oa]s?)\b/i,
  },
  {
    rule: "no-score-visuals",
    severity: "block",
    pattern: /\+\s?\d+\s?(pts?|points?|puntos?)\b|\b\d{3}\s?(credit\s)?(score|puntaje)|(score|puntaje)\s?(of|de)\s?\d{3}|\bbefore\s?(and|&|\/)\s?after\b|\bantes\s?(y|\/)\s?despu[eé]s\b|\b\d+\s?(points?|puntos)\b/i,
  },
  { rule: "no-price", severity: "block", pattern: /\$\s?\d[\d,.]*|\b\d+\s*(d[oó]lares|dollars|usd)\b|\bper\s+month\b|\b(al|por)\s+mes\b|\ba\s+month\b/i },
  { rule: "no-money-back", severity: "block", pattern: /money.back|refund\s+guarantee|devoluci[oó]n\s+de\s+(tu|su)\s+dinero|reembolso\s+garantizado/i },
  {
    rule: "no-pressure",
    severity: "block",
    pattern:
      /\b(act\s+now|limited\s+time|only\s+today|today\s+only|last\s+chance|hurry|don['’]t\s+wait|spots?\s+left|before\s+it['’]s\s+too\s+late|ends\s+tonight|ahora\s+mismo|solo\s+hoy|s[oó]lo\s+por\s+hoy|[uú]ltima\s+oportunidad|por\s+tiempo\s+limitado|no\s+esperes|date\s+prisa|ap[uú]rate|quedan\s+pocos|antes\s+de\s+que\s+sea\s+tarde)\b/i,
  },
  { rule: "old-positioning", severity: "warn", pattern: /(?<!Credalti\s)\bDIY\b|do.it.yourself|hazlo\s+t[uú]\s+mismo|Spanish-first|espa[nñ]ol\s+primero/i },
];

const ALTI = new RegExp(`\\b${BRAND.assistant}\\b`);
const CAMEO = new RegExp(`\\b${BRAND.cameo}\\b`, "i");
const AI_WORDS = /\bAI\b|\bIA\b|artificial intelligence|inteligencia artificial/i;
const ALTI_PERSON =
  /\bAlti\b[^.!?]{0,40}\b(real person|a person|human|teammate|employee|una persona|persona real|humano|empleado|compa[nñ]ero del equipo)\b/i;
const CREDIT_TALK = /\b(credit|report|dispute|bureau|score|letters?|inaccura\w*)\b|cr[eé]dito|reporte|disput\w*|bur[oó]s?|puntaje|\bcartas?\b|inexact\w*/i;
const RESULTS_VARY = { en: /results\s+(may\s+)?vary/i, es: /resultados\s+(pueden\s+)?var[ií]a/i } as const;
const MONITORING = /\bmonitor(ing)?\b|monitoreo/i;
const COMMISSION = { en: /commission/i, es: /comisi[oó]n/i } as const;
const PARTNER_PAID = {
  en: /referral\s+fees?|paid\s+(for\s+)?referrals?|paid\s+partner|compensat/i,
  es: /comisi[oó]n(es)?\s+por\s+referid|honorarios?\s+por\s+referid|pago\s+por\s+referid|no\s+paga\s+comisiones/i,
} as const;
const NUMBERS = /\d+(?:[.,]\d+)?/g;

function issue(rule: string, severity: Severity, field: ContentIssue["field"], lang: CopyLang | null, match: string | null): ContentIssue {
  const text = ruleText(rule);
  return { id: `${field}.${lang ?? "all"}.${rule}`, rule, severity, field, lang, match, explain: text.explain, fix: text.fix };
}

/** All of a piece's words in one language, field by field. */
export function textsOf(piece: Pick<ContentPiece, "copy" | "language">, lang: CopyLang): Array<[CopyField, string]> {
  return COPY_FIELDS.map((field) => [field, piece.copy[field][lang].trim()] as [CopyField, string]).filter(([, text]) => text.length > 0);
}

/** The words of one field: the claim rules, the content rules, and the characters. */
export function checkText(text: string, field: CopyField, lang: CopyLang, mode?: ServiceMode): ContentIssue[] {
  const out: ContentIssue[] = [];
  const seen = new Set<string>();
  const add = (i: ContentIssue) => {
    if (!seen.has(i.id)) {
      seen.add(i.id);
      out.push(i);
    }
  };
  for (const v of [...checkMarketingCopy(text, mode), ...checkClaimGuardrails(text, mode)]) add(issue(v.rule, "block", field, lang, v.match));
  for (const r of TEXT_RULES) {
    const m = text.match(r.pattern);
    if (m) add(issue(r.rule, r.severity, field, lang, m[0]));
  }
  const cameo = text.match(CAMEO);
  if (cameo) add(issue("altibot-speaks", "block", field, lang, cameo[0]));
  const person = text.match(ALTI_PERSON);
  if (person && !/\b(not|no)\b/i.test(person[0])) add(issue("alti-person", "block", field, lang, person[0]));
  // The script is read aloud, but a caption or on-screen line is read: both keep to 25 words a sentence.
  for (const long of longSentences([text])) add(issue("long-sentence", "warn", field, lang, `${long.sentence.slice(0, 60)}… (${long.words})`));
  return out;
}

/** Every issue on a piece, blocking first. */
export function checkPiece(piece: ContentPiece, mode?: ServiceMode): ContentIssue[] {
  const out: ContentIssue[] = [];
  const langs = languagesOf(piece.language);
  for (const lang of langs) {
    const texts = textsOf(piece, lang);
    for (const [field, text] of texts) out.push(...checkText(text, field, lang, mode));
    const all = texts.map(([, t]) => t).join("\n");
    if (!piece.copy.hook[lang].trim() && !piece.copy.caption[lang].trim()) out.push(issue("empty", "block", "piece", lang, null));
    // Alti looks like a person: if he appears in the words or the visuals, the piece says he is AI.
    const altiShown = piece.characters.includes("alti") || ALTI.test(all);
    if (altiShown && all.length > 0 && !AI_WORDS.test(all)) out.push(issue("alti-label", "block", "piece", lang, null));
    // Consumer pieces about credit say results vary; partner material too when it talks about the work.
    if (CREDIT_TALK.test(all) && !RESULTS_VARY[lang].test(all)) out.push(issue("results-vary", "block", "piece", lang, null));
    if (MONITORING.test(all) && !COMMISSION[lang].test(all)) out.push(issue("monitoring-disclosure", "block", "piece", lang, null));
    if ((piece.audience === "partners" || piece.type === "partner") && all.length > 0 && !PARTNER_PAID[lang].test(all)) {
      out.push(issue("partner-paid", "block", "piece", lang, null));
    }
  }
  if (piece.language === "both") {
    for (const field of COPY_FIELDS) {
      const en = piece.copy[field].en.trim();
      const es = piece.copy[field].es.trim();
      if (Boolean(en) !== Boolean(es)) out.push(issue("missing-translation", "block", field, en ? "es" : "en", null));
      if (en && es) {
        const a = [...en.matchAll(NUMBERS)].map((m) => m[0].replace(",", ".")).sort().join(" ");
        const b = [...es.matchAll(NUMBERS)].map((m) => m[0].replace(",", ".")).sort().join(" ");
        if (a !== b) out.push(issue("numbers-differ", "warn", field, null, `${a || "–"} / ${b || "–"}`));
      }
    }
  }
  for (const link of piece.links) if (!/^https:\/\//i.test(link)) out.push(issue("link-not-https", "block", "links", null, link.slice(0, 60)));
  if (IMAGE_TYPES.includes(piece.type)) {
    for (const asset of piece.assets) {
      if (isImageAsset(asset) && asset.altText.trim().length < 5) out.push({ ...issue("alt-text", "block", "assets", null, asset.name), id: `assets.${asset.id}.alt-text` });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1));
}

export function isImageAsset(asset: { mediaType: string | null; ref: string; kind: string }): boolean {
  if (asset.mediaType) return asset.mediaType.startsWith("image/");
  return asset.kind === "url" && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(asset.ref);
}

export function isVideoAsset(asset: { mediaType: string | null; ref: string; kind: string }): boolean {
  if (asset.mediaType) return asset.mediaType.startsWith("video/");
  return asset.kind === "url" && /\.(mp4|mov|webm)(\?|$)/i.test(asset.ref);
}

export function blockingIssues(issues: ContentIssue[]): ContentIssue[] {
  return issues.filter((i) => i.severity === "block");
}

// ── The checklist before approval ───────────────────────────────────────

export interface ChecklistItem {
  key: ChecklistKey;
  group: ChecklistGroup;
  /** Whether the item applies to this piece. */
  applies: boolean;
  /** "auto": the app decides from the check; "person": someone looks and ticks it. */
  mode: "auto" | "person";
  done: boolean;
  label: Bilingual;
  help: Bilingual;
}

const GROUP_OF: Record<ChecklistKey, ChecklistGroup> = {
  logo: "brand",
  colours: "brand",
  fonts: "brand",
  altiLabel: "brand",
  altibotCameo: "brand",
  resultsVary: "legal",
  monitoringDisclosure: "legal",
  partnerPaid: "legal",
  languagesMatch: "legal",
  captions: "access",
  altText: "access",
};

const CHECKLIST_TEXT: Record<ChecklistKey, { label: Bilingual; help: Bilingual }> = {
  logo: {
    label: { en: "Logo: the official file, the right version, as is", es: "Logo: el archivo oficial, la versión correcta, sin cambios" },
    help: { en: "Navy logo on light, white logo on navy. Never stretched, recoloured, on gold, or typed in a font. Clear space all round.", es: "Logo azul sobre claro, blanco sobre azul. Nunca estirado, recoloreado, sobre dorado ni escrito con una fuente. Espacio libre alrededor." },
  },
  colours: {
    label: { en: "Colours: navy, gold, light only", es: "Colores: solo azul marino, dorado y claro" },
    help: { en: "#12213A, #EFB537, #F5F6F8 and white. Gold text never on white. No green arrows, no red.", es: "#12213A, #EFB537, #F5F6F8 y blanco. Nunca texto dorado sobre blanco. Sin flechas verdes ni rojo." },
  },
  fonts: {
    label: { en: "Fonts: Poppins for headlines, Inter for text", es: "Fuentes: Poppins para títulos, Inter para texto" },
    help: { en: "Captions in Poppins 700, as the ad captions are locked.", es: "Subtítulos en Poppins 700, como están fijados en los anuncios." },
  },
  altiLabel: {
    label: { en: "Alti carries the \"AI assistant\" label", es: "Alti lleva la etiqueta \"Asistente con IA\"" },
    help: { en: "Every time he appears or speaks, on screen and in the text. Eyes open, a bit sarcastic, never edited.", es: "Cada vez que aparece o habla, en pantalla y en el texto. Ojos abiertos, un poco sarcástico, nunca editado." },
  },
  altibotCameo: {
    label: { en: "AltiBot only as a small, silent cameo", es: "AltiBot solo como cameo pequeño y sin hablar" },
    help: { en: "Small, never speaking, never the narrator or the assistant.", es: "Pequeño, nunca habla, nunca narra ni es el asistente." },
  },
  resultsVary: {
    label: { en: "Says results vary", es: "Dice que los resultados varían" },
    help: { en: "Checked by the app in each language.", es: "Lo revisa la app en cada idioma." },
  },
  monitoringDisclosure: {
    label: { en: "Monitoring commission disclosed", es: "Comisión del monitoreo indicada" },
    help: { en: "Checked by the app when monitoring is mentioned.", es: "Lo revisa la app cuando se menciona el monitoreo." },
  },
  partnerPaid: {
    label: { en: "Says whether partners are paid", es: "Dice si a los socios se les paga" },
    help: { en: "Checked by the app on partner material.", es: "Lo revisa la app en el material para socios." },
  },
  languagesMatch: {
    label: { en: "English and Spanish say the same thing", es: "Inglés y español dicen lo mismo" },
    help: { en: "Same claims, same numbers, nothing added in either. Written, not machine-translated.", es: "Lo mismo, los mismos números, nada de más en ninguno. Escrito, no traducido a máquina." },
  },
  captions: {
    label: { en: "Video has captions on screen", es: "El video lleva subtítulos en pantalla" },
    help: { en: "Burned in (Poppins 700, white with navy stroke, gold highlight) or uploaded as a caption file.", es: "Quemados (Poppins 700, blanco con borde azul, resaltado dorado) o subidos como archivo." },
  },
  altText: {
    label: { en: "Every image has alt text", es: "Cada imagen tiene texto alternativo" },
    help: { en: "Checked by the app on the files attached.", es: "Lo revisa la app en los archivos adjuntos." },
  },
};

/** The checklist for a piece, with what applies and what is done. */
export function checklistFor(piece: ContentPiece, issues: ContentIssue[] = checkPiece(piece)): ChecklistItem[] {
  const allText = (["en", "es"] as const).flatMap((lang) => textsOf(piece, lang).map(([, t]) => t)).join("\n");
  const has = (rule: string) => issues.some((i) => i.rule === rule && i.severity === "block");
  const isPartner = piece.audience === "partners" || piece.type === "partner";
  const imageAssets = piece.assets.filter(isImageAsset);
  const applies: Record<ChecklistKey, boolean> = {
    logo: true,
    colours: true,
    fonts: true,
    altiLabel: piece.characters.includes("alti") || ALTI.test(allText),
    altibotCameo: piece.characters.includes("altibot"),
    resultsVary: CREDIT_TALK.test(allText),
    monitoringDisclosure: MONITORING.test(allText),
    partnerPaid: isPartner,
    languagesMatch: piece.language === "both",
    captions: VIDEO_TYPES.includes(piece.type),
    altText: imageAssets.length > 0,
  };
  const auto: Partial<Record<ChecklistKey, boolean>> = {
    resultsVary: !has("results-vary"),
    monitoringDisclosure: !has("monitoring-disclosure"),
    partnerPaid: !has("partner-paid"),
    altText: !has("alt-text"),
  };
  return CHECKLIST_KEYS.map((key) => {
    const mode = key in auto ? "auto" : "person";
    return {
      key,
      group: GROUP_OF[key],
      applies: applies[key],
      mode,
      done: mode === "auto" ? Boolean(auto[key]) : Boolean(piece.checklist[key]),
      label: CHECKLIST_TEXT[key].label,
      help: CHECKLIST_TEXT[key].help,
    } satisfies ChecklistItem;
  });
}

/** Why a piece may not be approved yet, or [] when it may. */
export function approvalBlockers(piece: ContentPiece, issues: ContentIssue[] = checkPiece(piece)): Array<{ code: string; text: Bilingual }> {
  const out: Array<{ code: string; text: Bilingual }> = [];
  const blocking = blockingIssues(issues);
  if (blocking.length > 0) {
    out.push({
      code: "blocking_issues",
      text: {
        en: `${blocking.length} ${blocking.length === 1 ? "issue blocks" : "issues block"} approval. Fix ${blocking.length === 1 ? "it" : "them"} first.`,
        es: `${blocking.length} ${blocking.length === 1 ? "problema impide" : "problemas impiden"} aprobar. Corrígelo${blocking.length === 1 ? "" : "s"} primero.`,
      },
    });
  }
  const open = checklistFor(piece, issues).filter((item) => item.applies && !item.done && item.mode === "person");
  if (open.length > 0) {
    out.push({
      code: "checklist_open",
      text: { en: `${open.length} checklist ${open.length === 1 ? "item is" : "items are"} not ticked.`, es: `Faltan ${open.length} ${open.length === 1 ? "punto" : "puntos"} de la lista por marcar.` },
    });
  }
  return out;
}
