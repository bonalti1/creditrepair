import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAgreement } from "../agreement/server";
import type { ChargeStatus } from "../billing/types";
import type { MailClass, MailStatus } from "../mail/types";
import type { CaseChargeFact, CaseDocumentFact, CaseFacts, CaseRoundFact } from "./timeline";

// "Mi caso" on the database: the signed-in client's case facts, read through
// the client's OWN connection (cookie-bound), so row level security shows them
// their rows and nobody else's ("own … read" policies, migrations 0001, 0003,
// 0006, 0010, 0011, 0013). Read-only: nothing here writes.
//
// Where each fact comes from:
//   agreement        service_agreements (the newest row)
//   documents        identity_documents.uploaded_at. "Checked" is not on
//                    record yet: the document check (src/lib/intake/, migration
//                    0016) adds it; until then checkedAt is null.
//   reportImports    report_pulls.pulled_at
//   review           report_items (active) and item_flags
//   rounds           attack_rounds (created_at, mailed_at, responded_at) and
//                    letters (mail_class, mail_status, mailed_at, delivered_at, returned_at)
//   charges          charges and refunds

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const MAIL_CLASSES: readonly MailClass[] = ["first_class", "certified", "certified_return_receipt"];
const MAIL_STATUSES: readonly MailStatus[] = ["not_sent", "in_transit", "delivered", "returned", "undeliverable"];
const CHARGE_STATUSES: readonly ChargeStatus[] = ["pending", "succeeded", "failed", "refunded"];

function rows(result: { data: unknown; error: { message: string } | null }, table: string): Row[] {
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
  return (result.data as Row[] | null) ?? [];
}

export async function loadClientCaseFacts(db: SupabaseClient, userId: string): Promise<CaseFacts> {
  const [agreement, docs, pulls, items, flags, rounds, letters, charges, refunds] = await Promise.all([
    loadAgreement(db, userId),
    db.from("identity_documents").select("kind, uploaded_at").eq("user_id", userId),
    db.from("report_pulls").select("pulled_at").eq("user_id", userId).order("pulled_at", { ascending: true }).limit(60),
    db.from("report_items").select("id").eq("user_id", userId).eq("status", "active"),
    db.from("item_flags").select("item_id, state, attested_at, created_at").eq("user_id", userId),
    db.from("attack_rounds").select("id, round_number, status, created_at, mailed_at, responded_at").eq("user_id", userId),
    db.from("letters").select("round_id, target_name, status, mail_class, mail_status, mailed_at, delivered_at, returned_at").eq("user_id", userId),
    db.from("charges").select("id, round_number, amount_cents, status, work_date, charged_at, last_attempt_at, created_at").eq("user_id", userId),
    db.from("refunds").select("charge_id, created_at, completed_at").eq("user_id", userId),
  ]);

  const documents: CaseDocumentFact[] = rows(docs, "identity_documents")
    .filter((d) => d.kind === "government_id" || d.kind === "proof_of_address")
    .flatMap((d) => {
      const at = iso(d.uploaded_at);
      return at ? [{ kind: d.kind as CaseDocumentFact["kind"], receivedAt: at, checkedAt: null }] : [];
    });

  const active = new Set(rows(items, "report_items").map((i) => String(i.id)));
  const answers = rows(flags, "item_flags").filter((f) => active.has(String(f.item_id)));
  const answeredAt = answers.map((f) => iso(f.attested_at) ?? iso(f.created_at)).filter((v): v is string => v !== null);
  const reviewed = answers.length;

  const letterRows = rows(letters, "letters").filter((l) => l.status !== "draft");
  const roundFacts: CaseRoundFact[] = rows(rounds, "attack_rounds").map((r) => {
      const mailedAt = r.status === "mailed" || r.status === "complete" ? iso(r.mailed_at) : null;
      const respondedAt = iso(r.responded_at);
      return {
        number: Number(r.round_number),
        preparedAt: iso(r.created_at),
        mailedAt,
        letters: mailedAt
          ? letterRows
              .filter((l) => String(l.round_id) === String(r.id))
              .map((l) => ({
                recipient: String(l.target_name ?? ""),
                mailClass: MAIL_CLASSES.find((c) => c === l.mail_class) ?? "first_class",
                status: MAIL_STATUSES.find((s) => s === l.mail_status) ?? "in_transit",
                mailedAt: iso(l.mailed_at) ?? mailedAt,
                deliveredAt: iso(l.delivered_at),
                returnedAt: iso(l.returned_at),
              }))
          : [],
        answers: respondedAt ? [{ from: null, receivedAt: respondedAt }] : [],
      };
    });

  const refundOf = new Map(rows(refunds, "refunds").map((r) => [String(r.charge_id), iso(r.completed_at) ?? iso(r.created_at)]));
  const chargeFacts: CaseChargeFact[] = rows(charges, "charges").flatMap((c) => {
    const at = iso(c.charged_at) ?? iso(c.last_attempt_at) ?? iso(c.created_at);
    if (!at) return [];
    return [
      {
        roundNumber: Number(c.round_number),
        amountCents: typeof c.amount_cents === "number" ? c.amount_cents : null,
        status: CHARGE_STATUSES.find((s) => s === c.status) ?? "pending",
        at,
        workDate: iso(c.work_date),
        refundedAt: refundOf.get(String(c.id)) ?? null,
      },
    ];
  });

  return {
    agreement,
    documents,
    reportImports: rows(pulls, "report_pulls").map((p) => iso(p.pulled_at)).filter((v): v is string => v !== null),
    review: {
      total: active.size,
      reviewed,
      confirmed: answers.filter((f) => f.state === "attested").length,
      finishedAt: active.size > 0 && reviewed >= active.size && answeredAt.length ? answeredAt.sort().at(-1)! : null,
    },
    rounds: roundFacts,
    charges: chargeFacts,
  };
}
