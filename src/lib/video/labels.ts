import { defineText } from "../staff/i18n/text";
import type { Aspect, VideoFormat, VideoStatus } from "./types";

// The Video Studio's words that come from a table (the screens' own sentences
// are inline, t("…", "…")). English and Spanish, the same keys
// (staffLanguage.test.ts walks them).

export const VIDEO_TEXT = defineText({
  en: {
    status: { planned: "Planned", editing: "Editing", ready: "Ready for approval", approved: "Approved", published: "Handed to Content", archived: "Archived" },
    statusHint: {
      planned: "An idea or a brief. Plan the script and shots, then start cutting.",
      editing: "Being cut. Export the MP4 and send it for approval.",
      ready: "Exported and checked by the editor. Waiting for an administrator.",
      approved: "Approved as exported. Hand it to Content to post it.",
      published: "A Content piece carries it now; posting happens there.",
      archived: "Put away. Restore it to plan it again.",
    },
    format: {
      reel: "Instagram Reel",
      tiktok: "TikTok",
      short: "YouTube Short",
      feed_square: "Feed post (square)",
      feed_portrait: "Feed post (portrait)",
      landscape: "Landscape (YouTube, website)",
    },
    aspect: { "9:16": "9:16 · Reels, TikTok, Shorts, Stories", "1:1": "1:1 · Square feed", "4:5": "4:5 · Portrait feed", "16:9": "16:9 · YouTube, website" },
    phase: { loading: "Loading the export engine", reading: "Reading the clips", drawing: "Drawing words, logo and cards", rendering: "Rendering the MP4", finishing: "Finishing" },
    exportError: {
      cancelled: "Export cancelled. Nothing was saved.",
      no_clips: "Add at least one clip or picture to the timeline first.",
      file_missing: "A file of this video isn't here anymore. Add it again and export.",
      engine: "The export engine couldn't start in this browser. Reload the page and try again; on a phone, try a computer.",
      render_failed: "The export failed. Try the quick quality, or remove the last clip you added and try again.",
    },
    field: { hook: "Hook", script: "Script", postCaption: "Post's words", cta: "Call to action", overlay: "Words on screen", caption: "Caption", intro: "Intro card", outro: "End card", video: "The whole video" },
    event: {
      created: "Created",
      edited: "Edited",
      moved: "Moved",
      exported: "Exported",
      submitted: "Sent for approval",
      approved: "Approved",
      approval_reset: "Approval dropped (it changed)",
      changes_requested: "Changes asked",
      linked_piece: "Linked to a Content piece",
      published: "Handed to Content",
      archived: "Archived",
      restored: "Restored",
    },
  },
  es: {
    status: { planned: "Planeado", editing: "En edición", ready: "Listo para aprobar", approved: "Aprobado", published: "Pasado a Contenido", archived: "Archivado" },
    statusHint: {
      planned: "Una idea o un brief. Planea el guion y las tomas, luego empieza a cortar.",
      editing: "En corte. Exporta el MP4 y mándalo a aprobación.",
      ready: "Exportado y revisado por quien edita. Espera a un administrador.",
      approved: "Aprobado tal como se exportó. Pásalo a Contenido para publicarlo.",
      published: "Ahora lo lleva una pieza de Contenido; se publica desde ahí.",
      archived: "Guardado. Restáuralo para planearlo otra vez.",
    },
    format: {
      reel: "Reel de Instagram",
      tiktok: "TikTok",
      short: "YouTube Short",
      feed_square: "Publicación (cuadrada)",
      feed_portrait: "Publicación (vertical)",
      landscape: "Horizontal (YouTube, sitio web)",
    },
    aspect: { "9:16": "9:16 · Reels, TikTok, Shorts, Historias", "1:1": "1:1 · Publicación cuadrada", "4:5": "4:5 · Publicación vertical", "16:9": "16:9 · YouTube, sitio web" },
    phase: { loading: "Cargando el motor de exportación", reading: "Leyendo los clips", drawing: "Dibujando textos, logo y tarjetas", rendering: "Creando el MP4", finishing: "Terminando" },
    exportError: {
      cancelled: "Exportación cancelada. No se guardó nada.",
      no_clips: "Primero agrega al menos un clip o una foto a la línea de tiempo.",
      file_missing: "Un archivo de este video ya no está aquí. Agrégalo otra vez y exporta.",
      engine: "El motor de exportación no pudo arrancar en este navegador. Recarga la página e inténtalo otra vez; en un teléfono, prueba en una computadora.",
      render_failed: "La exportación falló. Prueba la calidad rápida, o quita el último clip que agregaste e inténtalo otra vez.",
    },
    field: { hook: "Gancho", script: "Guion", postCaption: "Texto de la publicación", cta: "Llamada a la acción", overlay: "Texto en pantalla", caption: "Subtítulo", intro: "Tarjeta inicial", outro: "Tarjeta final", video: "Todo el video" },
    event: {
      created: "Creado",
      edited: "Editado",
      moved: "Movido",
      exported: "Exportado",
      submitted: "Mandado a aprobación",
      approved: "Aprobado",
      approval_reset: "Aprobación retirada (cambió)",
      changes_requested: "Cambios pedidos",
      linked_piece: "Unido a una pieza de Contenido",
      published: "Pasado a Contenido",
      archived: "Archivado",
      restored: "Restaurado",
    },
  },
});

export const VIDEO_STATUS_TONE: Record<VideoStatus, string> = {
  planned: "bg-slate-100 text-slate-700",
  editing: "bg-blue-50 text-blue-700",
  ready: "bg-amber-100 text-blue-900",
  approved: "bg-green-50 text-green-700",
  published: "bg-green-50 text-green-700",
  archived: "bg-slate-100 text-slate-600",
};

export const FORMAT_CHANNELS: Record<VideoFormat, Array<"instagram" | "facebook" | "tiktok" | "youtube">> = {
  reel: ["instagram", "facebook"],
  tiktok: ["tiktok"],
  short: ["youtube"],
  feed_square: ["instagram", "facebook"],
  feed_portrait: ["instagram", "facebook"],
  landscape: ["youtube", "facebook"],
};

export const ASPECT_ORDER: readonly Aspect[] = ["9:16", "1:1", "4:5", "16:9"];
