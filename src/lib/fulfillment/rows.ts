import type { DocumentKind, StaffClient } from "../staff/types";
import { EXTRA_DOCUMENT_KINDS, REJECT_REASONS, type ClientFile, type DocumentReview, type ExtraDocumentKind, type RejectReason, type ReviewableKind } from "./documents";
import { CHECK_METHODS, type CheckMethod, type MonitoringCheck } from "./monitoring";
import type { NotificationSettings } from "./notifications";

// Database rows (migration 0041) → the console's client fields. Pure; the
// rows are whatever the member's own connection could read (row level
// security decides), so a role that may not read a table simply gets none.

type Row = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = new Date(v instanceof Date ? v.getTime() : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const day = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return text(v).slice(0, 10);
};

export function notificationSettingsFromRow(row: Row | undefined | null): NotificationSettings | null {
  if (!row) return null;
  return {
    whatsapp: row.whatsapp !== false,
    email: row.email !== false,
    reminders: row.reminders !== false,
    updates: row.updates !== false,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by === "staff" ? "staff" : "client",
  };
}

export function monitoringCheckFromRow(row: Row): MonitoringCheck {
  const method = text(row.method) as CheckMethod;
  return {
    id: text(row.id),
    provider: row.provider === "other" ? "other" : "identityiq",
    providerName: row.provider_name ? text(row.provider_name) : null,
    enrolledViaLink: row.enrolled_via_link === "yes" ? "yes" : row.enrolled_via_link === "no" ? "no" : "unknown",
    status: row.status === "active" ? "active" : row.status === "cancelled" ? "cancelled" : "unknown",
    checkedOn: day(row.checked_on),
    method: CHECK_METHODS.includes(method) ? method : "other",
    note: text(row.note),
    by: text(row.recorded_by_name) || "equipo",
    at: iso(row.created_at) ?? "",
  };
}

export function documentReviewFromRow(row: Row): DocumentReview {
  const reason = text(row.reason_code) as RejectReason;
  return {
    id: text(row.id),
    kind: text(row.kind) as ReviewableKind,
    fileId: row.file_id ? text(row.file_id) : null,
    documentUploadedAt: iso(row.document_uploaded_at) ?? "",
    decision: row.decision === "accepted" ? "accepted" : "rejected",
    reasonCode: REJECT_REASONS.includes(reason) ? reason : null,
    note: text(row.note),
    askAgain: row.ask_again === true,
    by: text(row.reviewed_by_name) || "equipo",
    at: iso(row.at) ?? "",
  };
}

export function clientFileFromRow(row: Row): ClientFile | null {
  const kind = text(row.kind) as ExtraDocumentKind;
  if (!EXTRA_DOCUMENT_KINDS.includes(kind)) return null;
  const type = text(row.content_type);
  return {
    id: text(row.id),
    kind,
    fileName: text(row.file_name),
    contentType: type === "image/jpeg" || type === "image/png" ? type : "application/pdf",
    bytes: Number(row.bytes) || 0,
    description: text(row.description),
    uploadedAt: iso(row.uploaded_at) ?? "",
    uploadedBy: row.uploaded_by === "staff" ? "staff" : "client",
    withdrawnAt: iso(row.withdrawn_at),
  };
}

/** The fulfillment fields of one client, from the rows read for everyone. */
export function fulfillmentFields(
  id: string,
  rows: { notificationSettings?: Row[]; monitoringChecks?: Row[]; documentReviews?: Row[]; clientFiles?: Row[]; documents?: Row[] },
): Partial<StaffClient> {
  const mine = (list: Row[] | undefined) => (list ?? []).filter((r) => text(r.user_id) === id);
  const settings = notificationSettingsFromRow(mine(rows.notificationSettings)[0]);
  const checks = mine(rows.monitoringChecks).map(monitoringCheckFromRow).sort((a, b) => a.at.localeCompare(b.at));
  const reviews = mine(rows.documentReviews).map(documentReviewFromRow).sort((a, b) => a.at.localeCompare(b.at));
  const files = mine(rows.clientFiles).flatMap((r) => clientFileFromRow(r) ?? []).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const uploaded: Partial<Record<DocumentKind, string>> = {};
  for (const d of mine(rows.documents)) {
    const at = iso(d.uploaded_at);
    if (at) uploaded[text(d.kind) as DocumentKind] = at;
  }
  return {
    ...(settings ? { notificationSettings: settings } : {}),
    ...(checks.length > 0 ? { monitoringChecks: checks } : {}),
    ...(reviews.length > 0 ? { documentReviews: reviews } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(Object.keys(uploaded).length > 0 ? { documentUploadedAt: uploaded } : {}),
  };
}
