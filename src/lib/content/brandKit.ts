import lock from "../../../content/brand/lock.json";
import { aiByline, APP_ICONS, BRAND, LOGO_CLEAR_SPACE } from "../brand";
import type { Bilingual } from "./types";

// The brand kit page (/equipo/contenido/marca): one place a designer or a VA
// learns the brand. Everything is read from the sources of truth, never
// copied by hand: the names, logo files, characters and icons from
// src/lib/brand.ts; the ad captions, end card and hook from
// content/brand/lock.json; the colours are the @theme tokens of
// src/app/globals.css (a test checks every hex below against the CSS); the
// rules are docs/BRAND.md's and docs/WEBSITE.md's, in plain words.

export interface KitColour {
  name: Bilingual;
  token: string;
  hex: string;
  use: Bilingual;
}

/** The brand colours (brand colors v2, 2026-11-21), as the @theme tokens hold them. */
export const KIT_COLOURS: KitColour[] = [
  { name: { en: "Navy", es: "Azul marino" }, token: "blue-900 / blue-700", hex: "#12213A", use: { en: "Dark backgrounds, headings, links, text on gold, the logo's wordmark on light.", es: "Fondos oscuros, títulos, enlaces, texto sobre dorado, el logo sobre claro." } },
  { name: { en: "Navy light", es: "Azul marino claro" }, token: "blue-800", hex: "#2E3C52", use: { en: "Panels and cards on dark; the top of the hero gradient.", es: "Paneles y tarjetas sobre oscuro; la parte alta del degradado." } },
  { name: { en: "Gold", es: "Dorado" }, token: "amber-400", hex: "#EFB537", use: { en: "The check, accents, primary buttons (with navy text).", es: "El check, acentos, botones principales (con texto azul)." } },
  { name: { en: "Light", es: "Claro" }, token: "slate-50", hex: "#F5F6F8", use: { en: "The page background.", es: "El fondo de la página." } },
  { name: { en: "White", es: "Blanco" }, token: "white", hex: "#FFFFFF", use: { en: "Text on navy; the logo's wordmark on dark.", es: "Texto sobre azul; el logo sobre oscuro." } },
  { name: { en: "Gold text on light", es: "Texto dorado sobre claro" }, token: "amber-700", hex: "#8A5C08", use: { en: "Gold-toned words on white or light (status words, warnings).", es: "Palabras en tono dorado sobre blanco o claro (estados, avisos)." } },
];

/** Relative luminance (WCAG 2.x). */
export function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 10) / 10;
}

export interface KitPair {
  fg: string;
  bg: string;
  ratio: number;
  ok: boolean;
  note: Bilingual;
}

const pair = (fg: string, bg: string, min: number, note: Bilingual): KitPair => {
  const ratio = contrastRatio(fg, bg);
  return { fg, bg, ratio, ok: ratio >= min, note };
};

/** The pairs a designer uses, with their contrast (WCAG 2.x: 4.5 for text, 3 for large text and icons). */
export const KIT_CONTRAST: KitPair[] = [
  pair("#12213A", "#FFFFFF", 4.5, { en: "Navy text on white: any size.", es: "Texto azul sobre blanco: cualquier tamaño." }),
  pair("#12213A", "#F5F6F8", 4.5, { en: "Navy text on the light background.", es: "Texto azul sobre el fondo claro." }),
  pair("#FFFFFF", "#12213A", 4.5, { en: "White text on navy.", es: "Texto blanco sobre azul." }),
  pair("#12213A", "#EFB537", 4.5, { en: "Navy text on a gold button. Never white on gold.", es: "Texto azul sobre botón dorado. Nunca blanco sobre dorado." }),
  pair("#EFB537", "#12213A", 4.5, { en: "Gold accent words on navy.", es: "Palabras doradas sobre azul." }),
  pair("#8A5C08", "#FFFFFF", 4.5, { en: "Gold-toned text on white: use this, not gold.", es: "Texto en tono dorado sobre blanco: usa este, no el dorado." }),
  pair("#EFB537", "#FFFFFF", 4.5, { en: "Gold on white: never as text (it fails).", es: "Dorado sobre blanco: nunca como texto (no se lee)." }),
];

