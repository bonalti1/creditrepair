import type { SupabaseClient } from "@supabase/supabase-js";
import { offerFromRow, rankOffers, type Offer } from "./offers";
import { marksFromRows, type MarkState } from "./plan";
import { parseIdType, type IdType } from "./itin";
import { introRoute, type IntroHow, type IntroPartner } from "./connect";
import type { Graduation, GraduationReason } from "./graduation";
import { partnerHomeFromRows, type PartnerHomeRow } from "./homeReady";
import { partnerKindOf, type PartnerKind } from "../partners/rules";

// After-care on the database (migration 0030).
//
//  - The client's reads go through their OWN connection: their profile, their
//    marks, their completion, their introduction request (own-read policies),
//    and client_offers() / accepting_loan_officers() / client_sharing(), which
//    return only public facts.
//  - Writes go through the service role after the route checked who is asking.
//  - A partner reads home-ready milestones only through partner_home_ready(),
//    on the partner's own connection: the database decides.

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (typeof v === "string" || v instanceof Date) && !Number.isNaN(new Date(v as string).getTime()) ? new Date(v as string).toISOString() : null;
const kindOf = (v: unknown): PartnerKind => partnerKindOf(v);

export interface IntroRequest {
  id: string;
  partnerId: string;
  partnerName: string;
  how: IntroHow;
  at: string;
}

export interface AftercareState {
  idType: IdType | null;
  goal: string | null;
  marks: MarkState;
  graduation: Graduation | null;
  offersEnabled: boolean;
  offers: Offer[];
  /** Who "Connect me with a loan officer" goes to. */
  intro: { how: IntroHow; partners: IntroPartner[] };
  introRequest: IntroRequest | null;
  /** The partners this client may share home-ready milestones with, and whether they do. */
  homeShares: Array<{ partnerId: string; name: string; company: string | null; kind: PartnerKind; level: string; homeReady: boolean }>;
}

export function graduationFromRow(row: Row | null | undefined): Graduation | null {
  if (!row) return null;
  const at = iso(row.completed_at);
  if (!at) return null;
  return { completedAt: at, reason: row.reason === "disputes_done" ? "disputes_done" : "client_chose", keepTips: row.keep_tips !== false };
}

async function rowsOf(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

export async function loadAftercare(reader: SupabaseClient, userId: string): Promise<AftercareState> {
  const [profile, marks, completion, requests, enabled, offers, accepting, sharing, consents] = await Promise.all([
    rowsOf(reader.from("profiles").select("id_type, goal, referred_partner_id").eq("id", userId).limit(1), "profiles"),
    rowsOf(reader.from("aftercare_marks").select("seq, item_key, done, created_at").eq("user_id", userId), "aftercare_marks"),
    rowsOf(reader.from("program_completions").select("*").eq("user_id", userId).limit(1), "program_completions"),
    rowsOf(reader.from("loan_officer_requests").select("id, partner_id, how, partner_name_shown, created_at, withdrawn_at").eq("user_id", userId), "loan_officer_requests"),
    reader.rpc("offers_enabled"),
    reader.rpc("client_offers"),
    reader.rpc("accepting_loan_officers"),
    reader.rpc("client_sharing"),
    rowsOf(reader.from("partner_share_consents").select("partner_id, level, home_ready, seq").eq("user_id", userId), "partner_share_consents"),
  ]);
  for (const r of [enabled, offers, accepting, sharing]) if (r.error) throw new Error(r.error.message);
  const p = profile[0] ?? {};
  const linked = ((sharing.data as Row[] | null) ?? []).map((r) => ({
    id: String(r.partner_id),
    name: String(r.name),
    company: typeof r.company === "string" && r.company ? r.company : null,
    kind: kindOf(r.kind),
    status: String(r.status),
    referred: r.referred === true,
    level: String(r.level ?? "none"),
  }));
  const referring = linked.find((x) => x.referred) ?? null;
  const acceptingList: IntroPartner[] = ((accepting.data as Row[] | null) ?? []).map((r) => ({ id: String(r.partner_id), name: String(r.name), company: typeof r.company === "string" && r.company ? r.company : null, kind: kindOf(r.kind) }));
  const open = requests.find((r) => !r.withdrawn_at);
  const newest = new Map<string, Row>();
  for (const c of [...consents].sort((a, b) => Number(a.seq) - Number(b.seq))) newest.set(String(c.partner_id), c);
  return {
    idType: parseIdType(p.id_type),
    goal: typeof p.goal === "string" ? p.goal : null,
    marks: marksFromRows(marks),
    graduation: graduationFromRow(completion[0]),
    offersEnabled: enabled.data === true,
    offers: rankOffers(((offers.data as Row[] | null) ?? []).map(offerFromRow)),
    intro: introRoute(referring, acceptingList),
    introRequest: open
      ? { id: String(open.id), partnerId: String(open.partner_id), partnerName: String(open.partner_name_shown), how: open.how === "referred" ? "referred" : "accepting", at: iso(open.created_at) ?? new Date().toISOString() }
      : null,
    homeShares: linked
      .filter((x) => x.status === "approved" && (x.kind === "loan_officer" || x.kind === "realtor"))
      .map((x) => ({ partnerId: x.id, name: x.name, company: x.company, kind: x.kind, level: x.level, homeReady: x.level !== "none" && newest.get(x.id)?.home_ready === true })),
  };
}

/** One client's home-ready milestones for the signed-in partner, or [] when not shared. */
export async function loadPartnerHomeReady(reader: SupabaseClient, clientId: string): Promise<PartnerHomeRow[]> {
  const { data, error } = await reader.rpc("partner_home_ready", { p_client: clientId });
  if (error) {
    // A database without migration 0030 has nothing to show.
    if (/does not exist|Could not find/i.test(error.message)) return [];
    throw new Error(`partner_home_ready: ${error.message}`);
  }
  return partnerHomeFromRows((data as Row[] | null) ?? []);
}

export async function recordGraduation(db: SupabaseClient, userId: string, reason: GraduationReason, keepTips: boolean, locale: "es" | "en"): Promise<Graduation> {
  const { data, error } = await db.from("program_completions").insert({ user_id: userId, reason, keep_tips: keepTips, locale }).select("*").single();
  if (error) throw new Error(error.message);
  return graduationFromRow(data as Row)!;
}
