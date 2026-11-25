import { z } from "zod";
import {
  AUDIENCES,
  CHANNELS,
  CHARACTERS,
  CHECKLIST_KEYS,
  CONTENT_TYPES,
  COPY_FIELDS,
  LANGUAGES,
  PUBLISH_CHANNELS,
  RESULT_METRICS,
  STATUSES,
  THEMES,
} from "./types";

// What the content routes accept (POST /api/staff/content, /assets, /assist).
// Strict: unknown fields are refused, and every string has a limit.

const id = z.string().regex(/^[a-z]{2}_[a-z0-9]{6,40}$/);
const bi = (max: number) => z.object({ en: z.string().max(max), es: z.string().max(max) }).strict();
const copy = z.object(Object.fromEntries(COPY_FIELDS.map((f) => [f, bi(f === "script" ? 6000 : f === "caption" ? 2200 : 400)])) as Record<(typeof COPY_FIELDS)[number], ReturnType<typeof bi>>).strict();
const partialCopy = copy.partial();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const handle = z.string().regex(/^[a-z0-9._-]{1,40}$/).nullable();

const patch = z
  .object({
    title: z.string().min(2).max(120),
    type: z.enum(CONTENT_TYPES),
    channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
    language: z.enum(LANGUAGES),
    audience: z.enum(AUDIENCES),
    theme: z.enum(THEMES),
    goal: z.string().max(300),
    copy: partialCopy,
    characters: z.array(z.enum(CHARACTERS)).max(2),
    links: z.array(z.string().max(500)).max(10),
    owner: handle,
    dueDate: day,
    checklist: z.object(Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof CHECKLIST_KEYS)[number], z.ZodOptional<z.ZodBoolean>>).strict(),
    aiDraft: z.boolean(),
  })
  .partial()
  .strict();

export const contentBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      title: z.string().min(2).max(120),
      type: z.enum(CONTENT_TYPES),
      channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
      language: z.enum(LANGUAGES),
      audience: z.enum(AUDIENCES),
      theme: z.enum(THEMES),
      goal: z.string().max(300).optional(),
      owner: handle.optional(),
      dueDate: day.optional(),
      templateId: z.string().regex(/^[a-z0-9-]{2,60}$/).nullable().optional(),
      copy: copy.optional(),
      characters: z.array(z.enum(CHARACTERS)).max(2).optional(),
      aiDraft: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("update"), id, patch }).strict(),
  z.object({ action: z.literal("move"), id, to: z.enum(STATUSES) }).strict(),
  z.object({ action: z.literal("submit"), id }).strict(),
  z.object({ action: z.literal("approve"), id }).strict(),
  z.object({ action: z.literal("request_changes"), id, note: z.string().min(3).max(600) }).strict(),
  z.object({ action: z.literal("record_post"), id, channel: z.enum(CHANNELS), url: z.string().max(500), postedAt: z.string().max(40).optional() }).strict(),
  z.object({ action: z.literal("update_asset"), id, assetId: z.string().regex(/^as_[a-z0-9]{6,40}$/), altText: z.string().max(500) }).strict(),
  z.object({ action: z.literal("remove_asset"), id, assetId: z.string().regex(/^as_[a-z0-9]{6,40}$/) }).strict(),
  z.object({ action: z.literal("duplicate"), id }).strict(),
  z
    .object({
      action: z.literal("add_result"),
      id,
      channel: z.enum(CHANNELS),
      values: z.object(Object.fromEntries(RESULT_METRICS.map((m) => [m, z.number().int().min(0).max(1_000_000_000).nullable().optional()])) as Record<(typeof RESULT_METRICS)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>).strict(),
      at: z.string().max(40).nullable().optional(),
      note: z.string().max(300).nullable().optional(),
    })
    .strict(),
  z.object({ action: z.literal("schedule"), id, channel: z.enum(PUBLISH_CHANNELS), at: z.string().max(40), lang: z.enum(["en", "es"]).optional() }).strict(),
  z.object({ action: z.literal("cancel_schedule"), scheduleId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("settings"),
      enabled: z.boolean().optional(),
      channels: z.object(Object.fromEntries(PUBLISH_CHANNELS.map((c) => [c, z.boolean().optional()])) as Record<(typeof PUBLISH_CHANNELS)[number], z.ZodOptional<z.ZodBoolean>>).strict().optional(),
    })
    .strict(),
  z.object({ action: z.literal("disconnect"), provider: z.enum(["meta", "tiktok", "youtube"]) }).strict(),
]);

export type ContentBody = z.infer<typeof contentBodySchema>;

export const assistBodySchema = z
  .object({
    topic: z.string().trim().min(3).max(300),
    type: z.enum(CONTENT_TYPES),
    audience: z.enum(AUDIENCES),
    theme: z.enum(THEMES).nullable().optional(),
  })
  .strict();

export const assetBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), id, url: z.string().max(500), name: z.string().min(1).max(160), altText: z.string().max(500).optional() }).strict(),
  z
    .object({
      action: z.literal("upload_url"),
      id,
      name: z.string().min(1).max(160),
      mediaType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
      bytes: z.number().int().min(1).max(500 * 1024 * 1024),
    })
    .strict(),
  z.object({ action: z.literal("confirm"), id, assetId: z.string().regex(/^as_[a-z0-9]{6,40}$/), name: z.string().min(1).max(160), altText: z.string().max(500).optional() }).strict(),
]);