export interface KitLogo {
  file: string;
  name: Bilingual;
  on: "light" | "dark";
  use: Bilingual;
  width: number;
  height: number;
}

export const KIT_LOGOS: KitLogo[] = [
  { file: BRAND.logo.onLight.src, name: { en: "Logo, navy", es: "Logo, azul" }, on: "light", use: { en: "On white and light backgrounds.", es: "Sobre fondos blancos y claros." }, width: BRAND.logo.onLight.width, height: BRAND.logo.onLight.height },
  { file: BRAND.logo.onDark.src, name: { en: "Logo, white", es: "Logo, blanco" }, on: "dark", use: { en: "On navy and other dark backgrounds.", es: "Sobre azul y otros fondos oscuros." }, width: BRAND.logo.onDark.width, height: BRAND.logo.onDark.height },
  { file: BRAND.logo.check.src, name: { en: "The check alone", es: "El check solo" }, on: "light", use: { en: "Square spaces only (an avatar). There is no wordmark without the check.", es: "Solo en espacios cuadrados (un avatar). No hay nombre sin el check." }, width: BRAND.logo.check.width, height: BRAND.logo.check.height },
];

export const LOGO_CLEAR_SPACE_SHARE = LOGO_CLEAR_SPACE;

export const LOGO_DO: Bilingual[] = [
  { en: "Use the files as they are, scaled evenly.", es: "Usa los archivos tal cual, a escala pareja." },
  { en: "Leave clear space of at least the height of the \"C\" (about half the logo's height) on every side.", es: "Deja espacio libre de al menos la altura de la \"C\" (como la mitad del alto del logo) en cada lado." },
  { en: "Navy logo on light, white logo on navy.", es: "Logo azul sobre claro, logo blanco sobre azul." },
];

export const LOGO_DONT: Bilingual[] = [
  { en: "Don't recolour, outline, stretch, rotate or rearrange it.", es: "No lo recolorees, delinees, estires, gires ni reordenes." },
  { en: "Don't type \"Credalti\" in a font to imitate it.", es: "No escribas \"Credalti\" con una fuente para imitarlo." },
  { en: "Don't put it on gold: the check disappears.", es: "No lo pongas sobre dorado: el check desaparece." },
  { en: "No filters, shadows or blend modes on it. No old gauge mark.", es: "Sin filtros, sombras ni mezclas. Nada del medidor viejo." },
];

export const KIT_FONTS: Array<{ name: string; role: Bilingual; weights: string; sample: Bilingual; display: boolean }> = [
  { name: "Poppins", role: { en: "Headlines, captions on video, the end card", es: "Títulos, subtítulos en video, la tarjeta final" }, weights: "600, 700", sample: { en: "Your credit, with a team by your side.", es: "Tu crédito, con un equipo a tu lado." }, display: true },
  { name: "Inter", role: { en: "Body text, interface, small print", es: "Texto, interfaz, letra pequeña" }, weights: "400, 500, 600", sample: { en: "You tell us what is wrong. Our team prepares and mails the letters.", es: "Tú nos dices qué está mal. Nuestro equipo prepara y envía las cartas." }, display: false },
];

export const FONT_RULES: Bilingual[] = [
  { en: "Only these weights: nothing heavier than Poppins 700, body text up to Inter 600.", es: "Solo estos pesos: nada más grueso que Poppins 700; el texto hasta Inter 600." },
  { en: "No italic headlines. Numbers line up (tabular figures) in tables.", es: "Sin títulos en cursiva. Los números alineados (tabulares) en tablas." },
  { en: "Never use either font to imitate the logo.", es: "Nunca uses ninguna fuente para imitar el logo." },
];

