import { NextResponse } from "next/server";
import { z } from "zod";
import { IDENTITY_BUCKET } from "@/lib/intake/config";
import { REJECT_REASONS } from "@/lib/fulfillment/documents";
import { documentReviewFromRow } from "@/lib/fulfillment/rows";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { memberCanSee } from "@/lib/staff/actions";
import { checkStaffReply } from "@/lib/staff/conversation";
import { getServerSupabase } from "@/lib/supabase/server";

// A person's review of a client's document (migration 0041, document_reviews;
// docs/FULFILLMENT.md "Documents"). requireCapability("documents.review"):
// administrators and specialists; whether they may see THIS client's case is
// the database's answer through their own connection (memberCanSee).
//
//   GET  ?clientId&kind[&fileId]  a link to the file that works for two minutes.
//   POST {clientId, kind, fileId?, decision, reasonCode?, note?, askAgain?}
//        accepted, or not accepted with a reason the client reads in their
//        language. The note is the client's to read: it passes the same
//        promise rules every staff reply passes, and holds no SSN-like number.
//        Kept as it was (append-only). A required document not accepted
//        counts as missing, so no round goes with it.

const KINDS = ["government_id", "proof_of_address", "identity_theft_report", "supporting_document", "creditor_letter", "court_record", "power_of_attorney"] as const;
const IDENTITY_KINDS = new Set(["government_id", "proof_of_address", "identity_theft_report"]);
const CLIENT_FILES_BUCKET = "client-files";

type Row = Record<string, unknown>;

const reviewSchema = z
  .object({
    clientId: z.string().uuid(),
    kind: z.enum(KINDS),
    fileId: z.string().uuid().nullable().optional(),
    decision: z.enum(["accepted", "rejected"]),
    reasonCode: z.enum(REJECT_REASONS as unknown as [string, ...string[]]).nullable().optional(),
    note: z.string().max(300).optional(),
    askAgain: z.boolean().optional(),
  })
  .strict();

async function documentOf(db: Awaited<ReturnType<typeof requireCapability>> & { ok: true }, clientId: string, kind: string, fileId: string | null) {
  if (IDENTITY_KINDS.has(kind) && !fileId) {
    const { data } = await db.db.from("identity_documents").select("storage_path, uploaded_at").eq("user_id", clientId).eq("kind", kind).maybeSingle();
    return data ? { bucket: IDENTITY_BUCKET, path: String((data as Row).storage_path), uploadedAt: String((data as Row).uploaded_at) } : null;
  }
  if (!fileId) return null;
  const { data } = await db.db.from("client_files").select("storage_path, uploaded_at, kind, withdrawn_at").eq("id", fileId).eq("user_id", clientId).maybeSingle();
  const row = data as Row | null;
  if (!row || row.kind !== kind || row.withdrawn_at) return null;
  return { bucket: CLIENT_FILES_BUCKET, path: String(row.storage_path), uploadedAt: String(row.uploaded_at) };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-documents-open", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  const fileId = url.searchParams.get("fileId");
  if (!z.string().uuid().safeParse(clientId).success || !(KINDS as readonly string[]).includes(kind) || (fileId && !z.string().uuid().safeParse(fileId).success)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const allowed = await requireCapability("documents.review");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader || (await memberCanSee(reader, clientId, "case")) !== "client") return NextResponse.json({ error: "Not your client", code: "not_visible" }, { status: 403 });
  try {
    const doc = await documentOf(allowed, clientId, kind, fileId);
    if (!doc) return NextResponse.json({ error: "No such document" }, { status: 404 });
    const { data, error } = await allowed.db.storage.from(doc.bucket).createSignedUrl(doc.path, 120);
    if (error || !data) throw new Error(error?.message ?? "no link");
    return NextResponse.json({ url: data.signedUrl });
  } catch (error) {
    await reportError(error, { where: "api/staff/documents:open", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not open it." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-documents", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJsonBody(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = reviewSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const note = (input.note ?? "").replace(/\s+/g, " ").trim();
  if (input.decision === "rejected" && !input.reasonCode) return NextResponse.json({ error: "A reason is needed.", code: "reason_needed" }, { status: 400 });
  if (input.reasonCode === "other" && note.length < 5) return NextResponse.json({ error: "Write why in a few words.", code: "note_needed" }, { status: 400 });
  if (/\d{3}-?\d{2}-?\d{4}/.test(note)) return NextResponse.json({ error: "No numbers from the client's ID or SSN in the note.", code: "ssn_in_note" }, { status: 400 });
  const problems = note ? checkStaffReply(note, "en") : [];
  if (problems.length > 0) return NextResponse.json({ error: problems.map((p) => p.why).join(" "), code: "claim_rules", problems }, { status: 422 });

  const allowed = await requireCapability("documents.review");
  if (!allowed.ok) return allowed.response;
  const reader = await getServerSupabase();
  if (!reader || (await memberCanSee(reader, input.clientId, "case")) !== "client") return NextResponse.json({ error: "Not your client", code: "not_visible" }, { status: 403 });
  try {
    const doc = await documentOf(allowed, input.clientId, input.kind, input.fileId ?? null);
    if (!doc) return NextResponse.json({ error: "No such document on file", code: "no_document" }, { status: 404 });
    const { data, error } = await allowed.db
      .from("document_reviews")
      .insert({
        user_id: input.clientId,
        kind: input.kind,
        file_id: input.fileId ?? null,
        document_uploaded_at: doc.uploadedAt,
        decision: input.decision,
        reason_code: input.decision === "rejected" ? input.reasonCode : null,
        note,
        ask_again: input.decision === "rejected" ? (input.askAgain ?? true) : false,
        reviewed_by: allowed.member.userId,
        reviewed_by_name: allowed.member.name.slice(0, 80),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, review: documentReviewFromRow(data as Row) });
  } catch (error) {
    await reportError(error, { where: "api/staff/documents:review", userId: allowed.member.userId });
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
