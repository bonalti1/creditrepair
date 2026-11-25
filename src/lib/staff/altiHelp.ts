import type { IconName } from "@/components/Icon";
import type { StaffLocale } from "./i18n/locale";
import { defineText } from "./i18n/text";
import type { NavGroupKey } from "./nav";
import type { Capability } from "./permissions";
import { HOUSE_RULE_TEXT, PLAYBOOKS, SCREEN_HELPS } from "./playbook";

// «Ask Alti», the helper in every section of the console (ALTO Control's
// per-tab bot, TabBot). ALTO's bot is a chat with its own access; Credalti's
// helper only points at what already exists, and never writes an answer of
// its own:
//
//   - «This screen»: the screen's help and its «How to handle it» cards
//     (src/lib/staff/playbook.ts, written by the team).
//   - «What Alti does here»: the AI features this section already has, each
//     with where it lives and who has the last word: the drafted replies
//     (staff/drafts.ts, checked by checkStaffReply and draftProblems), the
//     saved answers Alti sends by himself (staff/answers.ts, checked again),
//     the lead drafts and the lead autopilot (leads/, fixed or approved text
//     only, off until an administrator turns it on), the content writing
//     assistant (content/assist.ts) and the ad copy drafts (ads/copy.ts). Only
//     the ones the member's role may use.
//   - «Search the playbook»: the team's written help, searched by words. It
//     finds what the team wrote; it never makes up a sentence, so nothing here
//     needs the claim rules (src/lib/compliance/guardrails.ts) beyond what the
//     playbook already passes.

export type AltiJobGate = "draft" | "approved" | "fixed" | "words" | "proposal";

export interface AltiJob {
  id: string;
  icon: IconName;
  /** The capability the feature itself asks; the job shows only with it. */
  needs: Capability;
  href: string;
  gate: AltiJobGate;
}

const JOBS: Partial<Record<NavGroupKey, AltiJob[]>> = {
  day: [{ id: "client_draft_focus", icon: "sparkle", needs: "clients.reply", href: "/equipo?siguiente=1", gate: "draft" }],
  leads: [
    { id: "lead_suggest", icon: "sparkle", needs: "leads.work", href: "/equipo/leads?filtro=waiting", gate: "draft" },
    { id: "lead_autopilot", icon: "clock", needs: "leads.work", href: "/equipo/leads?vista=autopilot", gate: "fixed" },
  ],
  clients: [
    { id: "client_draft", icon: "sparkle", needs: "clients.reply", href: "/equipo/clientes?aviso=question_waiting", gate: "draft" },
    { id: "saved_answers", icon: "chat", needs: "clients.reply", href: "/equipo/respuestas", gate: "approved" },
  ],
  content: [
    { id: "content_words", icon: "doc", needs: "content.edit", href: "/equipo/contenido", gate: "words" },
    { id: "video_script", icon: "video", needs: "content.edit", href: "/equipo/video", gate: "words" },
    // The Ads Manager (src/lib/ads/copy.ts): ad copy drafts, checked against the claim rules and the credit ad checklist.
    { id: "ad_copy", icon: "megaphone", needs: "ads.draft", href: "/equipo/anuncios?vista=textos", gate: "draft" },
    // SEO (src/lib/seo/draft.ts): a guide's outline and article, a draft a person edits and an administrator publishes.
    { id: "seo_guide_draft", icon: "sparkle", needs: "seo.edit", href: "/equipo/seo?vista=guias", gate: "draft" },
  ],
  // Ideas (src/lib/ideas, docs/IDEAS.md): experiments proposed from the console's own numbers, for an administrator to add or dismiss.
  business: [{ id: "ideas_proposals", icon: "bulb", needs: "ideas.approve", href: "/equipo/ideas?vista=alti", gate: "proposal" }],
};

/** What Alti already does in this section, for this member. */
export function altiJobs(group: NavGroupKey, can: (c: Capability) => boolean): AltiJob[] {
  return (JOBS[group] ?? []).filter((job) => can(job.needs));
}

