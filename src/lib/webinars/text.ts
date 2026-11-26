import { defineText } from "../staff/i18n/text";

// The console's words for Webinars and Campaigns that are tables (labels of
// kinds and states). Inline screen text is t("Spanish", "English") on the
// screens. The staff language test walks this table in both languages.

export const WEBINARS_TEXT = defineText({
  en: {
    phase: { draft: "Draft", upcoming: "Upcoming", live: "Live now", ended: "Ended", cancelled: "Cancelled" },
    language: { en: "English", es: "Spanish", both: "English and Spanish" },
    goal: { home: "Buy a home", car: "Buy a car", understand: "Understand the report", learning: "Just learning" },
    timeline: { now: "Now", months_3: "~3 months", months_6: "~6 months", months_12: "A year or more", learning: "Just learning" },
    served: { texas: "Texas", out_of_state: "Out of state (learning only)" },
    reminder: { week: "1 week before", day: "1 day before", hour: "1 hour before", live: "We're live now", replay: "The replay", followup_2: "Follow-up, day 2", followup_5: "Follow-up, day 5 (the last)" },
    costKind: { ads_other: "Other ads (not Meta)", content: "Content", tools: "Tools (Zoom, Canva…)", people: "People's time", other: "Other" },
    purchaseKind: { upgrade: "Upgrade (recorded by hand)", household_addon: "Household add-on", partner_offer: "Partner offer", loan_officer: "Loan officer connection", home_purchase: "Bought a home", other: "Other" },
    channel: { ads: "Ads (Meta)", webinar: "Webinar", keyword: "Keyword", organic: "Organic" },
    package: { complete: "Credalti Complete", diy: "Credalti DIY" },
    cacState: { not_enough: "Not enough data yet", no_cost: "No spend recorded" },
    counters: {
      registered: "Registered",
      attended: "Attended",
      keywordMessages: "Keyword messages",
      reportsUploaded: "Reports uploaded",
      videosSent: "Videos sent",
      videosWatched: "Videos watched",
      signupsStarted: "Signups started",
      signed: "Signed",
    },
    noData: "No data yet",
    noDataVideos: "Comes with the keyword funnel",
  },
  es: {
    phase: { draft: "Borrador", upcoming: "Próximo", live: "En vivo", ended: "Terminado", cancelled: "Cancelado" },
    language: { en: "Inglés", es: "Español", both: "Inglés y español" },
    goal: { home: "Comprar casa", car: "Comprar carro", understand: "Entender el reporte", learning: "Solo aprender" },
    timeline: { now: "Ahora", months_3: "~3 meses", months_6: "~6 meses", months_12: "Un año o más", learning: "Solo aprender" },
    served: { texas: "Texas", out_of_state: "Fuera de Texas (solo aprender)" },
    reminder: { week: "1 semana antes", day: "1 día antes", hour: "1 hora antes", live: "Ya estamos en vivo", replay: "La repetición", followup_2: "Seguimiento, día 2", followup_5: "Seguimiento, día 5 (el último)" },
    costKind: { ads_other: "Otros anuncios (no Meta)", content: "Contenido", tools: "Herramientas (Zoom, Canva…)", people: "Tiempo de personas", other: "Otro" },
    purchaseKind: { upgrade: "Cambio de paquete (registrado a mano)", household_addon: "Agregado del hogar", partner_offer: "Oferta de socio", loan_officer: "Conexión con oficial de préstamos", home_purchase: "Compró casa", other: "Otro" },
    channel: { ads: "Anuncios (Meta)", webinar: "Webinar", keyword: "Palabra clave", organic: "Orgánico" },
    package: { complete: "Credalti Complete", diy: "Credalti DIY" },
    cacState: { not_enough: "Todavía no hay suficientes datos", no_cost: "Sin gasto registrado" },
    counters: {
      registered: "Registrados",
      attended: "Asistieron",
      keywordMessages: "Mensajes con la palabra clave",
      reportsUploaded: "Reportes subidos",
      videosSent: "Videos enviados",
      videosWatched: "Videos vistos",
      signupsStarted: "Registros empezados",
      signed: "Firmaron",
    },
    noData: "Todavía sin datos",
    noDataVideos: "Llega con el embudo de la palabra clave",
  },
});
