import { aiByline } from "../brand";
import { checkPiece, checkText, ruleText, type ContentIssue } from "../content/check";
import { emptyCopy, type Bilingual, type ContentPiece, type CopyField } from "../content/types";
import { currentExport } from "./hash";
import { bodyDuration, tooFastToRead } from "./timeline";
import type { MusicTrack, VideoChecklistKey, VideoProject } from "./types";

// The check every video passes before it can be approved (docs/VIDEO.md).
// Every word a viewer will read or hear goes through the same rules as every
// Content piece (content/check.ts: checkMarketingCopy and
// checkClaimGuardrails from src/lib/compliance/guardrails.ts, nothing called
// free, no outcome words, no score visuals, no price, no pressure, Alti always
// AI, results vary): each title and lower third, each caption, the intro and
// end cards, the script, the hook and the post's words. On top of that:
// Texas only (never Georgia), the music's rights on record, a client only
// with written consent on record, and a person's ticks for what words can't
// show (rights to the footage, no score on screen, captions that match).

export type VideoField = "hook" | "script" | "postCaption" | "cta" | "overlay" | "caption" | "intro" | "outro";

export interface VideoIssue {
  /** Stable per rule, field, item: "caption.cc_x1.no-free". */
  id: string;
  rule: string;
  severity: "block" | "warn";
  field: VideoField | "video";
  /** The overlay's or caption's id, when the issue is in one of them. */
  itemId: string | null;
  match: string | null;
  explain: Bilingual;
  fix: Bilingual;
}

const VIDEO_RULE_TEXT: Record<string, { explain: Bilingual; fix: Bilingual }> = {
  "texas-only": {
    explain: { en: "Credalti serves Texas only. Naming another state (Georgia above all) suggests we work there.", es: "Credalti atiende solo en Texas. Nombrar otro estado (sobre todo Georgia) sugiere que trabajamos ahí." },
    fix: { en: "Say Texas, or no state at all.", es: "Di Texas, o ningún estado." },
  },
  "other-state": {
    explain: { en: "It names a state other than Texas. Check it doesn't sound like we serve it.", es: "Nombra un estado que no es Texas. Revisa que no parezca que lo atendemos." },
    fix: { en: "Keep to Texas unless the state is only an example.", es: "Quédate en Texas salvo que el estado sea solo un ejemplo." },
  },
  "too-fast": {
    explain: { en: "This caption is on screen too briefly to read (more than 20 letters a second).", es: "Este subtítulo está muy poco tiempo para leerlo (más de 20 letras por segundo)." },
    fix: { en: "Give it more time, or split it in two.", es: "Dale más tiempo, o divídelo en dos." },
  },
  "caption-after-end": {
    explain: { en: "This caption starts after the clips end, so nobody would see it.", es: "Este subtítulo empieza después de que terminan los clips; nadie lo vería." },
    fix: { en: "Move it earlier or delete it.", es: "Muévelo antes o bórralo." },
  },
  "overlay-after-end": {
    explain: { en: "These words start after the clips end, so nobody would see them.", es: "Estas palabras empiezan después de que terminan los clips; nadie las vería." },
    fix: { en: "Move them earlier or delete them.", es: "Muévelas antes o bórralas." },
  },
  "music-rights": {
    explain: { en: "The music has no rights confirmation on record. We only use music the team has the rights to.", es: "La música no tiene confirmados los derechos. Solo usamos música con derechos del equipo." },
    fix: { en: "Pick a track from the music library (each one has its rights recorded), or no music.", es: "Elige una pista de la biblioteca de música (cada una tiene sus derechos registrados), o sin música." },
  },
  "client-question": {
    explain: { en: "Nobody has answered whether a client appears (face, voice or name).", es: "Nadie ha respondido si aparece un cliente (cara, voz o nombre)." },
    fix: { en: "Answer it in the checklist.", es: "Respóndelo en la lista." },
  },
  "client-consent": {
    explain: { en: "A client appears, but there is no written consent on record. A client's face or name goes out only with it.", es: "Aparece un cliente, pero no hay consentimiento por escrito registrado. La cara o el nombre de un cliente sale solo con él." },
    fix: { en: "Record the signed consent (who, when, where it's kept), or take the client out.", es: "Registra el consentimiento firmado (quién, cuándo, dónde se guarda), o saca al cliente." },
  },
  "no-clips": {
    explain: { en: "The timeline is empty.", es: "La línea de tiempo está vacía." },
    fix: { en: "Add clips or pictures in the editor.", es: "Agrega clips o fotos en el editor." },
  },
  "no-export": {
    explain: { en: "There is no export of this exact version. The file that is approved is the file that goes out.", es: "No hay una exportación de esta versión exacta. El archivo aprobado es el que se publica." },
    fix: { en: "Export the MP4 again after the last change.", es: "Exporta el MP4 otra vez después del último cambio." },
  },
};

