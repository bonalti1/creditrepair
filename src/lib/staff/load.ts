import type { SupabaseClient } from "@supabase/supabase-js";
import { clientsFromRows, EMPTY_STAFF_ROWS, type StaffRows } from "./fromRows";
import type { StaffClient } from "./types";

// Reading the staff console's clients from the database.
//
// `db` must be the signed-in member's OWN connection (the cookie-bound client,
// supabase/server.ts), never the service role: the role-scoped "staff read"
// policies of migration 0012 then decide, row by row, what this person sees.
// A specialist gets the clients assigned to them; sales gets the people they
// brought in, without the case; an administrator gets everyone. Nothing here
// filters by role itself, so nothing here can get it wrong.

type Row = Record<string, unknown>;

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

const PULL_COLUMNS = "id, user_id, source, pulled_at, created_at, imported_by, imported_by_name, reader_key, import_summary";

/**
 * Every row the console needs, as this member may read them. With
 * `clientId`, only that client's (a client with an account, or a prospect).
 */
export async function loadStaffRows(db: SupabaseClient, options: { clientId?: string } = {}): Promise<StaffRows> {
  const one = options.clientId ?? null;
  if (one && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(one)) throw new Error("loadStaffRows: not a client id");
  // A table's rows, of this one client when asked.
  const sel = (table: string, columns: string, column = "user_id") => {
    const query = db.from(table).select(columns);
    return one ? query.eq(column, one) : query;
  };

  const [
    profiles,
    prospects,
    staffMembers,
    agreements,
    documents,
    pulls,
    items,
    flags,
    rounds,
    letters,
    mailEvents,
    paymentMethods,
    charges,
    refunds,
    pauses,
    chat,
    events,
    notes,
    marks,
    samples,
    assignments,
    audit,
  ] = await Promise.all([
    rows(sel("profiles", "*", "id"), "profiles"),
    rows(one ? db.from("prospects").select("*").or(`id.eq.${one},converted_user_id.eq.${one}`) : db.from("prospects").select("*"), "prospects"),
    rows(db.from("staff_members").select("user_id, handle, display_name, role, active"), "staff_members"),
    rows(sel("service_agreements", "*"), "service_agreements"),
    rows(sel("identity_documents", "user_id, kind, uploaded_at"), "identity_documents"),
    rows(sel("report_pulls", PULL_COLUMNS), "report_pulls"),
    rows(sel("report_items", "*"), "report_items"),
    rows(sel("item_flags", "*"), "item_flags"),
    rows(sel("attack_rounds", "*"), "attack_rounds"),
    rows(sel("letters", "id, user_id, round_id, target_type, target_key, target_name, target_address_lines, template_key, escalation_stage, status, lob_id, mailed_at, created_at, mail_class, mail_provider, mail_status, tracking_number, delivered_at, returned_at, return_reason"), "letters"),
    rows(sel("mail_events", "*"), "mail_events"),
    rows(sel("payment_methods", "*"), "payment_methods"),
    rows(sel("charges", "*"), "charges"),
    rows(sel("refunds", "*"), "refunds"),
    rows(sel("billing_pauses", "*"), "billing_pauses"),
    rows(sel("chat_messages", "*").eq("channel", "app"), "chat_messages"),
    rows(sel("events", "id, user_id, kind, payload, created_at").eq("kind", "question_escalated"), "events"),
    rows(one ? db.from("staff_notes").select("*").or(`user_id.eq.${one},prospect_id.eq.${one}`) : db.from("staff_notes").select("*"), "staff_notes"),
    rows(sel("exception_marks", "*"), "exception_marks"),
    rows(sel("report_samples", "*"), "report_samples"),
    rows(sel("client_assignments", "*"), "client_assignments"),
    rows(
      one
        ? db.from("team_audit").select("*").eq("kind", "client_assigned").or(`client_id.eq.${one},prospect_id.eq.${one}`)
        : db.from("team_audit").select("*").eq("kind", "client_assigned"),
      "team_audit",
    ),
  ]);

  // Referral partners' names and codes, for a lead's source (migration 0017). A role that may not read them gets none.
  const partners = await rows(db.from("partners").select("id, name, referral_code"), "partners");

  // letter_items has no user_id: read those of the letters this member can see.
  const letterIds = letters.map((l) => String(l.id));
  const letterItems = letterIds.length > 0 ? await rows(db.from("letter_items").select("*").in("letter_id", letterIds), "letter_items") : [];

  // The newest report of each client, with its JSON: the only pull read in full.
  const newestByUser = new Map<string, Row>();
  for (const pull of pulls) {
    const user = String(pull.user_id);
    const current = newestByUser.get(user);
    if (!current || String(pull.pulled_at) > String(current.pulled_at)) newestByUser.set(user, pull);
  }
  const newestIds = [...newestByUser.values()].map((p) => String(p.id));
  const raws = newestIds.length > 0 ? await rows(db.from("report_pulls").select("id, raw").in("id", newestIds), "report_pulls") : [];
  const newestRaw = Object.fromEntries(raws.map((r) => [String(r.id), r.raw]));

  return {
    ...EMPTY_STAFF_ROWS,
    profiles,
    prospects,
    staffMembers,
    agreements,
    documents,
    pulls,
    newestRaw,
    items,
    flags,
    rounds,
    letters,
    letterItems,
    mailEvents,
    paymentMethods,
    charges,
    refunds,
    pauses,
    chat,
    events,
    notes,
    marks,
    samples,
    assignments,
    audit,
    partners,
  };
}

/** The clients this member may see, mapped. */
export async function loadStaffClients(db: SupabaseClient, options: { clientId?: string } = {}): Promise<StaffClient[]> {
  const clients = clientsFromRows(await loadStaffRows(db, options));
  return options.clientId ? clients.filter((c) => c.id === options.clientId) : clients;
}
