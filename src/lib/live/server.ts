import { createHash, randomBytes, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientTimeZone, isQuietHour } from "../autopilot/clock";
import { currentOptOut } from "../autopilot/optout";
import { storeMessage } from "../chat/history";
import { loadOpenStates } from "../compliance/stateOpenings";
import { stateStatus } from "../compliance/states";
import type { RawReport } from "../domain/parser";
import { checkUpload } from "../intake/files";
import { extractReport } from "../intake/report/extract";
import { validateReportExtraction } from "../intake/report/validate";
import { availabilityFromEnv, insideWhatsAppWindow, templateApproved } from "../autopilot/channels";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../integrations/whatsapp";
import { buildInvitePath, type GoalKey } from "../sales/invite";
import type { StaffMember } from "../staff/access";
import { importStaffReport } from "../staff/actions";
import { CONSENT_TEXT } from "./copy";
import { liveLink, matchKeyword, parseKeywords, type FunnelOrigin, type KeywordMatch } from "./keywords";
import { buildOverview, mergeRaw, type ReviewOverview } from "./overview";
import { OPTION_PARAM, type PackageKey } from "./packages";
import { decideKeywordReply, FUNNEL_QUIET, funnelWordsProblem, type KeywordSkip, type ReplyChannel } from "./replies";
import { sendFunnelSms, smsAllowed, smsFunnelReady } from "./sms";
import { type FunnelRow, countFunnelStages, type FunnelCounts } from "./stages";
import { funnelFromRow, reviewNeedsYou, type ReviewItem, type ReviewVideo } from "./review";

export { funnelFromRow, reviewNeedsYou, type ReviewItem, type ReviewVideo };
import { renderVideoTemplate, VIDEO_TEMPLATE, videoMessage } from "./templates";
import type { FunnelTag, FunnelPlatform } from "./keywords";

// The live funnel on the server (docs/LIVE-FUNNEL.md, migration 0043). Every
// write goes through the service role after the caller was checked by its
// route (a secret, a short-lived upload token, the member's capability);
// reads for the console go through the member's own connection, so the read
// policies decide (reviews, files and videos: administrators and specialists).

type Row = Record<string, unknown>;