export function videoRuleText(rule: string): { explain: Bilingual; fix: Bilingual } {
  return VIDEO_RULE_TEXT[rule] ?? ruleText(rule);
}

const GEORGIA = /\bgeorgia\b/i;
const OTHER_STATES =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|utah|vermont|virginia|washington|wisconsin|wyoming|carolina\s+del\s+(norte|sur)|nuevo\s+m[eé]xico|nueva\s+york|florida)\b/i;

function issue(rule: string, severity: "block" | "warn", field: VideoIssue["field"], itemId: string | null, match: string | null): VideoIssue {
  const text = videoRuleText(rule);
  return { id: `${field}.${itemId ?? "all"}.${rule}`, rule, severity, field, itemId, match, explain: text.explain, fix: text.fix };
}

/** The same field names the Content check uses, so its explanations read right. */
const COPY_FIELD: Record<VideoField, CopyField> = {
  hook: "hook",
  script: "script",
  postCaption: "caption",
  cta: "cta",
  overlay: "onScreen",
  caption: "onScreen",
  intro: "onScreen",
  outro: "onScreen",
};

/** Every piece of words in the video: what is read on screen, heard, or posted with it. */
export function videoTexts(project: Pick<VideoProject, "brief" | "plan" | "edit">): Array<{ field: VideoField; itemId: string | null; text: string }> {
  const out: Array<{ field: VideoField; itemId: string | null; text: string }> = [];
  const add = (field: VideoField, itemId: string | null, text: string) => {
    if (text.trim()) out.push({ field, itemId, text: text.trim() });
  };
  add("hook", null, project.brief.hook);
  add("script", null, project.plan.script);
  add("postCaption", null, project.plan.postCaption);
  add("cta", null, project.plan.cta);
  for (const o of project.edit.overlays) add("overlay", o.id, [o.text, o.sub].filter(Boolean).join(" — "));
  for (const c of project.edit.captions) add("caption", c.id, c.text);
  if (project.edit.intro.enabled) add("intro", null, project.edit.intro.title);
  if (project.edit.outro.enabled) add("outro", null, [project.edit.outro.line, project.plan.cta].filter(Boolean).join(" "));
  return out;
}

/** The video as a Content piece would read it: for the rules that look at all the words together (Alti's label, results vary, monitoring). */
export function asContentPiece(project: Pick<VideoProject, "brief" | "plan" | "edit" | "language" | "title">): ContentPiece {
  const lang = project.language;
  const copy = emptyCopy();
  const onScreen = videoTexts(project)
    .filter((t) => ["overlay", "caption", "intro", "outro"].includes(t.field))
    .map((t) => t.text);
  // Alti's overlay always carries his label, drawn by the editor under him.
  if (project.edit.alti.enabled) onScreen.push(aiByline(lang));
  copy.hook[lang] = project.brief.hook;
  copy.onScreen[lang] = onScreen.join("\n");
  copy.script[lang] = project.plan.script;
  copy.caption[lang] = project.plan.postCaption;
  copy.cta[lang] = project.plan.cta;
  const now = new Date(0).toISOString();
  return {
    id: "vp_check",
    title: project.title,
    type: "short_video",
    channels: [],
    language: lang,
    audience: "consumers",
    theme: "process",
    goal: project.brief.goal,
    copy,
    characters: project.edit.alti.enabled ? ["alti"] : [],
    links: [],
    assets: [],
    owner: null,
    dueDate: null,
    status: "in_production",
    campaignCode: "cnt-000000",
    templateId: null,
    aiDraft: false,
    checklist: {},
    approval: null,
    changesNote: null,
    posts: [],
    failure: null,
    createdBy: "check",
    createdAt: now,
    updatedAt: now,
  };
}