export const ALTI_RULES: Bilingual[] = [
  { en: `Alti is the AI assistant. Every time he appears or speaks, label him "${aiByline("en")}" on screen.`, es: `Alti es el asistente con IA. Cada vez que aparece o habla, va con la etiqueta "${aiByline("es")}" en pantalla.` },
  { en: "He is never a person, an employee, a lawyer or a particular teammate.", es: "Nunca es una persona, un empleado, un abogado ni alguien del equipo." },
  { en: "Eyes open, one eyebrow slightly up, a small smirk: awake, a bit sarcastic. Never droopy, never wide-eyed.", es: "Ojos abiertos, una ceja un poco arriba, media sonrisa: despierto, algo sarcástico. Nunca ojos caídos ni muy abiertos." },
  { en: "Use the files as delivered, only scaled: never edit, recolour, re-crop or regenerate him.", es: "Usa los archivos tal cual, solo a escala: nunca lo edites, recolorees, recortes ni regeneres." },
  { en: "Place him on navy or ivory/white. On very dark or saturated colours a light rim can show.", es: "Ponlo sobre azul o marfil/blanco. Sobre colores muy oscuros o saturados puede verse un borde claro." },
  { en: "Motion moves the whole picture only (a bob, a sway, the waving loop), never the drawing.", es: "El movimiento mueve la imagen entera (balanceo, saludo animado), nunca el dibujo." },
];

export const ALTIBOT_RULES: Bilingual[] = [
  { en: `${BRAND.cameo}, the robot, is a small cameo only: never the assistant, never speaking, never the narrator.`, es: `${BRAND.cameo}, el robot, es solo un cameo pequeño: nunca el asistente, nunca habla, nunca narra.` },
  { en: "Never named in the copy. If he appears, keep him small, beside Alti or carrying an envelope.", es: "Nunca se nombra en el texto. Si aparece, que sea pequeño, junto a Alti o llevando un sobre." },
];

export const VOICE_RULES: Array<{ title: Bilingual; body: Bilingual }> = [
  { title: { en: "Process, never outcome", es: "Proceso, nunca resultado" }, body: { en: "Say what we do: prepare and mail letters, explain, keep you posted. Never what will happen to a report or a score.", es: "Di lo que hacemos: preparar y enviar cartas, explicar, mantenerte al tanto. Nunca lo que le pasará a un reporte o puntaje." } },
  { title: { en: "The client decides", es: "El cliente decide" }, body: { en: "\"You tell us what is wrong on your report.\" Never that we pick, or that everything negative is disputed.", es: "\"Tú nos dices qué está mal en tu reporte.\" Nunca que nosotros elegimos, ni que se disputa todo lo negativo." } },
  { title: { en: "Plain, warm, a little wry", es: "Simple, cálido, un poco irónico" }, body: { en: "Short sentences (25 words at most), everyday words, no jargon. Calm, never salesy. Respect: no jokes about debt, mistakes, income, language or where someone is from.", es: "Oraciones cortas (25 palabras como máximo), palabras de todos los días, sin jerga. Tranquilo, nunca vendedor. Respeto: sin bromas sobre deudas, errores, ingresos, idioma u origen." } },
  { title: { en: "English first, Spanish too", es: "Inglés primero, español también" }, body: { en: "Say \"in English or Spanish\". Write the Spanish, don't translate it word for word; both say the same thing and nothing more.", es: "Di \"en inglés o en español\". Escribe el español, no lo traduzcas palabra por palabra; los dos dicen lo mismo y nada más." } },
  { title: { en: "No price in the copy", es: "Sin precios en el texto" }, body: { en: "\"Our team explains the plan.\" Amounts live only on the pricing page.", es: "\"Nuestro equipo te explica el plan.\" Los montos están solo en la página de precios." } },
];

export const APPROVED_LINES: Bilingual[] = [
  { en: "Your credit, with a team by your side.", es: "Tu crédito, con un equipo a tu lado." },
  { en: "You tell us what is wrong. We mail the letters.", es: "Tú nos dices qué está mal. Nosotros enviamos las cartas." },
  { en: "Results vary.", es: "Los resultados varían." },
];

