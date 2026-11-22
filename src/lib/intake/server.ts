import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bureau, ItemCategory, ReportItem } from "../domain/types";
import { readBureauLetter, type LetterCheckResult } from "./bureauLetter";
import { INTAKE_BUCKET } from "./config";
import type { ModelUsage } from "./cost";
import { checkUpload, MAX_ANY_UPLOAD_BYTES, type IntakePurpose } from "./files";
import type { IntakeKind, IntakeStatus } from "./types";

// The server side of intake: reading an upload from a request, keeping the
// file in a private bucket, and writing the record. Routes call these after
// they have checked who is asking.

type Row = Record<string, unknown>;

export type UploadRead =
  | { ok: true; bytes: Uint8Array; fileName: string | null; fields: Record<string, string> }
  | { ok: false; status: 400 | 413; message: string };

/** The one file (field "file") and the text fields of a multipart upload, refusing an oversized body first. */
export async function readUpload(req: Request, maxBytes: number = MAX_ANY_UPLOAD_BYTES): Promise<UploadRead> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  // Multipart framing adds a little; anything far past the limit is refused unread.
  if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) return { ok: false, status: 413, message: "El archivo es demasiado grande." };
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, status: 400, message: "No llegó ningún archivo." };
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return { ok: false, status: 400, message: "No llegó ningún archivo." };
  if (file.size > maxBytes) return { ok: false, status: 413, message: "El archivo es demasiado grande." };
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string" && key !== "file") fields[key] = value.slice(0, 200);
  const name = (file as File).name;
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()), fileName: name ? name.slice(0, 120) : null, fields };
}

/** Put a file in a private bucket. Throws on failure: a document that was not kept is not checked either. */
export async function storeFile(db: SupabaseClient, bucket: string, path: string, bytes: Uint8Array, contentType: string, upsert = false): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert });
  if (error) throw new Error(`storage ${bucket}: ${error.message}`);
}

export interface IntakeRowInput {
  id?: string;
  userId: string;
  kind: IntakeKind;
  status: IntakeStatus;
  simulated: boolean;
  reasons: string[];
  result?: unknown;
  bucket?: string | null;
  path?: string | null;
  fileKind?: string | null;
  fileBytes?: number | null;
  model: string;
  usage: ModelUsage;
  costUsd: number;
  uploadedBy: string | null;
  role: "client" | "staff";
}

export async function recordIntake(db: SupabaseClient, input: IntakeRowInput): Promise<string> {
  const id = input.id ?? randomUUID();
  const { error } = await db.from("intake_documents").insert({
    id,
    user_id: input.userId,
    kind: input.kind,
    status: input.status,
    simulated: input.simulated,
    reasons: input.reasons.slice(0, 40).map((r) => r.slice(0, 400)),
    result: input.result ?? null,
    storage_bucket: input.bucket ?? null,
    storage_path: input.path ?? null,
    file_kind: input.fileKind ?? null,
    file_bytes: input.fileBytes ?? null,
    model: input.model,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    cache_read_tokens: input.usage.cacheReadTokens,
    cache_write_tokens: input.usage.cacheWriteTokens,
    cost_usd: input.costUsd,
    uploaded_by: input.uploadedBy,
    uploaded_by_role: input.role,
  });
  if (error) throw new Error(`intake_documents: ${error.message}`);
  return id;
}

export { intakeRecordFromRow } from "./rows";

/** The client's current report items, as the letter matcher needs them, and the ones their mailed letters disputed. */
export async function reportItemsFor(db: SupabaseClient, userId: string): Promise<{ items: ReportItem[]; disputed: Set<string> }> {
  const { data, error } = await db.from("report_items").select("id, fingerprint, bureau, category, name, data, negative, status").eq("user_id", userId);
  if (error) throw new Error(`report_items: ${error.message}`);
  const rows = (data as Row[] | null) ?? [];
  const items: ReportItem[] = rows
    .filter((r) => r.status !== "deleted")
    .map((r) => ({
      fingerprint: String(r.fingerprint),
      bureau: String(r.bureau) as Bureau,
      category: String(r.category) as ItemCategory,
      name: String(r.name),
      furnisher: null,
      data: (r.data ?? {}) as Record<string, unknown>,
      negative: r.negative === true,
    }));
  const { data: letters } = await db.from("letters").select("id").eq("user_id", userId);
  const letterIds = ((letters as Row[] | null) ?? []).map((l) => String(l.id));
  const disputed = new Set<string>();
  if (letterIds.length > 0) {
    const { data: links } = await db.from("letter_items").select("item_id").in("letter_id", letterIds);
    const ids = new Set(((links as Row[] | null) ?? []).map((l) => String(l.item_id)));
    for (const r of rows) if (ids.has(String(r.id))) disputed.add(String(r.fingerprint));
  }
  return { items, disputed };
}

/**
 * A bureau letter uploaded for this client (by the client or by staff):
 * kept in the private bucket, read, matched, recorded. Optional by design:
 * nothing in the round cycle waits for it.
 */
export async function processLetterUpload(
  db: SupabaseClient,
  input: { userId: string; bytes: Uint8Array; uploadedBy: string; role: "client" | "staff"; now: Date },
): Promise<{ id: string; result: LetterCheckResult } | { error: string; status: 413 | 415 | 400 }> {
  const purpose: IntakePurpose = "bureau_letter";
  const upload = checkUpload(purpose, input.bytes);
  if (!upload.ok) return { error: upload.message, status: upload.status };
  const id = randomUUID();
  const path = `${input.userId}/letters/${id}.${upload.extension}`;
  await storeFile(db, INTAKE_BUCKET, path, input.bytes, upload.mediaType);
  const { items, disputed } = await reportItemsFor(db, input.userId);
  const result = await readBureauLetter({ bytes: input.bytes, reportItems: items, disputed, now: input.now, live: true });
  await recordIntake(db, {
    id,
    userId: input.userId,
    kind: "bureau_letter",
    status: result.status,
    simulated: result.simulated,
    reasons: result.reasons,
    result: { letter: result.summary },
    bucket: INTAKE_BUCKET,
    path,
    fileKind: upload.kind,
    fileBytes: input.bytes.length,
    model: result.model,
    usage: result.usage,
    costUsd: result.costUsd,
    uploadedBy: input.uploadedBy,
    role: input.role,
  });
  return { id, result };
}