/** Every issue on a video, blocking first. `tracks` is the music library (for the rights record). */
export function checkVideo(project: VideoProject, tracks: readonly MusicTrack[] = []): VideoIssue[] {
  const out: VideoIssue[] = [];
  const seen = new Set<string>();
  const add = (i: VideoIssue) => {
    if (!seen.has(i.id)) {
      seen.add(i.id);
      out.push(i);
    }
  };
  const lang = project.language;
  for (const { field, itemId, text } of videoTexts(project)) {
    for (const found of checkText(text, COPY_FIELD[field], lang)) {
      add({ id: `${field}.${itemId ?? "all"}.${found.rule}`, rule: found.rule, severity: found.severity, field, itemId, match: found.match, explain: found.explain, fix: found.fix });
    }
    const georgia = text.match(GEORGIA);
    if (georgia) add(issue("texas-only", "block", field, itemId, georgia[0]));
    const other = text.match(OTHER_STATES);
    if (other) add(issue("other-state", "warn", field, itemId, other[0]));
  }
  // The rules over all the words at once (Alti labelled as AI, results vary, the monitoring commission).
  for (const found of checkPiece(asContentPiece(project)).filter((i: ContentIssue) => i.field === "piece")) {
    add({ id: `video.all.${found.rule}`, rule: found.rule, severity: found.severity, field: "video", itemId: null, match: found.match, explain: found.explain, fix: found.fix });
  }
  const body = bodyDuration(project.edit);
  if (project.edit.clips.length === 0) add(issue("no-clips", "block", "video", null, null));
  for (const cue of project.edit.captions) {
    if (body > 0 && cue.start >= body) add(issue("caption-after-end", "warn", "caption", cue.id, cue.text.slice(0, 40)));
    else if (tooFastToRead(cue)) add(issue("too-fast", "warn", "caption", cue.id, cue.text.slice(0, 40)));
  }
  for (const o of project.edit.overlays) if (body > 0 && o.start >= body) add(issue("overlay-after-end", "warn", "overlay", o.id, o.text.slice(0, 40)));
  if (project.edit.music.trackId) {
    const track = tracks.find((t) => t.id === project.edit.music.trackId && !t.removedAt);
    if (!track || !track.rights.confirmedBy || !track.rights.confirmedAt) add(issue("music-rights", "block", "video", null, null));
  }
  if (project.clientAppears === null) add(issue("client-question", "block", "video", null, null));
  else if (project.clientAppears && project.consents.length === 0) add(issue("client-consent", "block", "video", null, null));
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1));
}

export function blockingVideoIssues(issues: readonly VideoIssue[]): VideoIssue[] {
  return issues.filter((i) => i.severity === "block");
}

// ── The checklist before approval ───────────────────────────────────────

export type VideoChecklistId = VideoChecklistKey | "words" | "musicRights" | "clientConsent" | "altiLabel" | "export";

export interface VideoChecklistItem {
  key: VideoChecklistId;
  /** "person": someone ticks it; "app": the app decides from the project. */
  by: "person" | "app";
  done: boolean;
  label: Bilingual;
  hint: Bilingual;
}

