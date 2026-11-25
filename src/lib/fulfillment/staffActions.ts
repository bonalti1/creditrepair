import { recordDemoCheck, recordDemoReview } from "./demo";
import type { DocumentReview, RejectReason, ReviewableKind } from "./documents";
import type { CheckMethod, EnrolledViaLink, MonitoringCheck, MonitoringCheckStatus, MonitoringProvider } from "./monitoring";

// The console's fulfillment actions on one client: in the demo they are kept
// in this browser (fulfillment/demo.ts); with a database each goes to its
// staff route, which checks the member's role and that the client is theirs.

export type Result = { ok: true } | { ok: false; message: string };

async function post(path: string, body: unknown): Promise<Result> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { ok: false, message: "network" };
  if (res.ok) return { ok: true };
  const data = (await res.json().catch(() => ({}))) as { error?: unknown; message?: string };
  return { ok: false, message: typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
}

export interface CheckInput {
  provider: MonitoringProvider;
  providerName: string | null;
  enrolledViaLink: EnrolledViaLink;
  status: MonitoringCheckStatus;
  checkedOn: string;
  method: CheckMethod;
  note: string;
}

export async function recordMonitoringCheck(demo: boolean, clientId: string, input: CheckInput, byName: string): Promise<Result> {
  if (demo) {
    const check: MonitoringCheck = { id: `mc-demo-${Date.now()}`, ...input, by: byName, at: new Date().toISOString() };
    recordDemoCheck(clientId, check);
    return { ok: true };
  }
  return post("/api/staff/monitoring", { action: "check", clientId, ...input });
}

export interface ReviewInput {
  kind: ReviewableKind;
  fileId: string | null;
  decision: "accepted" | "rejected";
  reasonCode: RejectReason | null;
  note: string;
  askAgain: boolean;
  documentUploadedAt: string;
}

export async function reviewDocument(demo: boolean, clientId: string, input: ReviewInput, byName: string): Promise<Result> {
  if (demo) {
    const review: DocumentReview = { id: `dr-demo-${Date.now()}`, ...input, by: byName, at: new Date().toISOString() };
    recordDemoReview(clientId, review);
    return { ok: true };
  }
  const { documentUploadedAt: _ignored, ...rest } = input;
  return post("/api/staff/documents", { clientId, ...rest });
}

/** A two-minute link to the file; null in the demo (nothing is stored) or on failure. */
export async function openDocumentUrl(clientId: string, kind: ReviewableKind, fileId: string | null): Promise<string | null> {
  const qs = new URLSearchParams({ clientId, kind, ...(fileId ? { fileId } : {}) });
  const res = await fetch(`/api/staff/documents?${qs}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { url?: string }).url ?? null;
}
