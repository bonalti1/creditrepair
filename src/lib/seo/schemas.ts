import { z } from "zod";
import { GUIDE_LIMITS } from "./guides";
import { TEXAS_CITIES } from "./keywords";
import { LOCAL_ITEMS } from "./local";
import { GUIDE_TICKS } from "./types";

// What the SEO routes accept (src/app/api/staff/seo). Anything else is a 400.

const bi = (max: number) => z.object({ en: z.string().max(max), es: z.string().max(max) });

const body = z.object({
  title: z.string().max(GUIDE_LIMITS.title),
  description: z.string().max(GUIDE_LIMITS.description),
  intro: z.string().max(GUIDE_LIMITS.intro),
  sections: z.array(z.object({ heading: z.string().max(GUIDE_LIMITS.heading), paragraphs: z.array(z.string().max(GUIDE_LIMITS.paragraph)).max(GUIDE_LIMITS.paragraphsPerSection) })).max(GUIDE_LIMITS.sections),
  faq: z.array(z.object({ q: z.string().max(GUIDE_LIMITS.faqText), a: z.string().max(GUIDE_LIMITS.faqText) })).max(GUIDE_LIMITS.faq),
});

const source = z.object({ id: z.string().max(40), label: z.string().max(GUIDE_LIMITS.sourceLabel), cite: z.string().max(GUIDE_LIMITS.sourceCite), url: z.string().max(GUIDE_LIMITS.url) });

const id = z.string().regex(/^gd_[a-z0-9_]{3,60}$/);

export const seoBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    topic: z.string().min(3).max(GUIDE_LIMITS.topic),
    brief: z.string().max(GUIDE_LIMITS.brief).optional(),
    phrase: bi(GUIDE_LIMITS.phrase).partial().optional(),
    slug: z.string().max(80).optional(),
    body: z.object({ en: body.partial(), es: body.partial() }).partial().optional(),
    sources: z.array(source).max(GUIDE_LIMITS.sources).optional(),
    aiDraft: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("update"),
    id,
    aiDraft: z.boolean().optional(),
    patch: z.object({
      topic: z.string().max(GUIDE_LIMITS.topic).optional(),
      brief: z.string().max(GUIDE_LIMITS.brief).optional(),
      phrase: bi(GUIDE_LIMITS.phrase).optional(),
      slug: z.string().max(80).optional(),
      body: z.object({ en: body, es: body }).optional(),
      sources: z.array(source).max(GUIDE_LIMITS.sources).optional(),
      checklist: z.object(Object.fromEntries(GUIDE_TICKS.map((t) => [t, z.boolean().optional()])) as Record<(typeof GUIDE_TICKS)[number], z.ZodOptional<z.ZodBoolean>>).optional(),
    }),
  }),
  z.object({ action: z.literal("submit"), id }),
  z.object({ action: z.literal("request_changes"), id, note: z.string().min(3).max(GUIDE_LIMITS.note) }),
  z.object({ action: z.literal("publish"), id }),
  z.object({ action: z.literal("unpublish"), id }),
  z.object({ action: z.literal("archive"), id }),
  z.object({ action: z.literal("restore"), id }),
  z.object({ action: z.literal("add_starters") }),
  z.object({
    action: z.literal("add_phrase"),
    phrase: z.string().min(3).max(100),
    lang: z.enum(["en", "es"]),
    city: z.enum(TEXAS_CITIES).nullable(),
    targetPath: z.string().max(120).nullable(),
    note: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("remove_phrase"), phraseId: z.string().regex(/^kw_[a-z0-9_]{3,60}$/) }),
  z.object({ action: z.literal("local_tick"), key: z.enum(LOCAL_ITEMS.map((i) => i.key) as [string, ...string[]]), done: z.boolean() }),
]);

export type SeoBody = z.infer<typeof seoBodySchema>;

export const draftBodySchema = z.object({
  topic: z.string().min(3).max(160),
  brief: z.string().max(1200).default(""),
  phrase: bi(100),
});