/** What must be true before approval: only what applies to this video. */
export function videoChecklist(project: VideoProject, tracks: readonly MusicTrack[] = [], issues: VideoIssue[] = checkVideo(project, tracks)): VideoChecklistItem[] {
  const blocking = blockingVideoIssues(issues);
  const items: VideoChecklistItem[] = [
    {
      key: "words",
      by: "app",
      done: blocking.filter((i) => !["music-rights", "client-question", "client-consent", "no-clips"].includes(i.rule)).length === 0,
      label: { en: "Every word passes the claim rules", es: "Cada palabra pasa las reglas de lo que se puede decir" },
      hint: { en: "Titles, captions, cards, script and the post's words.", es: "Títulos, subtítulos, tarjetas, guion y el texto de la publicación." },
    },
    {
      key: "footageRights",
      by: "person",
      done: project.checklist.footageRights === true,
      label: { en: "We own or have the rights to every clip and picture", es: "Somos dueños o tenemos los derechos de cada clip y foto" },
      hint: { en: "Filmed by the team, or licensed with proof kept. No clips taken from other accounts.", es: "Grabado por el equipo, o con licencia y prueba guardada. Nada tomado de otras cuentas." },
    },
    {
      key: "noScoreVisuals",
      by: "person",
      done: project.checklist.noScoreVisuals === true,
      label: { en: "No credit score, score dial or before/after on screen", es: "Ningún puntaje, medidor o antes/después en pantalla" },
      hint: { en: "Look at every frame: phones, screens and papers in the shot too.", es: "Mira cada cuadro: también teléfonos, pantallas y papeles en la toma." },
    },
    {
      key: "captionsMatch",
      by: "person",
      done: project.checklist.captionsMatch === true,
      label: { en: "Captions are on and match what is said (or nobody speaks)", es: "Hay subtítulos y coinciden con lo que se dice (o nadie habla)" },
      hint: { en: "Play it once with the sound on.", es: "Reprodúcelo una vez con sonido." },
    },
    {
      key: "clientConsent",
      by: "app",
      done: project.clientAppears === false || (project.clientAppears === true && project.consents.length > 0),
      label: { en: "A client appears only with written consent on record", es: "Un cliente aparece solo con consentimiento por escrito registrado" },
      hint: { en: "Answer whether a client appears; if so, record the signed consent.", es: "Responde si aparece un cliente; si aparece, registra el consentimiento firmado." },
    },
    {
      key: "export",
      by: "app",
      done: currentExport(project) !== null,
      label: { en: "The MP4 is exported from this exact version", es: "El MP4 está exportado de esta versión exacta" },
      hint: { en: "Any change after the export needs a new one.", es: "Cualquier cambio después de exportar necesita una nueva exportación." },
    },
  ];
  if (project.edit.music.trackId) {
    items.splice(2, 0, {
      key: "musicRights",
      by: "app",
      done: !blocking.some((i) => i.rule === "music-rights"),
      label: { en: "The music's rights are on record", es: "Los derechos de la música están registrados" },
      hint: { en: "Only tracks from the team's music library, each with its rights confirmed.", es: "Solo pistas de la biblioteca de música del equipo, cada una con sus derechos confirmados." },
    });
  }
  if (project.edit.alti.enabled) {
    items.push({
      key: "altiLabel",
      by: "app",
      done: true,
      label: { en: "Alti is labelled as AI", es: "Alti está identificado como IA" },
      hint: { en: "The editor draws \"Alti · AI assistant\" under him every time.", es: "El editor dibuja \"Alti · Asistente con IA\" debajo de él siempre." },
    });
  }
  return items;
}

/** Why it can't be approved yet: each blocking issue and each item not done. */
export function videoApprovalBlockers(project: VideoProject, tracks: readonly MusicTrack[] = []): Array<{ code: string; text: Bilingual }> {
  const issues = checkVideo(project, tracks);
  const out: Array<{ code: string; text: Bilingual }> = blockingVideoIssues(issues).map((i) => ({ code: i.rule, text: i.explain }));
  for (const item of videoChecklist(project, tracks, issues)) if (!item.done) out.push({ code: `checklist:${item.key}`, text: item.label });
  return out;
}