export const ALTI_HELP_TEXT = defineText({
  en: {
    tabs: { screen: "This screen", jobs: "What Alti does here", search: "Search the playbook" },
    sectionHelp: (section: string) => `Help for ${section}`,
    intro: "I point you to the team's help and to what I already do on this screen. I don't send anything, and a person has the last word.",
    jobsIntro: "My AI features in this section. Everything I write is a draft a person reads, or approved text, and passes the claim rules first.",
    noJobs: "I have no job in this section yet. Its help is under «This screen», and the playbook is one tab over.",
    open: "Open",
    gates: {
      draft: "A draft · a person sends it",
      approved: "Approved text only · checked again",
      fixed: "Off until an administrator turns it on",
      words: "Words only · a person saves them",
      proposal: "A proposal · a person decides",
    },
    jobs: {
      client_draft_focus: {
        title: "Draft replies to clients' questions",
        desc: "In focus mode («Next»), a waiting question opens with my draft or the matching saved answer. You read it, edit it and send it.",
      },
      lead_suggest: {
        title: "Suggest a reply to a lead",
        desc: "Open a waiting conversation and tap «Suggest reply». I write from the facts only; the draft is checked and nothing goes out until a person sends it.",
      },
      lead_autopilot: {
        title: "Lead autopilot",
        desc: "When an administrator turns it on, I greet new leads on WhatsApp and answer from the approved FAQ, word for word. Anything else goes to a person.",
      },
      client_draft: {
        title: "Draft replies to clients' questions",
        desc: "A client's conversation opens with my draft when a question is waiting, written from what your role may see. Read it, edit it, send it.",
      },
      saved_answers: {
        title: "Send approved saved answers",
        desc: "When a client's question closely matches an approved answer, I send it in the app's chat after checking it again. Proposals are never sent.",
      },
      content_words: {
        title: "Write a piece's words",
        desc: "Open a piece and use my writing assistant: hooks, script and caption in English and Spanish, checked against the claim and brand rules. A person edits, saves and asks for approval.",
      },
      ad_copy: {
        title: "Draft Meta ad copy",
        desc: "In Ads, «Ad copy»: hooks, headline, primary text and a video script in English and Spanish, checked against the claim rules and the credit ad checklist (no promised results, never “free”, no age, gender or ZIP code). A person edits it and sends it to Content or Video Studio; nothing reaches Meta.",
      },
      seo_guide_draft: {
        title: "Draft a guide for the website",
        desc: "In SEO → Guides, give me the topic, the brief and the search phrase: I write the outline and the guide in English and Spanish, with an official source for every legal fact. It passes the claim rules; a person checks the sources and an administrator publishes it.",
      },
      ideas_proposals: {
        title: "Propose experiments from the numbers",
        desc: "Tap “Ask Alti for ideas”: I read the dashboard, the lead inbox and content, and propose a few tests, each with the figures it is based on, the metric to watch and a length. An administrator adds them to the board or dismisses them.",
      },
      video_script: {
        title: "Draft a video's script and shots",
        desc: "In the Video Studio, open a video's plan and ask for a draft: from the brief I write a script, a shot list and the post's words, checked against the claim rules. A person edits it and saves it; the video is approved by an administrator.",
      },
    },
    searchLabel: "Search the team's playbook",
    searchPlaceholder: "e.g. returned letter, missing documents",
    searchNote: "These are the team's own written steps, found by your words. I don't write new answers here.",
    suggested: "On this screen",
    fromPlaybook: "From the team's playbook",
    fromScreen: "Screen help",
    fromRules: "House rules",
    fromLearnings: "From a finished test",
    noResults: "Nothing in the playbook matches those words. Try other words, or ask an administrator.",
    doneWhen: "Done when:",
    welcome: "Welcome: the screens, the rules and the 5-minute tour",
  },
  es: {
    tabs: { screen: "Esta pantalla", jobs: "Lo que hace Alti aquí", search: "Buscar en la guía" },
    sectionHelp: (section: string) => `Ayuda para ${section}`,
    intro: "Te llevo a la ayuda del equipo y a lo que ya hago en esta pantalla. No envío nada, y la última palabra es de una persona.",
    jobsIntro: "Mis funciones con IA en esta sección. Todo lo que escribo es un borrador que lee una persona, o texto aprobado, y pasa antes las reglas de lo que se puede decir.",
    noJobs: "Todavía no tengo trabajo en esta sección. Su ayuda está en «Esta pantalla», y la guía en la pestaña de al lado.",
    open: "Abrir",
    gates: {
      draft: "Un borrador · lo envía una persona",
      approved: "Solo texto aprobado · se revisa otra vez",
      fixed: "Apagado hasta que un administrador lo encienda",
      words: "Solo palabras · las guarda una persona",
      proposal: "Una propuesta · decide una persona",
    },
    jobs: {
      client_draft_focus: {
        title: "Borradores para las preguntas de clientes",
        desc: "En el modo «Siguiente», una pregunta en espera abre con mi borrador o con la respuesta guardada que coincide. Tú la lees, la editas y la envías.",
      },
      lead_suggest: {
        title: "Sugerir una respuesta a un prospecto",
        desc: "Abre una conversación en espera y toca «Sugerir respuesta». Escribo solo con los datos; el borrador se revisa y nada sale hasta que una persona lo envía.",
      },
      lead_autopilot: {
        title: "Piloto automático de prospectos",
        desc: "Cuando un administrador lo enciende, saludo a los prospectos nuevos por WhatsApp y contesto con las preguntas frecuentes aprobadas, palabra por palabra. Lo demás pasa a una persona.",
      },
      client_draft: {
        title: "Borradores para las preguntas de clientes",
        desc: "La conversación de un cliente abre con mi borrador cuando hay una pregunta en espera, escrito con lo que tu rol puede ver. Léelo, edítalo, envíalo.",
      },
      saved_answers: {
        title: "Enviar respuestas guardadas aprobadas",
        desc: "Cuando la pregunta de un cliente se parece mucho a una respuesta aprobada, la envío en el chat de la app después de revisarla otra vez. Las propuestas nunca se envían.",
      },
      ideas_proposals: {
        title: "Proponer pruebas a partir de los números",
        desc: "Toca «Pedirle ideas a Alti»: leo el tablero, la bandeja de prospectos y el contenido, y propongo algunas pruebas, cada una con las cifras en que se basa, el número a vigilar y la duración. Un administrador las agrega al tablero o las descarta.",
      },
      content_words: {
        title: "Escribir las palabras de una pieza",
        desc: "Abre una pieza y usa mi asistente de escritura: ganchos, guion y texto en inglés y español, revisados con las reglas de lo que se puede decir y de la marca. Una persona edita, guarda y pide la aprobación.",
      },
      ad_copy: {
        title: "Borradores de textos para anuncios de Meta",
        desc: "En Anuncios, «Textos con Alti»: ganchos, título, texto principal y guion de video en inglés y español, revisados con las reglas de lo que se puede decir y la lista para anuncios de crédito (sin resultados prometidos, nunca «gratis», sin edad, género ni código postal). Una persona lo edita y lo manda a Contenido o a Video Studio; nada llega a Meta.",
      },
      seo_guide_draft: {
        title: "Borrador de una guía para el sitio",
        desc: "En SEO → Guías, dame el tema, el encargo y la frase de búsqueda: escribo el esquema y la guía en inglés y español, con una fuente oficial para cada dato legal. Pasa las reglas de lo que se puede decir; una persona revisa las fuentes y un administrador la publica.",
      },
      video_script: {
        title: "Borrador del guion y las tomas de un video",
        desc: "En el Estudio de video, abre el plan de un video y pide un borrador: con el brief escribo un guion, una lista de tomas y el texto de la publicación, revisados con las reglas. Una persona lo edita y lo guarda; un administrador aprueba el video.",
      },
    },
    searchLabel: "Buscar en la guía del equipo",
    searchPlaceholder: "p. ej. carta devuelta, faltan documentos",
    searchNote: "Son los pasos que escribió el equipo, encontrados con tus palabras. Aquí no escribo respuestas nuevas.",
    suggested: "En esta pantalla",
    fromPlaybook: "De la guía del equipo",
    fromScreen: "Ayuda de pantalla",
    fromRules: "Reglas de la casa",
    fromLearnings: "De una prueba terminada",
    noResults: "Nada en la guía coincide con esas palabras. Prueba con otras, o pregúntale a un administrador.",
    doneWhen: "Listo cuando:",
    welcome: "Bienvenida: las pantallas, las reglas y el recorrido de 5 minutos",
  },
});

