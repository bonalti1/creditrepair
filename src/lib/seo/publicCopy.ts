import type { Locale } from "../i18n/dictionaries";

// The words around a guide on the public website (/guias and /guias/<slug>),
// English first. The guide's own words are the guide's. Held by the same
// rules as the site's copy (src/lib/__tests__/seo.test.ts): both claim checks,
// nothing called free, no outcome words, no pressure, 25 words a sentence.

export const GUIDE_PAGE_COPY = {
  en: {
    eyebrow: "Guide",
    indexEyebrow: "Guides",
    indexTitle: "Credit guides in plain words",
    indexLead: "Your rights, the steps and the deadlines, with the law behind each fact. Written for Texans, in English and Spanish.",
    indexMetaTitle: "Credit guides for Texans: your rights, in plain words | Credalti",
    indexMetaDescription: "Plain guides to credit reports, disputes and your rights under federal and Texas law, with a source for every legal fact.",
    read: "Read the guide",
    updated: "Last reviewed",
    inThisGuide: "In this guide",
    questions: "Questions",
    sources: "Sources",
    sourcesLead: "Every legal fact in this guide links to the law or the agency that says it.",
    sourceNote: "Opens the official page",
    ctaTitle: "When you're ready",
    ctaLead: "If you want a team to prepare and mail the letters for what you say is wrong, start your review. Or read how it works first.",
    howLink: "How it works",
    pricingLink: "How pricing works",
    disclaimer: "General information, not legal advice. Laws change; the sources show where each fact comes from. We do not guarantee results.",
    breadcrumbHome: "Home",
    breadcrumbGuides: "Guides",
    allGuides: "All guides",
    publisher: "Credalti",
  },
  es: {
    eyebrow: "Guía",
    indexEyebrow: "Guías",
    indexTitle: "Guías de crédito en palabras sencillas",
    indexLead: "Tus derechos, los pasos y los plazos, con la ley detrás de cada dato. Escritas para Texas, en inglés y en español.",
    indexMetaTitle: "Guías de crédito para Texas: tus derechos, en palabras sencillas | Credalti",
    indexMetaDescription: "Guías sencillas sobre reportes de crédito, disputas y tus derechos según la ley federal y la de Texas, con una fuente para cada dato legal.",
    read: "Leer la guía",
    updated: "Revisada por última vez",
    inThisGuide: "En esta guía",
    questions: "Preguntas",
    sources: "Fuentes",
    sourcesLead: "Cada dato legal de esta guía enlaza a la ley o a la agencia que lo dice.",
    sourceNote: "Abre la página oficial",
    ctaTitle: "Cuando estés listo",
    ctaLead: "Si quieres que un equipo prepare y envíe las cartas por lo que tú dices que está mal, empieza tu revisión. O lee primero cómo funciona.",
    howLink: "Cómo funciona",
    pricingLink: "Cómo funcionan los precios",
    disclaimer: "Información general, no es asesoría legal. Las leyes cambian; las fuentes muestran de dónde sale cada dato. No garantizamos resultados.",
    breadcrumbHome: "Inicio",
    breadcrumbGuides: "Guías",
    allGuides: "Todas las guías",
    publisher: "Credalti",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export function guidePageStrings(locale: Locale): string[] {
  return Object.values(GUIDE_PAGE_COPY[locale]);
}