export const LIVE_REPORTS_BUCKET = "live-reports";
export const LIVE_VIDEOS_BUCKET = "live-videos";
/** A report and its overview are deleted this long after the upload, unless they sign up and it is imported first. */
export const RETENTION_DAYS = 30;
/** A signed lead's review waits this much longer for the import, then goes too. */
export const SIGNED_GRACE_DAYS = 60;
export const VIDEO_LINK_DAYS = 14;
export const UPLOAD_TOKEN_HOURS = 24;
export const MAX_REPORT_FILES = 3;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const DAY = 86_400_000;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const iso = (v: unknown): string | null => {
  const s = typeof v === "string" ? v : v instanceof Date ? v.toISOString() : null;
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** A token as a link carries it: base64url, 20 to 64 characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

// ── The lead ────────────────────────────────────────────────────────────

export interface EnsureLeadInput {
  phone: string;
  /** How they came in: a WhatsApp or SMS message, the /live form, a comment hand-off. */
  channel: "whatsapp" | "sms" | "web" | "comment";
  origin: FunnelOrigin;
  name?: string | null;
  locale?: "en" | "es" | null;
  utm?: Record<string, string> | null;
  ad?: Record<string, unknown> | null;
  now: Date;
}

/**
 * The lead for this phone, created with the funnel in its first touch when
 * it is new (first touch wins: an existing lead keeps its own), and the
 * funnel's row beside it. Returns the lead's id.
 */
export async function ensureFunnelLead(db: SupabaseClient, input: EnsureLeadInput): Promise<{ leadId: string; created: boolean }> {
  const at = input.now.toISOString();
  const { data: existing } = await db.from("leads").select("id, display_name, locale").eq("phone_e164", input.phone).maybeSingle();
  let leadId = str((existing as Row | null)?.id);
  let created = false;
  if (!leadId) {
    const touch: Row = {
      channel: input.channel === "comment" ? "web" : input.channel,
      at,
      ...(input.origin.campaign ? { campaign: input.origin.campaign } : {}),
      funnel: { tag: input.origin.tag, keyword: input.origin.keyword, src: input.origin.src, platform: input.origin.platform },
      ...(input.utm && Object.keys(input.utm).length ? { utm: input.utm } : {}),
      ...(input.ad && Object.keys(input.ad).length ? { ad: input.ad } : {}),
    };
    const { data, error } = await db
      .from("leads")
      .insert({
        phone_e164: input.phone,
        source: input.channel === "whatsapp" ? "whatsapp" : "live",
        display_name: input.name?.trim().slice(0, 80) || null,
        locale: input.locale ?? null,
        first_touch: touch,
        created_at: at,
      })
      .select("id")
      .single();
    if (error || !data) {
      // Another delivery created it at the same moment: read it again.
      const { data: again } = await db.from("leads").select("id").eq("phone_e164", input.phone).maybeSingle();
      leadId = str((again as Row | null)?.id);
      if (!leadId) throw new Error(`leads insert: ${error?.message ?? "no row"}`);
    } else {
      leadId = String((data as Row).id);
      created = true;
    }
  } else {
    const patch: Row = {};
    if (!str((existing as Row).display_name) && input.name?.trim()) patch.display_name = input.name.trim().slice(0, 80);
    if (!str((existing as Row).locale) && input.locale) patch.locale = input.locale;
    if (Object.keys(patch).length) await db.from("leads").update(patch).eq("id", leadId);
  }
  const { data: live } = await db.from("live_leads").select("lead_id").eq("lead_id", leadId).maybeSingle();
  if (!live) {
    const { error } = await db.from("live_leads").insert({
      lead_id: leadId,
      tag: input.origin.tag,
      platform: input.origin.platform,
      keyword: input.origin.keyword,
      campaign: input.origin.campaign,
      src: input.origin.src,
      first_at: at,
      last_at: at,
    });
    // A concurrent insert won: the first touch is theirs.
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(`live_leads insert: ${error.message}`);
  } else {
    await db.from("live_leads").update({ last_at: at, platform: input.origin.platform, keyword: input.origin.keyword, campaign: input.origin.campaign, src: input.origin.src }).eq("lead_id", leadId);
  }
  return { leadId, created };
}

/** The newest opt-out of a number with no account (WhatsApp's BAJA/STOP), and for SMS its own STOP too. */
export async function optedOut(db: SupabaseClient, phone: string, channel: ReplyChannel): Promise<boolean> {
  const wa = await rows(db.from("message_opt_outs").select("kind, at").eq("phone_e164", phone), "message_opt_outs");
  if (currentOptOut(wa.map((r) => ({ kind: r.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: String(iso(r.at) ?? r.at) })))) return true;
  if (channel === "whatsapp") return false;
  const sms = await rows(db.from("live_sms_opt_outs").select("kind, at").eq("phone_e164", phone), "live_sms_opt_outs");
  return Boolean(currentOptOut(sms.map((r) => ({ kind: r.kind === "opt_in" ? ("opt_in" as const) : ("opt_out" as const), at: String(iso(r.at) ?? r.at) }))));
}

// ── Step 2: the automatic keyword reply ────────────────────────────────

export interface KeywordDeps {
  /** Sends the words; resolves with whether a provider took them. */
  send: (phoneE164: string, body: string) => Promise<{ sent: boolean }>;
}

export interface KeywordOutcome {
  matched: true;
  sent: boolean;
  skipped: KeywordSkip | "duplicate" | "failed" | null;
  leadId: string | null;
}

/** The keyword this inbound message is, if any (LIVE_KEYWORDS). */
export function keywordOf(text: string): KeywordMatch | null {
  return matchKeyword(text, parseKeywords());
}

/**
 * One inbound message that IS a keyword, from a person with no account: the
 * lead (with the funnel as its first touch when new), then at most one reply
 * with the /live link, claimed in live_replies before sending (one per
 * inbound message, ever; none again for the same person and keyword within
 * the window). On WhatsApp the reply is also kept in the conversation, as
 * Alti's. Call ensureFunnelLead first when the message itself is stored
 * after (so the lead's first touch is the funnel's).
 */
export async function replyToKeyword(
  db: SupabaseClient,
  input: { channel: ReplyChannel; phone: string; match: KeywordMatch; inboundRef: string; inboundAt: string; isClient: boolean; savedLocale: "en" | "es" | null; appUrl: string; now: Date },
  deps: KeywordDeps,
): Promise<KeywordOutcome> {
  const { match } = input;
  const origin: FunnelOrigin = { tag: "webinar", platform: input.channel, keyword: match.keyword.word, campaign: match.campaign, src: input.channel };
  if (input.isClient) return { matched: true, sent: false, skipped: "client", leadId: null };
  const { leadId } = await ensureFunnelLead(db, { phone: input.phone, channel: input.channel, origin, locale: match.keyword.locale ?? input.savedLocale, now: input.now });
  const { data: live } = await db.from("live_leads").select("state, locale").eq("lead_id", leadId).maybeSingle();
  if (input.channel === "sms") await db.from("live_leads").update({ sms_keyword_at: input.now.toISOString() }).eq("lead_id", leadId);
  const locale = match.keyword.locale ?? (str((live as Row | null)?.locale) as "en" | "es" | null) ?? input.savedLocale ?? "en";
  const [last] = await rows(
    db.from("live_replies").select("created_at, status").eq("phone_e164", input.phone).eq("keyword", match.keyword.word).neq("status", "failed").order("created_at", { ascending: false }).limit(1),
    "live_replies",
  );
  const decision = decideKeywordReply({
    channel: input.channel,
    isClient: false,
    optedOut: await optedOut(db, input.phone, input.channel),
    lastReplyAt: last ? iso(last.created_at) : null,
    inboundAt: input.inboundAt,
    state: str((live as Row | null)?.state),
    locale,
    link: liveLink(input.appUrl, { src: input.channel, keyword: match.keyword.word, campaign: match.campaign, locale }),
    now: input.now,
  });
  if (decision.action === "skip") return { matched: true, sent: false, skipped: decision.reason, leadId };

  const { data: claim, error: claimError } = await db
    .from("live_replies")
    .insert({ lead_id: leadId, phone_e164: input.phone, channel: input.channel, keyword: match.keyword.word, campaign: match.campaign, inbound_ref: `${input.channel}:${input.inboundRef}`.slice(0, 200), status: "claimed", body: decision.body })
    .select("id")
    .single();
  if (claimError || !claim) return { matched: true, sent: false, skipped: "duplicate", leadId };
  const id = String((claim as Row).id);
  try {
    const result = await deps.send(input.phone, decision.body);
    await db.from("live_replies").update({ status: result.sent ? "sent" : "failed", reason: result.sent ? null : "not_configured" }).eq("id", id);
    if (input.channel === "whatsapp") {
      await storeMessage(db, { phoneE164: input.phone, channel: "whatsapp", role: "assistant", source: "journey", text: decision.body });
    }
    return { matched: true, sent: result.sent, skipped: result.sent ? null : "failed", leadId };
  } catch (error) {
    await db.from("live_replies").update({ status: "failed", reason: (error instanceof Error ? error.message : "error").slice(0, 200) }).eq("id", id);
    throw error;
  }
}

/** The real senders: WhatsApp's Cloud API; SMS only through the narrow funnel adapter (off by default). */
export const KEYWORD_SENDERS: Record<ReplyChannel, KeywordDeps> = {
  whatsapp: { send: (phone, body) => sendWhatsAppText(phone.slice(1), body, "whatsapp:live-keyword") },
  sms: { send: async (phone, body) => sendFunnelSms(phone, body, { purpose: "keyword_reply", consent: { texted: true, formConsent: false } }) },
};

// ── Step 3: the /live form and the report upload ────────────────────────

export interface FormInput {
  firstName: string;
  phone: string;
  email: string | null;
  state: string;
  goal: GoalKey;
  locale: "en" | "es";
  consentMessages: boolean;
  consentReport: boolean;
  consentSms: boolean;
  origin: FunnelOrigin;
  utm: Record<string, string> | null;
  ad: Record<string, unknown> | null;
  now: Date;
}

export type FormOutcome =
  | { ok: true; leadId: string; uploadToken: string }
  | { ok: false; status: 403 | 409 | 422; code: "state_not_open" | "state_blocked" | "consent" | "client" };

export async function submitForm(db: SupabaseClient, input: FormInput, env: Record<string, string | undefined> = process.env): Promise<FormOutcome> {
  if (!input.consentMessages || !input.consentReport) return { ok: false, status: 422, code: "consent" };
  const status = stateStatus(input.state, await loadOpenStates(db));
  if (status === "blocked") return { ok: false, status: 403, code: "state_blocked" };
  if (status !== "open") return { ok: false, status: 409, code: "state_not_open" };
  const { data: profile } = await db.from("profiles").select("id").eq("phone_e164", input.phone).maybeSingle();
  if (profile) return { ok: false, status: 409, code: "client" };
  const origin = input.origin.platform ? input.origin : { ...input.origin, platform: "web" as FunnelPlatform };
  const { leadId } = await ensureFunnelLead(db, { phone: input.phone, channel: "web", origin, name: input.firstName, locale: input.locale, utm: input.utm, ad: input.ad, now: input.now });
  const token = newToken();
  const at = input.now.toISOString();
  const consent = CONSENT_TEXT[input.locale];
  const sms = input.consentSms && smsFunnelEnabledFor(env);
  const { error } = await db
    .from("live_leads")
    .update({
      first_name: input.firstName.trim().slice(0, 40),
      email: input.email,
      state: input.state,
      goal: input.goal,
      locale: input.locale,
      consent_messages_at: at,
      consent_messages_text: consent.messages,
      consent_report_at: at,
      consent_report_text: consent.report,
      ...(sms ? { consent_sms_at: at, consent_sms_text: consent.sms } : {}),
      form_at: at,
      upload_token_hash: hashToken(token),
      upload_token_expires_at: new Date(input.now.getTime() + UPLOAD_TOKEN_HOURS * 3_600_000).toISOString(),
      last_at: at,
    })
    .eq("lead_id", leadId);
  if (error) throw new Error(`live_leads form: ${error.message}`);
  return { ok: true, leadId, uploadToken: token };
}

function smsFunnelEnabledFor(env: Record<string, string | undefined>): boolean {
  return /^(on|true|1|yes)$/i.test((env.SMS_FUNNEL_ENABLED ?? "").trim());
}

export type UploadOutcome =
  | { ok: true; reviewId: string; files: number }
  | { ok: false; status: 400 | 401 | 409 | 413 | 415; code: "token" | "too_many" | "file" | "consent"; message?: string };

/** The report file(s) a person uploads on /live: checked by their first bytes, kept in the private bucket, read afterwards. */
export async function receiveReport(db: SupabaseClient, input: { token: string; files: Array<{ bytes: Uint8Array; fileName: string | null }>; now: Date }): Promise<UploadOutcome> {
  if (!TOKEN_PATTERN.test(input.token)) return { ok: false, status: 401, code: "token" };
  const { data: live } = await db.from("live_leads").select("lead_id, upload_token_expires_at, consent_report_at").eq("upload_token_hash", hashToken(input.token)).maybeSingle();
  const row = live as Row | null;
  if (!row || !row.upload_token_expires_at || Date.parse(String(row.upload_token_expires_at)) < input.now.getTime()) return { ok: false, status: 401, code: "token" };
  if (!row.consent_report_at) return { ok: false, status: 409, code: "consent" };
  if (input.files.length === 0 || input.files.length > MAX_REPORT_FILES) return { ok: false, status: 400, code: "too_many" };
  const checks = input.files.map((f) => checkUpload("credit_report", f.bytes));
  const bad = checks.find((c) => !c.ok);
  if (bad && !bad.ok) return { ok: false, status: bad.status === 413 ? 413 : bad.status === 415 ? 415 : 400, code: "file", message: bad.message };
  const leadId = String(row.lead_id);
  const at = input.now.toISOString();

  const [open] = await rows(db.from("live_reviews").select("id, file_count").eq("lead_id", leadId).is("deleted_at", null).is("imported_at", null).limit(1), "live_reviews");
  let reviewId: string;
  let count = 0;
  if (open) {
    reviewId = String(open.id);
    count = Number(open.file_count ?? 0);
    if (count + input.files.length > MAX_REPORT_FILES) return { ok: false, status: 400, code: "too_many" };
  } else {
    reviewId = randomUUID();
    const { error } = await db.from("live_reviews").insert({ id: reviewId, lead_id: leadId, status: "receiving", delete_after: new Date(input.now.getTime() + RETENTION_DAYS * DAY).toISOString(), created_at: at });
    if (error) throw new Error(`live_reviews insert: ${error.message}`);
  }
  for (const [index, file] of input.files.entries()) {
    const check = checks[index]!;
    if (!check.ok) continue;
    const fileId = randomUUID();
    const path = `${reviewId}/${fileId}.${check.extension}`;
    const { error: storeError } = await db.storage.from(LIVE_REPORTS_BUCKET).upload(path, file.bytes, { contentType: check.mediaType, upsert: false });
    if (storeError) throw new Error(`storage ${LIVE_REPORTS_BUCKET}: ${storeError.message}`);
    const { error } = await db.from("live_report_files").insert({ id: fileId, review_id: reviewId, storage_path: path, file_kind: check.kind === "pdf" ? "pdf" : check.kind === "html" ? "html" : "text", file_bytes: file.bytes.length, status: "received", created_at: at });
    if (error) throw new Error(`live_report_files insert: ${error.message}`);
  }
  await db.from("live_reviews").update({ status: "reading", file_count: count + input.files.length }).eq("id", reviewId);
  await db.from("live_leads").update({ report_at: at, last_at: at }).eq("lead_id", leadId);
  return { ok: true, reviewId, files: input.files.length };
}

/**
 * Reads every file of a review that has not been read (the AI report reader,
 * docs/INTAKE.md), merges the readings and builds the overview. Without an
 * API key the reading is the simulated one, labelled, and can never be
 * imported into a case.
 */
export async function readReview(db: SupabaseClient, reviewId: string, now: Date, options: { simulate?: boolean } = {}): Promise<{ status: "ready" | "failed" | "missing" }> {
  const { data: review } = await db.from("live_reviews").select("id, lead_id, deleted_at").eq("id", reviewId).maybeSingle();
  if (!review || (review as Row).deleted_at) return { status: "missing" };
  const files = await rows(db.from("live_report_files").select("*").eq("review_id", reviewId).order("created_at", { ascending: true }), "live_report_files");
  for (const file of files.filter((f) => f.status === "received")) {
    const { data: blob, error } = await db.storage.from(LIVE_REPORTS_BUCKET).download(String(file.storage_path));
    if (error || !blob) {
      await db.from("live_report_files").update({ status: "failed", reasons: ["No se pudo leer el archivo guardado."], read_at: now.toISOString() }).eq("id", file.id);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await extractReport({ bytes, fileName: null, now, intakeId: null, simulate: options.simulate });
    const v = result.validation;
    await db
      .from("live_report_files")
      .update({
        status: v.raw && result.envelope ? "read" : "failed",
        envelope: result.envelope,
        reasons: [...v.fatal, ...v.warnings].slice(0, 40).map((r) => r.slice(0, 400)),
        simulated: result.simulated,
        model: result.model.slice(0, 80),
        cost_usd: result.costUsd,
        read_at: now.toISOString(),
      })
      .eq("id", file.id);
  }
  const after = await rows(db.from("live_report_files").select("*").eq("review_id", reviewId).order("created_at", { ascending: true }), "live_report_files");
  const raws: RawReport[] = [];
  const warnings: string[] = [];
  let doubtful = 0;
  let simulated = false;
  for (const file of after.filter((f) => f.status === "read" && f.envelope)) {
    const envelope = file.envelope as { extraction?: unknown; simulated?: boolean };
    const v = validateReportExtraction(envelope.extraction, { now });
    if (!v.raw) continue;
    raws.push(v.raw);
    warnings.push(...v.warnings);
    doubtful += v.items.filter((i) => i.confidence === "low" && !i.excluded).length;
    if (envelope.simulated) simulated = true;
  }
  const merged = mergeRaw(raws);
  const { data: live } = await db.from("live_leads").select("goal").eq("lead_id", (review as Row).lead_id).maybeSingle();
  if (!merged) {
    const problems = after.flatMap((f) => (Array.isArray(f.reasons) ? (f.reasons as string[]) : [])).slice(0, 40);
    await db.from("live_reviews").update({ status: "failed", problems, read_at: now.toISOString() }).eq("id", reviewId);
    return { status: "failed" };
  }
  const overview = buildOverview({ raw: merged, goal: str((live as Row | null)?.goal), doubtful, warnings, now });
  await db.from("live_reviews").update({ status: "ready", raw: merged, overview, simulated, problems: [], read_at: now.toISOString(), ready_at: now.toISOString() }).eq("id", reviewId);
  await db.from("live_leads").update({ ready_at: now.toISOString() }).eq("lead_id", (review as Row).lead_id);
  return { status: "ready" };
}

// ── Step 4: the personal video ──────────────────────────────────────────

/** WebM (EBML) or MP4 (ftyp), from the first bytes. */
export function sniffVideo(bytes: Uint8Array): "video/webm" | "video/mp4" | null {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "video/mp4";
  return null;
}

export async function videoUploadUrl(db: SupabaseClient, input: { reviewId: string; mediaType: "video/webm" | "video/mp4"; bytes: number }): Promise<{ ok: true; videoId: string; path: string; signedUrl: string; token: string } | { ok: false; status: 404 | 413; code: string }> {
  if (input.bytes <= 0 || input.bytes > MAX_VIDEO_BYTES) return { ok: false, status: 413, code: "too_large" };
  const { data: review } = await db.from("live_reviews").select("id, status, deleted_at").eq("id", input.reviewId).maybeSingle();
  if (!review || (review as Row).deleted_at || (review as Row).status !== "ready") return { ok: false, status: 404, code: "not_ready" };
  const videoId = randomUUID();
  const path = `${input.reviewId}/${videoId}.${input.mediaType === "video/mp4" ? "mp4" : "webm"}`;
  const { data, error } = await db.storage.from(LIVE_VIDEOS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`storage upload url: ${error?.message ?? "none"}`);
  return { ok: true, videoId, path, signedUrl: data.signedUrl, token: data.token };
}

export async function confirmVideo(
  db: SupabaseClient,
  member: Pick<StaffMember, "userId" | "name">,
  input: { reviewId: string; videoId: string; path: string; duration: number },
  now: Date,
): Promise<{ ok: true; videoId: string } | { ok: false; status: 400 | 404 | 415; code: string }> {
  if (input.path !== `${input.reviewId}/${input.videoId}.webm` && input.path !== `${input.reviewId}/${input.videoId}.mp4`) return { ok: false, status: 400, code: "bad_input" };
  const { data: review } = await db.from("live_reviews").select("id, lead_id, deleted_at").eq("id", input.reviewId).maybeSingle();
  if (!review || (review as Row).deleted_at) return { ok: false, status: 404, code: "not_found" };
  const { data: blob } = await db.storage.from(LIVE_VIDEOS_BUCKET).download(input.path);
  if (!blob) return { ok: false, status: 400, code: "empty" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sniffVideo(bytes.subarray(0, 64));
  if (!type || bytes.length === 0 || bytes.length > MAX_VIDEO_BYTES) {
    await db.storage.from(LIVE_VIDEOS_BUCKET).remove([input.path]);
    return { ok: false, status: 415, code: "wrong_type" };
  }
  const { error } = await db.from("live_videos").insert({
    id: input.videoId,
    review_id: input.reviewId,
    lead_id: (review as Row).lead_id,
    storage_path: input.path,
    media_type: type,
    file_bytes: bytes.length,
    duration_seconds: Math.max(5, Math.min(330, Math.round(input.duration))),
    recorded_by: member.userId,
    recorded_by_name: member.name.slice(0, 80),
    created_at: now.toISOString(),
    // Not a link anyone has yet: «Send» makes the link (a new one each time).
    token_hash: hashToken(newToken()),
    expires_at: new Date(now.getTime() + VIDEO_LINK_DAYS * DAY).toISOString(),
  });
  if (error) throw new Error(`live_videos insert: ${error.message}`);
  return { ok: true, videoId: input.videoId };
}

export type SendChannel = "whatsapp" | "sms" | "email" | "copy";

export interface SendDeps {
  sendText: (toDigits: string, text: string, context: string) => Promise<{ sent: boolean }>;
  sendTemplate: (toDigits: string, template: { name: string; locale: "es" | "en"; params: readonly string[]; rendered: string }, context: string) => Promise<{ sent: boolean }>;
  sendSms: typeof sendFunnelSms;
  env: Record<string, string | undefined>;
}

export const SEND_DEPS: SendDeps = { sendText: sendWhatsAppText, sendTemplate: sendWhatsAppTemplate, sendSms: sendFunnelSms, env: process.env };

export type SendOutcome =
  | { ok: true; link: string; message: string; email: string | null; channel: SendChannel; sent: boolean }
  | { ok: false; status: 404 | 409 | 422; code: "not_found" | "opted_out" | "window_closed" | "sms_off" | "sms_no_consent" | "quiet_hours" | "no_email" | "words" };

/** What the channels can do for this lead now (the send panel shows it, the server decides again). */
export interface SendOptions {
  whatsapp: "text" | "template" | "window_closed" | "opted_out";
  sms: "ready" | "off" | "no_consent" | "opted_out" | "quiet_hours";
  email: boolean;
}

/**
 * Sends a video's private link (a new link each time: the earlier one stops
 * working), records it, and sets the lead's "Invited" (the link carries
 * their invitation). WhatsApp inside the 24 hours as text, outside only the
 * approved template; SMS only when on and allowed; email and copy hand the
 * words to the person, who sends them from their own mail app or phone.
 */
export async function sendVideo(
  db: SupabaseClient,
  member: Pick<StaffMember, "userId" | "name" | "handle">,
  input: { videoId: string; channel: SendChannel; appUrl: string; now: Date },
  deps: SendDeps = SEND_DEPS,
): Promise<SendOutcome> {
  const loaded = await loadSendContext(db, input.videoId, input.now, deps.env);
  if (!loaded) return { ok: false, status: 404, code: "not_found" };
  const { lead, live, options, locale } = loaded;
  const token = newToken();
  const link = `${input.appUrl.replace(/\/+$/, "") || "https://credalti.com"}/v/${token}`;
  const teammate = member.name.split(" ")[0] || member.handle;
  const firstName = str(live.first_name) ?? str(lead.display_name)?.split(" ")[0] ?? null;
  const message = videoMessage(locale, { firstName, teammate, link });
  if (funnelWordsProblem(message)) return { ok: false, status: 422, code: "words" };
  const phone = String(lead.phone_e164);
  let sent = false;

  if (input.channel === "whatsapp") {
    if (options.whatsapp === "opted_out") return { ok: false, status: 409, code: "opted_out" };
    if (options.whatsapp === "window_closed") return { ok: false, status: 409, code: "window_closed" };
    await rotate(db, input.videoId, token, input.now);
    if (options.whatsapp === "text") {
      sent = (await deps.sendText(phone.slice(1), message, "whatsapp:live-video")).sent;
      await storeMessage(db, { phoneE164: phone, channel: "whatsapp", role: "assistant", source: "human", text: message, authorName: teammate });
    } else {
      const params = [firstName ?? "", teammate, link] as const;
      const rendered = renderVideoTemplate(locale, params);
      sent = (await deps.sendTemplate(phone.slice(1), { name: VIDEO_TEMPLATE.name, locale, params, rendered }, "whatsapp:live-video-template")).sent;
      await storeMessage(db, { phoneE164: phone, channel: "whatsapp", role: "assistant", source: "human", text: rendered, authorName: teammate });
    }
  } else if (input.channel === "sms") {
    if (options.sms === "off") return { ok: false, status: 409, code: "sms_off" };
    if (options.sms === "no_consent") return { ok: false, status: 409, code: "sms_no_consent" };
    if (options.sms === "opted_out") return { ok: false, status: 409, code: "opted_out" };
    if (options.sms === "quiet_hours") return { ok: false, status: 409, code: "quiet_hours" };
    await rotate(db, input.videoId, token, input.now);
    const text = locale === "es" ? `${message} Responde STOP para no recibir más.` : `${message} Reply STOP to opt out.`;
    sent = (await deps.sendSms(phone, text.replace(/\n+/g, " "), { purpose: "video_link", consent: { texted: Boolean(live.sms_keyword_at), formConsent: Boolean(live.consent_sms_at) } }, deps.env)).sent;
  } else if (input.channel === "email") {
    if (!options.email) return { ok: false, status: 422, code: "no_email" };
    await rotate(db, input.videoId, token, input.now);
  } else {
    await rotate(db, input.videoId, token, input.now);
  }

  const at = input.now.toISOString();
  const { data: video } = await db.from("live_videos").select("sent_via").eq("id", input.videoId).maybeSingle();
  const via = new Set(((video as Row | null)?.sent_via as string[] | null) ?? []);
  via.add(input.channel);
  await db.from("live_videos").update({ sent_at: at, sent_via: [...via] }).eq("id", input.videoId);
  await db.from("live_leads").update({ video_sent_at: at, last_at: at }).eq("lead_id", lead.id);
  await db.from("leads").update({ invited_at: at }).eq("id", lead.id).is("invited_at", null);
  return { ok: true, link, message, email: str(live.email), channel: input.channel, sent };
}

async function rotate(db: SupabaseClient, videoId: string, token: string, now: Date): Promise<void> {
  const { error } = await db.from("live_videos").update({ token_hash: hashToken(token), expires_at: new Date(now.getTime() + VIDEO_LINK_DAYS * DAY).toISOString() }).eq("id", videoId);
  if (error) throw new Error(`live_videos link: ${error.message}`);
}

export async function loadSendContext(db: SupabaseClient, videoId: string, now: Date, env: Record<string, string | undefined> = process.env): Promise<{ lead: Row; live: Row; options: SendOptions; locale: "en" | "es" } | null> {
  const { data: video } = await db.from("live_videos").select("id, lead_id, deleted_at").eq("id", videoId).maybeSingle();
  if (!video || (video as Row).deleted_at) return null;
  const leadId = String((video as Row).lead_id);
  const [{ data: lead }, { data: live }] = await Promise.all([db.from("leads").select("*").eq("id", leadId).maybeSingle(), db.from("live_leads").select("*").eq("lead_id", leadId).maybeSingle()]);
  if (!lead || !live) return null;
  return { lead: lead as Row, live: live as Row, options: await sendOptions(db, lead as Row, live as Row, now, env), locale: (str((live as Row).locale) ?? str((lead as Row).locale) ?? "en") as "en" | "es" };
}

export async function sendOptions(db: SupabaseClient, lead: Row, live: Row, now: Date, env: Record<string, string | undefined> = process.env): Promise<SendOptions> {
  const phone = String(lead.phone_e164);
  const waOut = await optedOut(db, phone, "whatsapp");
  const smsOut = await optedOut(db, phone, "sms");
  const channels = availabilityFromEnv(env);
  const whatsapp: SendOptions["whatsapp"] = waOut
    ? "opted_out"
    : insideWhatsAppWindow(iso(lead.last_inbound_at), now)
      ? "text"
      : templateApproved(VIDEO_TEMPLATE.name, channels)
        ? "template"
        : "window_closed";
  const sms: SendOptions["sms"] = !smsFunnelReady(env)
    ? "off"
    : !smsAllowed("video_link", { texted: Boolean(live.sms_keyword_at), formConsent: Boolean(live.consent_sms_at) })
      ? "no_consent"
      : smsOut
        ? "opted_out"
        : isQuietHour(now, clientTimeZone(str(live.state)), FUNNEL_QUIET)
          ? "quiet_hours"
          : "ready";
  return { whatsapp, sms, email: Boolean(str(live.email)) };
}

// ── The video page (/v/[token]) ─────────────────────────────────────────

export type VideoPage =
  | { state: "ok"; videoId: string; src: string; firstName: string | null; locale: "en" | "es"; expiresAt: string; startHref: Record<PackageKey, string>; sample?: boolean }
  | { state: "expired" | "gone"; locale: "en" | "es" };

/** The signup with their invitation, the package preselected (`option=complete|diy`, live/packages.ts). */
export function startHref(input: { firstName: string | null; goal: string | null; state: string | null; locale: "en" | "es"; salesperson: string | null }, option: PackageKey): string {
  const path = buildInvitePath({ name: input.firstName, goal: (input.goal as GoalKey | null) ?? null, state: input.state, ref: input.salesperson, lang: input.locale });
  return `${path}${path.includes("?") ? "&" : "?"}${OPTION_PARAM}=${option}`;
}

export async function videoForToken(db: SupabaseClient, token: string, now: Date): Promise<VideoPage> {
  if (!TOKEN_PATTERN.test(token)) return { state: "gone", locale: "en" };
  const { data } = await db.from("live_videos").select("*").eq("token_hash", hashToken(token)).maybeSingle();
  const video = data as Row | null;
  if (!video) return { state: "gone", locale: "en" };
  const [{ data: live }, { data: lead }] = await Promise.all([db.from("live_leads").select("first_name, goal, state, locale").eq("lead_id", video.lead_id).maybeSingle(), db.from("leads").select("salesperson, locale").eq("id", video.lead_id).maybeSingle()]);
  const locale = (str((live as Row | null)?.locale) ?? str((lead as Row | null)?.locale) ?? "en") as "en" | "es";
  if (video.deleted_at) return { state: "gone", locale };
  if (Date.parse(String(video.expires_at)) < now.getTime()) return { state: "expired", locale };
  const { data: signed } = await db.storage.from(LIVE_VIDEOS_BUCKET).createSignedUrl(String(video.storage_path), 60 * 60);
  if (!signed?.signedUrl) return { state: "gone", locale };
  const firstName = str((live as Row | null)?.first_name);
  const base = { firstName, goal: str((live as Row | null)?.goal), state: str((live as Row | null)?.state), locale, salesperson: str((lead as Row | null)?.salesperson) };
  return { state: "ok", videoId: String(video.id), src: signed.signedUrl, firstName, locale, expiresAt: String(iso(video.expires_at)), startHref: { complete: startHref(base, "complete"), diy: startHref(base, "diy") } };
}

export const VIDEO_EVENTS = ["opened", "watched", "started", "chat"] as const;
export type VideoEvent = (typeof VIDEO_EVENTS)[number];

/** What the person did on their video page. Facts only move forward (the database keeps the first time). */
export async function trackVideo(db: SupabaseClient, token: string, event: VideoEvent, now: Date): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const { data } = await db.from("live_videos").select("id, lead_id, expires_at, deleted_at").eq("token_hash", hashToken(token)).maybeSingle();
  const video = data as Row | null;
  if (!video || video.deleted_at || Date.parse(String(video.expires_at)) < now.getTime()) return false;
  const at = now.toISOString();
  const column = { opened: "opened_at", watched: "watched_at", started: "started_at", chat: "chat_at" }[event];
  await db.from("live_videos").update({ [column]: at }).eq("id", video.id);
  const leadColumn = { opened: "video_opened_at", watched: "video_watched_at", started: "started_at", chat: null }[event];
  // Watching counts as opening; starting counts as watching enough.
  const facts: Row = leadColumn ? { [leadColumn]: at } : {};
  if (event === "watched") facts.video_opened_at = at;
  if (event === "started") facts.video_opened_at = at;
  if (Object.keys(facts).length) await db.from("live_leads").update({ ...facts, last_at: at }).eq("lead_id", video.lead_id);
  return true;
}

// ── The review queue (the console) ──────────────────────────────────────

const REVIEW_STATUSES = ["receiving", "reading", "ready", "failed", "deleted", "imported"] as const;

/** The queue, read through the member's own connection (administrators and specialists). */
export async function loadReviews(reader: SupabaseClient, options: { includeClosed?: boolean } = {}): Promise<ReviewItem[]> {
  const base = reader.from("live_reviews").select("*").order("created_at", { ascending: false }).limit(300);
  const reviews = await rows(options.includeClosed ? base : base.is("deleted_at", null), "live_reviews");
  if (reviews.length === 0) return [];
  const leadIds = [...new Set(reviews.map((r) => String(r.lead_id)))];
  const ids = reviews.map((r) => String(r.id));
  const [lives, videos, leads] = await Promise.all([
    rows(reader.from("live_leads").select("*").in("lead_id", leadIds), "live_leads"),
    rows(reader.from("live_videos").select("*").in("review_id", ids).order("created_at", { ascending: false }), "live_videos"),
    // Signed or not is read with the service role by the route when the reader may not see the lead (a specialist): see attachLeadFacts.
    rows(reader.from("leads").select("id, signed_at, client_user_id, locale").in("id", leadIds), "leads"),
  ]);
  const liveOf = new Map(lives.map((l) => [String(l.lead_id), l]));
  const leadOf = new Map(leads.map((l) => [String(l.id), l]));
  return reviews.map((r) => {
    const live = liveOf.get(String(r.lead_id)) ?? null;
    const lead = leadOf.get(String(r.lead_id)) ?? null;
    const signedAt = iso(lead?.signed_at);
    return {
      id: String(r.id),
      leadId: String(r.lead_id),
      firstName: live ? str(live.first_name) : null,
      locale: ((live && str(live.locale)) ?? (lead && str(lead.locale)) ?? "en") as "en" | "es",
      state: live ? str(live.state) : null,
      goal: live ? str(live.goal) : null,
      status: (REVIEW_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as ReviewItem["status"]) : "failed",
      simulated: r.simulated === true,
      createdAt: String(iso(r.created_at)),
      readyAt: iso(r.ready_at),
      deleteAfter: String(iso(r.delete_after)),
      fileCount: Number(r.file_count ?? 0),
      problems: Array.isArray(r.problems) ? (r.problems as string[]) : [],
      overview: (r.overview as ReviewOverview | null) ?? null,
      funnel: live ? funnelFromRow(live, signedAt) : null,
      videos: videos
        .filter((v) => v.review_id === r.id)
        .map((v) => ({
          id: String(v.id),
          createdAt: String(iso(v.created_at)),
          durationSeconds: Number(v.duration_seconds),
          recordedBy: str(v.recorded_by_name),
          sentAt: iso(v.sent_at),
          sentVia: Array.isArray(v.sent_via) ? (v.sent_via as string[]) : [],
          openedAt: iso(v.opened_at),
          watchedAt: iso(v.watched_at),
          startedAt: iso(v.started_at),
          expiresAt: String(iso(v.expires_at)),
          deleted: Boolean(v.deleted_at),
        })),
      signed: Boolean(signedAt),
      clientUserId: lead ? str(lead.client_user_id) : null,
      importedAt: iso(r.imported_at),
    };
  });
}

/** A specialist does not read the leads table: the signed facts come from the service role, for these reviews only. */
export async function attachLeadFacts(db: SupabaseClient, items: ReviewItem[]): Promise<ReviewItem[]> {
  const missing = items.filter((i) => i.clientUserId === null && !i.signed).map((i) => i.leadId);
  if (missing.length === 0) return items;
  const leads = await rows(db.from("leads").select("id, signed_at, client_user_id").in("id", [...new Set(missing)]), "leads");
  const of = new Map(leads.map((l) => [String(l.id), l]));
  return items.map((i) => {
    const l = of.get(i.leadId);
    if (!l) return i;
    const signedAt = iso(l.signed_at);
    return { ...i, signed: Boolean(signedAt), clientUserId: str(l.client_user_id), funnel: i.funnel ? { ...i.funnel, ...(signedAt ? { stage: "signed" as const, stageAt: signedAt } : {}) } : null };
  });
}

/** Signed: the review becomes the case's first report, through the same import as any report (reports.import). */
export async function importReview(db: SupabaseClient, reader: SupabaseClient, member: StaffMember, reviewId: string, now: Date): Promise<{ ok: true; pullId: string } | { ok: false; status: number; code: string; message?: string; problems?: string[] }> {
  const { data } = await db.from("live_reviews").select("*").eq("id", reviewId).maybeSingle();
  const review = data as Row | null;
  if (!review || review.deleted_at || review.imported_at || !review.raw) return { ok: false, status: 404, code: "not_found" };
  if (review.simulated) return { ok: false, status: 409, code: "simulated" };
  const { data: lead } = await db.from("leads").select("client_user_id, signed_at").eq("id", review.lead_id).maybeSingle();
  const clientId = str((lead as Row | null)?.client_user_id);
  if (!clientId || !(lead as Row).signed_at) return { ok: false, status: 409, code: "not_signed" };
  const result = await importStaffReport(db, reader, member, { clientId, readerKey: "credalti_json", source: JSON.stringify(review.raw) }, now);
  if (!result.ok) return { ok: false, status: result.status, code: result.code ?? "import_failed", message: result.message, problems: (result.problems ?? []).map((p) => (typeof p === "string" ? p : p.why)) };
  await db.from("live_reviews").update({ imported_at: now.toISOString(), imported_user_id: clientId, imported_pull_id: result.pullId, status: "imported" }).eq("id", reviewId);
  // The case has it now: the funnel's own copy goes.
  await purgeReview(db, reviewId, now, "imported");
  return { ok: true, pullId: result.pullId };
}

// ── Retention (the /api/cron/live job) ──────────────────────────────────

/** Deletes a review's files (reports and videos) and its data; keeps the bare record for the funnel's counts. */
export async function purgeReview(db: SupabaseClient, reviewId: string, now: Date, status: "deleted" | "imported" = "deleted"): Promise<void> {
  const [files, videos] = await Promise.all([
    rows(db.from("live_report_files").select("id, storage_path, deleted_at").eq("review_id", reviewId), "live_report_files"),
    rows(db.from("live_videos").select("id, storage_path, deleted_at").eq("review_id", reviewId), "live_videos"),
  ]);
  const reportPaths = files.filter((f) => !f.deleted_at).map((f) => String(f.storage_path));
  const videoPaths = videos.filter((v) => !v.deleted_at).map((v) => String(v.storage_path));
  if (reportPaths.length) {
    const { error } = await db.storage.from(LIVE_REPORTS_BUCKET).remove(reportPaths);
    if (error) throw new Error(`storage ${LIVE_REPORTS_BUCKET} remove: ${error.message}`);
  }
  if (videoPaths.length) {
    const { error } = await db.storage.from(LIVE_VIDEOS_BUCKET).remove(videoPaths);
    if (error) throw new Error(`storage ${LIVE_VIDEOS_BUCKET} remove: ${error.message}`);
  }
  const at = now.toISOString();
  await db.from("live_report_files").update({ status: "deleted", envelope: null, reasons: [], deleted_at: at }).eq("review_id", reviewId).is("deleted_at", null);
  await db.from("live_videos").update({ deleted_at: at }).eq("review_id", reviewId).is("deleted_at", null);
  const { data: review } = await db.from("live_reviews").update({ raw: null, overview: null, problems: [], deleted_at: at, ...(status === "deleted" ? { status: "deleted" } : {}) }).eq("id", reviewId).select("lead_id").single();
  if (review) await db.from("live_leads").update({ report_deleted_at: at }).eq("lead_id", (review as Row).lead_id);
}

export interface RetentionResult {
  deleted: number;
  waitingImport: number;
  reread: number;
  expiredTokens: number;
}

/**
 * The daily sweep: a review whose 30 days are over is deleted (files and
 * data) unless they signed up, in which case it waits for the import for up
 * to 60 more days; readings stuck for 10 minutes or more are tried again;
 * spent upload tokens are cleared. Safe to run twice.
 */
export async function runRetention(db: SupabaseClient, now: Date, options: { read?: (reviewId: string) => Promise<unknown> } = {}): Promise<RetentionResult> {
  const result: RetentionResult = { deleted: 0, waitingImport: 0, reread: 0, expiredTokens: 0 };
  const due = await rows(db.from("live_reviews").select("id, lead_id, delete_after").is("deleted_at", null).is("imported_at", null).lt("delete_after", now.toISOString()).limit(500), "live_reviews");
  if (due.length > 0) {
    const leads = await rows(db.from("leads").select("id, signed_at").in("id", [...new Set(due.map((d) => String(d.lead_id)))]), "leads");
    const signed = new Map(leads.map((l) => [String(l.id), iso(l.signed_at)]));
    for (const review of due) {
      const graceOver = Date.parse(String(review.delete_after)) + SIGNED_GRACE_DAYS * DAY < now.getTime();
      if (signed.get(String(review.lead_id)) && !graceOver) {
        result.waitingImport += 1;
        continue;
      }
      await purgeReview(db, String(review.id), now);
      result.deleted += 1;
    }
  }
  const stuck = await rows(db.from("live_reviews").select("id, created_at").in("status", ["receiving", "reading"]).is("deleted_at", null).lt("created_at", new Date(now.getTime() - 10 * 60_000).toISOString()).limit(3), "live_reviews");
  for (const review of stuck) {
    await (options.read ?? ((id: string) => readReview(db, id, now)))(String(review.id));
    result.reread += 1;
  }
  const { data: tokens } = await db.from("live_leads").update({ upload_token_hash: null, upload_token_expires_at: null }).lt("upload_token_expires_at", now.toISOString()).select("lead_id");
  result.expiredTokens = ((tokens as Row[] | null) ?? []).length;
  return result;
}

// ── For the Webinars section (migration 0044) ───────────────────────────

/** Every funnel lead's facts (no names, no phones, no credit data), with the lead's signed date. */
export async function loadFunnelRows(db: SupabaseClient): Promise<FunnelRow[]> {
  const lives = await rows(db.from("live_leads").select("lead_id, tag, keyword, campaign, form_at, report_at, ready_at, video_sent_at, video_opened_at, video_watched_at, started_at").limit(10_000), "live_leads");
  if (lives.length === 0) return [];
  const leads = await rows(db.from("leads").select("id, signed_at").in("id", lives.map((l) => String(l.lead_id))), "leads");
  const signed = new Map(leads.map((l) => [String(l.id), iso(l.signed_at)]));
  return lives.map((l) => ({
    tag: String(l.tag) as FunnelTag,
    keyword: str(l.keyword),
    campaign: str(l.campaign),
    formAt: iso(l.form_at),
    reportAt: iso(l.report_at),
    readyAt: iso(l.ready_at),
    videoSentAt: iso(l.video_sent_at),
    videoOpenedAt: iso(l.video_opened_at),
    videoWatchedAt: iso(l.video_watched_at),
    startedAt: iso(l.started_at),
    signedAt: signed.get(String(l.lead_id)) ?? null,
  }));
}

/**
 * The funnel for one campaign (or keyword), for the Webinars section: how
 * many leads reached each stage or further. Pass the connection whose read
 * policies should apply (a member's own, or the service role for a job).
 *
 *   await countFunnelForCampaign(db, "webinar-nov")
 */
export async function countFunnelForCampaign(db: SupabaseClient, campaign: string | null, keyword: string | null = null): Promise<FunnelCounts> {
  return countFunnelStages(await loadFunnelRows(db), { campaign, keyword });
}
