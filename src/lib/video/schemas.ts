import { z } from "zod";
import { VIDEO_CHECKLIST_KEYS, VIDEO_FORMATS, VIDEO_STATUSES } from "./types";

// What the Video Studio's routes accept (POST /api/staff/video, /files,
// /assist, /transcribe). Strict: unknown fields are refused and every string
// has a limit. The edit decisions and the media list are checked again, field
// by field, by the rules (cleanEdit, cleanMedia in rules.ts).

const id = z.string().regex(/^[a-z]{2}_[a-z0-9]{6,40}$/);
const handle = z.string().regex(/^[a-z0-9._-]{1,40}$/).nullable();

const brief = z
  .object({
    title: z.string().max(120),
    goal: z.string().max(300),
    hook: z.string().max(200),
    script: z.string().max(4000),
    format: z.enum(VIDEO_FORMATS),
    source: z.enum(["studio", "ads"]),
    ref: z.string().max(80).nullable(),
  })
  .partial()
  .strict();

const shot = z.object({ id: z.string().max(48), seconds: z.number().min(0.5).max(60), shot: z.string().max(300), onScreen: z.string().max(160) }).strict();

const plan = z
  .object({
    script: z.string().max(6000),
    shots: z.array(shot).max(30),
    postCaption: z.string().max(2200),
    cta: z.string().max(60),
    aiDraft: z.boolean(),
  })
  .partial()
  .strict();

const consent = z
  .object({
    id: z.string().max(48),
    name: z.string().min(2).max(120),
    signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    where: z.string().min(2).max(300),
    recordedBy: z.string().max(40),
    recordedAt: z.string().max(40),
  })
  .strict();

const patch = z
  .object({
    title: z.string().min(2).max(120),
    language: z.enum(["en", "es"]),
    brief,
    plan,
    media: z.array(z.record(z.string(), z.unknown())).max(24),
    edit: z.record(z.string(), z.unknown()),
    checklist: z.object(Object.fromEntries(VIDEO_CHECKLIST_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof VIDEO_CHECKLIST_KEYS)[number], z.ZodOptional<z.ZodBoolean>>).strict(),
    clientAppears: z.boolean().nullable(),
    consents: z.array(consent).max(20),
    owner: handle,
  })
  .partial()
  .strict();

export const videoBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), id: id.optional(), title: z.string().min(2).max(120), language: z.enum(["en", "es"]), brief: brief.extend({ format: z.enum(VIDEO_FORMATS) }), plan: plan.optional() }).strict(),
  z.object({ action: z.literal("update"), id, patch }).strict(),
  z.object({ action: z.literal("move"), id, to: z.enum(VIDEO_STATUSES) }).strict(),
  z.object({ action: z.literal("submit"), id }).strict(),
  z.object({ action: z.literal("approve"), id }).strict(),
  z.object({ action: z.literal("request_changes"), id, note: z.string().min(3).max(600) }).strict(),
  z.object({ action: z.literal("link_piece"), id, pieceId: id }).strict(),
  z.object({ action: z.literal("publish"), id, pieceId: id }).strict(),
  z.object({ action: z.literal("duplicate"), id, newId: id.optional() }).strict(),
]);

export type VideoBody = z.infer<typeof videoBodySchema>;

const mediaType = z.string().max(40);

export const videoFilesBodySchema = z.discriminatedUnion("action", [
  // A one-time upload link for one file (a clip or picture of a video, an export, or a music track).
  z.object({ action: z.literal("upload_url"), purpose: z.enum(["media", "export", "music"]), projectId: id.nullable(), mediaType, bytes: z.number().int().min(1).max(262144000) }).strict(),
  // The file arrived: the server reads its first bytes and records it.
  z
    .object({
      action: z.literal("confirm_media"),
      projectId: id,
      fileId: id,
      path: z.string().max(300),
      name: z.string().min(1).max(160),
      kind: z.enum(["video", "image"]),
      duration: z.number().min(0).max(86400).nullable(),
      width: z.number().int().min(1).max(8192),
      height: z.number().int().min(1).max(8192),
      hasAudio: z.boolean().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm_export"),
      projectId: id,
      fileId: id,
      path: z.string().max(300),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      width: z.number().int().min(16).max(4096),
      height: z.number().int().min(16).max(4096),
      duration: z.number().positive().max(600),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm_music"),
      fileId: id,
      path: z.string().max(300),
      name: z.string().min(1).max(160),
      duration: z.number().positive().max(3600).nullable(),
      // The person confirms the team has the rights: required, recorded with their name and the time.
      rightsConfirmed: z.literal(true),
      rightsNote: z.string().max(300),
    })
    .strict(),
  z.object({ action: z.literal("remove_music"), id }).strict(),
  z.object({ action: z.literal("sign"), paths: z.array(z.string().max(300)).max(60) }).strict(),
]);

export type VideoFilesBody = z.infer<typeof videoFilesBodySchema>;

export const videoAssistBodySchema = z
  .object({
    language: z.enum(["en", "es"]),
    brief: z
      .object({
        title: z.string().min(2).max(120),
        goal: z.string().max(300),
        hook: z.string().max(200),
        script: z.string().max(4000),
        format: z.enum(VIDEO_FORMATS),
      })
      .strict(),
  })
  .strict();