export const CLAIM_RULES: Array<{ rule: Bilingual; why: Bilingual }> = [
  { rule: { en: "No promises", es: "Sin promesas" }, why: { en: "Nothing about items coming off, scores going up, points, dates or approvals. The bureaus and lenders decide.", es: "Nada de que algo sale, que el puntaje sube, puntos, fechas o aprobaciones. Deciden los burós y los prestamistas." } },
  { rule: { en: "No score visuals", es: "Sin visuales de puntaje" }, why: { en: "No dials, gauges, score numbers, before/after or green arrows, unless the owner approves a specific asset.", es: "Sin diales, medidores, números de puntaje, antes/después ni flechas verdes, salvo un archivo que apruebe el dueño." } },
  { rule: { en: "Never \"free\"", es: "Nunca \"gratis\"" }, why: { en: "The service is paid and monitoring is paid to the provider. \"At no cost\" only for disputing on your own, cancelling in 3 business days, or ending the service.", es: "El servicio se paga y el monitoreo se le paga al proveedor. \"Sin costo\" solo para disputar por tu cuenta, cancelar en 3 días hábiles o terminar el servicio." } },
  { rule: { en: "Results vary", es: "Los resultados varían" }, why: { en: "Every piece that talks about credit, reports or disputes says so, in each language.", es: "Toda pieza que habla de crédito, reportes o disputas lo dice, en cada idioma." } },
  { rule: { en: "The client decides what is inaccurate", es: "El cliente decide qué es inexacto" }, why: { en: "We dispute only what the client says is wrong, with their consent.", es: "Solo disputamos lo que el cliente dice que está mal, con su permiso." } },
  { rule: { en: "No pressure", es: "Sin presión" }, why: { en: "No \"act now\", \"last chance\" or countdowns. Nobody is pushed to sign.", es: "Sin \"actúa ya\", \"última oportunidad\" ni cuentas regresivas. A nadie se le presiona." } },
  { rule: { en: "Say who is paid", es: "Di quién recibe pago" }, why: { en: "Mention monitoring → say we earn a commission. Partner material → say whether partners are paid.", es: "Si mencionas el monitoreo, di que recibimos una comisión. En material para socios, di si a los socios se les paga." } },
];

export const KIT_SPECS = {
  captions: lock.captions,
  endCard: lock.endCard,
  hook: lock.hook,
  look: lock.look,
};

export interface KitDownload {
  file: string;
  name: Bilingual;
  kind: "svg" | "png" | "webp";
}

export const KIT_DOWNLOADS: KitDownload[] = [
  ...KIT_LOGOS.map((l) => ({ file: l.file, name: l.name, kind: "svg" as const })),
  ...APP_ICONS.manifestIcons.map((icon) => ({ file: icon.src, name: { en: `App icon ${icon.sizes}${"purpose" in icon ? " (maskable)" : ""}`, es: `Ícono de la app ${icon.sizes}${"purpose" in icon ? " (adaptable)" : ""}` }, kind: "png" as const })),
  { file: BRAND.assistantImages.front.src2x, name: { en: "Alti, front (@2x)", es: "Alti, de frente (@2x)" }, kind: "webp" },
  { file: BRAND.assistantImages.threeQuarter.src2x, name: { en: "Alti, three-quarter (@2x)", es: "Alti, tres cuartos (@2x)" }, kind: "webp" },
  { file: BRAND.assistantImages.headFront.src2x, name: { en: "Alti, head (@2x)", es: "Alti, cabeza (@2x)" }, kind: "webp" },
  ...(Object.entries(BRAND.assistantPoses) as Array<[string, { src2x: string }]>).map(([pose, image]) => ({ file: image.src2x, name: { en: `Alti, ${pose} pose (@2x)`, es: `Alti, pose ${pose} (@2x)` }, kind: "webp" as const })),
  { file: "/brand/characters/alti_wave_loop.webp", name: { en: "Alti, waving loop (animated)", es: "Alti, saludo animado" }, kind: "webp" },
];

export const POSE_LABEL: Record<string, Bilingual> = {
  wave: { en: "Wave: hello, openings", es: "Saludo: hola, aperturas" },
  phone: { en: "Phone: the app (the screen shows only checkmarks)", es: "Teléfono: la app (la pantalla solo muestra checks)" },
  thumbsUp: { en: "Thumbs up: a step done", es: "Pulgar arriba: un paso hecho" },
  thinking: { en: "Thinking: questions, myths, the FAQ", es: "Pensando: preguntas, mitos, preguntas frecuentes" },
  envelope: { en: "Envelope: letters, mailing", es: "Sobre: cartas, envíos" },
  celebrate: { en: "Celebrate: a finished step, never a promised result", es: "Celebra: un paso terminado, nunca un resultado prometido" },
};
