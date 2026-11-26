import type { StaffClient } from "../staff/types";
import type { ClientFile, DocumentReview } from "./documents";
import type { MonitoringCheck } from "./monitoring";
import type { NotificationSettings } from "./notifications";

// DEMO DATA. Nobody here exists. Notification settings, monitoring checks,
// document reviews and the other documents of a few invented clients
// (src/lib/staff/demoClients.ts), counted back from "now". What a teammate
// records in the demo (a check, a review) is kept in this browser only.

const DAY = 24 * 60 * 60 * 1000;

function dayAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function demoFulfillment(now: Date): {
  settings: Record<string, NotificationSettings>;
  checks: Record<string, MonitoringCheck[]>;
  reviews: Record<string, DocumentReview[]>;
  files: Record<string, ClientFile[]>;
} {
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const check = (id: string, days: number, c: Partial<MonitoringCheck>): MonitoringCheck => ({
    id,
    provider: "identityiq",
    providerName: null,
    enrolledViaLink: "yes",
    status: "active",
    checkedOn: dayAgo(now, days),
    method: "provider_portal",
    note: "",
    by: "Marta Leal",
    at: at(days),
    ...c,
  });
  return {
    settings: {
      // Ernesto keeps WhatsApp only; Leticia turned reminders off.
      c10: { whatsapp: true, email: false, reminders: true, updates: true, updatedAt: at(20), updatedBy: "client" },
      c20: { whatsapp: true, email: true, reminders: false, updates: true, updatedAt: at(30), updatedBy: "client" },
    },
    checks: {
      c04: [check("mc-c04", 2, { status: "unknown", enrolledViaLink: "unknown", method: "client_said", note: "Says they will sign up this week." })],
      c10: [check("mc-c10", 75, { method: "client_said", by: "Ana Prieto" }), check("mc-c10b", 11, {})],
      // Heriberto told us he cancelled it: his report is overdue and the reminder says so.
      c12: [check("mc-c12", 3, { status: "cancelled", method: "client_said", note: "Cancelled it over a charge they did not recognize." })],
      c13: [check("mc-c13", 25, { method: "partner_statement", by: "Carmen Ruiz" })],
      c20: [check("mc-c20a", 50, { method: "client_said", by: "Ana Prieto" }), check("mc-c20b", 18, { method: "partner_statement", by: "Carmen Ruiz" })],
    },
    reviews: {
      c07: [
        { id: "dr-c07-id", kind: "government_id", fileId: null, documentUploadedAt: at(9), decision: "accepted", reasonCode: null, note: "", askAgain: false, by: "Marta Leal", at: at(8) },
        { id: "dr-c07-poa", kind: "proof_of_address", fileId: null, documentUploadedAt: at(9), decision: "accepted", reasonCode: null, note: "", askAgain: false, by: "Marta Leal", at: at(8) },
      ],
      c14: [
        { id: "dr-c14-f1", kind: "supporting_document", fileId: "cf-c14-1", documentUploadedAt: at(6), decision: "accepted", reasonCode: null, note: "", askAgain: false, by: "Carmen Ruiz", at: at(5) },
        { id: "dr-c14-f2", kind: "creditor_letter", fileId: "cf-c14-2", documentUploadedAt: at(4), decision: "rejected", reasonCode: "unreadable", note: "Solo llegó la primera página.", askAgain: true, by: "Carmen Ruiz", at: at(3) },
      ],
    },
    files: {
      c14: [
        { id: "cf-c14-1", kind: "supporting_document", fileName: "statement.pdf", contentType: "application/pdf", bytes: 182_000, description: "Statement showing the payment", uploadedAt: at(6), uploadedBy: "client", withdrawnAt: null },
        { id: "cf-c14-2", kind: "creditor_letter", fileName: "midland-letter.jpg", contentType: "image/jpeg", bytes: 640_000, description: "Letter from Midland", uploadedAt: at(4), uploadedBy: "client", withdrawnAt: null },
      ],
      c12: [
        { id: "cf-c12-1", kind: "court_record", fileName: "dismissal.pdf", contentType: "application/pdf", bytes: 95_000, description: "Case dismissed", uploadedAt: at(30), uploadedBy: "client", withdrawnAt: null },
      ],
    },
  };
}

/** The invented records, on the invented clients (before anything a teammate did in this browser). */
export function attachDemoFulfillment(clients: StaffClient[], now: Date): StaffClient[] {
  const demo = demoFulfillment(now);
  for (const client of clients) {
    const id = client.id;
    if (demo.settings[id]) client.notificationSettings = demo.settings[id];
    if (demo.checks[id]) client.monitoringChecks = demo.checks[id];
    if (demo.reviews[id]) client.documentReviews = demo.reviews[id];
    if (demo.files[id]) client.files = demo.files[id];
    // When each document on file came in: before the reviews above.
    if (client.documents.length > 0 && !client.documentUploadedAt) {
      const when = demo.reviews[id]?.find((r) => !r.fileId)?.documentUploadedAt ?? client.agreementSignedAt ?? client.createdAt;
      client.documentUploadedAt = Object.fromEntries(client.documents.map((k) => [k, when]));
    }
  }
  return clients;
}

// ── What a teammate did in the demo (this browser) ──────────────────────

const KEY = "credalti.fulfillmentDemo.v1";

export interface FulfillmentDemoActions {
  checks: Record<string, MonitoringCheck[]>;
  reviews: Record<string, DocumentReview[]>;
}

const EMPTY: FulfillmentDemoActions = { checks: {}, reviews: {} };

export function loadFulfillmentDemo(): FulfillmentDemoActions {
  if (typeof window === "undefined") return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<FulfillmentDemoActions>;
    return { checks: parsed.checks ?? {}, reviews: parsed.reviews ?? {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

function save(actions: FulfillmentDemoActions): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(actions));
  } catch {
    // Storage unavailable: nothing kept.
  }
}

export function recordDemoCheck(clientId: string, check: MonitoringCheck): void {
  const a = loadFulfillmentDemo();
  a.checks[clientId] = [...(a.checks[clientId] ?? []), check];
  save(a);
}

export function recordDemoReview(clientId: string, review: DocumentReview): void {
  const a = loadFulfillmentDemo();
  a.reviews[clientId] = [...(a.reviews[clientId] ?? []), review];
  save(a);
}

export function resetFulfillmentDemo(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The clients with what a teammate recorded in this browser added. */
export function applyFulfillmentDemo(clients: StaffClient[], actions: FulfillmentDemoActions): StaffClient[] {
  return clients.map((client) => {
    const checks = actions.checks[client.id];
    const reviews = actions.reviews[client.id];
    if (!checks && !reviews) return client;
    return {
      ...client,
      ...(checks ? { monitoringChecks: [...(client.monitoringChecks ?? []), ...checks] } : {}),
      ...(reviews ? { documentReviews: [...(client.documentReviews ?? []), ...reviews] } : {}),
    };
  });
}
