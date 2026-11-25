import type { StaffLocale } from "../staff/i18n/locale";
import type { Audience, Channel, ChecklistGroup, ContentLanguage, ContentStatus, ContentType, ResultMetric, Theme } from "./types";

// The content hub's words, in the member's language (the console's rule,
// docs/STAFF.md "Language"). The pieces' own words are whatever the team
// wrote, in the language they were written for.

type Table<K extends string> = Record<StaffLocale, Record<K, string>>;

export const TYPE_LABEL: Table<ContentType> = {
  en: {
    short_video: "Short video / reel",
    carousel: "Carousel",
    image: "Single image",
    story: "Story",
    youtube: "YouTube video",
    whatsapp_status: "WhatsApp status",
    partner: "Partner flyer or post",
    email: "Email",
    blog: "Blog or FAQ",
  },
  es: {
    short_video: "Video corto / reel",
    carousel: "Carrusel",
    image: "Imagen sola",
    story: "Historia",
    youtube: "Video de YouTube",
    whatsapp_status: "Estado de WhatsApp",
    partner: "Volante o post para socios",
    email: "Correo",
    blog: "Blog o pregunta frecuente",
  },
};

export const CHANNEL_LABEL: Table<Channel> = {
  en: { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp", partners: "Partners", email: "Email", website: "Website" },
  es: { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp", partners: "Socios", email: "Correo", website: "Sitio web" },
};

export const LANGUAGE_LABEL: Table<ContentLanguage> = {
  en: { en: "English", es: "Spanish", both: "English + Spanish" },
  es: { en: "Inglés", es: "Español", both: "Inglés + español" },
};

/** Short tag for cards: EN, ES, EN+ES. */
export const LANGUAGE_TAG: Record<ContentLanguage, string> = { en: "EN", es: "ES", both: "EN+ES" };

export const AUDIENCE_LABEL: Table<Audience> = {
  en: { consumers: "Consumers", hispanic: "Hispanic consumers", partners: "Realtors and lenders" },
  es: { consumers: "Consumidores", hispanic: "Consumidores hispanos", partners: "Agentes y prestamistas" },
};

export const THEME_LABEL: Table<Theme> = {
  en: { rights: "Your rights", myths: "Myths and facts", disputes: "Disputes and letters", process: "How it works", itin: "ITIN and Spanish", partners: "Partners", aftercare: "Building credit", team: "The team" },
  es: { rights: "Tus derechos", myths: "Mitos y verdades", disputes: "Disputas y cartas", process: "Cómo funciona", itin: "ITIN y español", partners: "Socios", aftercare: "Construir crédito", team: "El equipo" },
};

export const STATUS_LABEL: Table<ContentStatus> = {
  en: {
    idea: "Idea",
    planned: "Planned",
    in_production: "In production",
    review: "Ready for review",
    changes: "Changes requested",
    approved: "Approved",
    scheduled: "Scheduled",
    posted: "Posted",
    measured: "Measured",
    failed: "Failed",
    archived: "Archived",
  },
  es: {
    idea: "Idea",
    planned: "Planeado",
    in_production: "En producción",
    review: "Listo para revisión",
    changes: "Cambios pedidos",
    approved: "Aprobado",
    scheduled: "Programado",
    posted: "Publicado",
    measured: "Medido",
    failed: "Falló",
    archived: "Archivado",
  },
};

/** One line under each column title: what the column means. */
export const STATUS_HINT: Table<ContentStatus> = {
  en: {
    idea: "Anyone can add one.",
    planned: "Has an owner and a date.",
    in_production: "Being made in CapCut, Canva or the ad pipeline.",
    review: "Waiting for an administrator.",
    changes: "Sent back with a note.",
    approved: "Can be posted or scheduled.",
    scheduled: "The app will post it at the time set.",
    posted: "Out. Add the results.",
    measured: "Results are in.",
    failed: "Publishing failed. The reason is on the piece.",
    archived: "Kept, not on the board.",
  },
  es: {
    idea: "Cualquiera puede agregar una.",
    planned: "Tiene responsable y fecha.",
    in_production: "Se está haciendo en CapCut, Canva o el proceso de anuncios.",
    review: "Esperando a un administrador.",
    changes: "Devuelta con una nota.",
    approved: "Se puede publicar o programar.",
    scheduled: "La app la publica a la hora indicada.",
    posted: "Ya salió. Agrega los resultados.",
    measured: "Ya tiene resultados.",
    failed: "No se pudo publicar. El motivo está en la pieza.",
    archived: "Guardada, fuera del tablero.",
  },
};

/** Status chips: navy tints for work in progress, gold for waiting on a person, quiet for done. Never green/red. */
export const STATUS_TONE: Record<ContentStatus, string> = {
  idea: "bg-slate-100 text-slate-700",
  planned: "bg-slate-100 text-slate-700",
  in_production: "bg-blue-50 text-blue-700",
  review: "bg-amber-100 text-blue-900",
  changes: "bg-amber-50 text-amber-700",
  approved: "bg-blue-100 text-blue-900",
  scheduled: "bg-blue-100 text-blue-900",
  posted: "bg-blue-700 text-white",
  measured: "bg-blue-900 text-white",
  failed: "bg-amber-100 text-amber-700",
  archived: "bg-slate-100 text-slate-500",
};

export const METRIC_LABEL: Table<ResultMetric> = {
  en: { views: "Views", reach: "Reach", likes: "Likes", comments: "Comments", shares: "Shares", clicks: "Link clicks", leads: "Leads", signed: "Became clients" },
  es: { views: "Vistas", reach: "Alcance", likes: "Me gusta", comments: "Comentarios", shares: "Compartidos", clicks: "Clics al enlace", leads: "Prospectos", signed: "Se hicieron clientes" },
};

export const GROUP_LABEL: Table<ChecklistGroup> = {
  en: { brand: "Brand", legal: "Legal", access: "Accessibility" },
  es: { brand: "Marca", legal: "Legal", access: "Accesibilidad" },
};

export const NO_DATA: Record<StaffLocale, string> = { en: "No data yet", es: "Sin datos todavía" };