// ── The playbook search ─────────────────────────────────────────────────

export interface PlaybookHit {
  id: string;
  kind: "card" | "screen" | "rule" | "learning";
  title: string;
  lines: string[];
  doneWhen?: string;
  score: number;
}

/** Lowercase, no accents, words of three letters or more. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** A word matches the same word or one that starts with it ("letter" finds "letters"). */
function hits(query: string[], text: string[]): number {
  let n = 0;
  for (const q of query) if (text.some((w) => w === q || w.startsWith(q) || (w.length >= 5 && q.startsWith(w)))) n += 1;
  return n;
}

/** A finished test from the learnings library (src/lib/ideas), written by the team. */
export interface LearningEntry {
  id: string;
  title: string;
  lines: string[];
}

/**
 * The team's written help that shares the most words with the query, best
 * first, and the learnings of finished tests when the caller passes them (the
 * team wrote those too). Empty query: nothing.
 */
export function searchPlaybook(query: string, locale: StaffLocale, limit = 6, learnings: readonly LearningEntry[] = []): PlaybookHit[] {
  const q = [...new Set(words(query))];
  if (q.length === 0) return [];
  const entries: Omit<PlaybookHit, "score">[] = [
    ...Object.entries(PLAYBOOKS[locale]).map(([kind, card]) => ({ id: `card:${kind}`, kind: "card" as const, title: card.title, lines: card.steps, doneWhen: card.doneWhen })),
    ...Object.entries(SCREEN_HELPS[locale]).map(([path, help]) => ({ id: `screen:${path}`, kind: "screen" as const, title: help.title, lines: [help.what, ...help.steps] })),
    ...HOUSE_RULE_TEXT[locale].map((rule, i) => ({ id: `rule:${i}`, kind: "rule" as const, title: rule, lines: [] })),
    ...learnings.map((l) => ({ id: `learning:${l.id}`, kind: "learning" as const, title: l.title, lines: l.lines })),
  ];
  return entries
    .map((entry) => {
      const title = hits(q, words(entry.title));
      const body = hits(q, words([...entry.lines, entry.doneWhen ?? ""].join(" ")));
      // Every word must appear somewhere; a word in the title counts double.
      const covered = hits(q, words([entry.title, ...entry.lines, entry.doneWhen ?? ""].join(" ")));
      return { ...entry, score: covered === q.length ? title * 2 + body : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
