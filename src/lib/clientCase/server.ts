import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReport } from "../domain/parser";
import { historyFromPullRows } from "../reports/history";
import type { ReportHistoryEntry } from "../staff/types";
import type { Bureau, LetterTargetType, NormalizedReport } from "../domain/types";
import type { ClientLetterMail } from "../mail/clientView";
import type { MailClass, MailStatus } from "../mail/types";

// The client app's own case, read on the server for the signed-in client.
//
// `db` is the client's OWN connection (cookie-bound): row level security
// ("own … read", migrations 0001 and 0006) shows them their rows and nobody
// else's. These are the reads behind GET /api/report and GET /api/rounds,
// which the client app's stores use when Supabase is configured.

type Row = Record<string, unknown>;

export interface ScorePoint {
  date: string;
  scores: Partial<Record<Bureau, number>>;
}

export interface ClientReportPayload {
  /** The newest report on file; null until the team imports the first one. */
  report: NormalizedReport | null;
  /** Scores per report, oldest first (at most the last 12). */
  scoreHistory: ScorePoint[];
  /** What the letters print as the sender. */
  profile: { fullName: string; addressLines: string[] };
  /**
   * Items a round's results recorded as gone that the newest report lists
   * again (FCRA § 611(a)(5)(B)): marked "Reappeared" in the client's review.
   * Absent: none.
   */
  reappeared?: ReappearedFact[];
}

export interface ReappearedFact {
  fingerprint: string;
  /** The round whose results recorded it as gone. */
  round: number;
  /** The date of the report that no longer listed it. */
  goneOn: string;
}

/** Items of `report` a round recorded as gone on an earlier report (attack_rounds.results). Pure. */
export function reappearedFacts(report: NormalizedReport | null, roundRows: readonly Row[]): ReappearedFact[] {
  if (!report) return [];
  const gone = new Map<string, ReappearedFact>();
  for (const r of roundRows) {
    for (const result of Array.isArray(r.results) ? (r.results as unknown[]) : []) {
      const row = result as { fingerprint?: unknown; outcome?: unknown; reportDate?: unknown } | null;
      if (!row || row.outcome !== "removed" || typeof row.fingerprint !== "string" || typeof row.reportDate !== "string") continue;
      const known = gone.get(row.fingerprint);
      if (!known || row.reportDate > known.goneOn) gone.set(row.fingerprint, { fingerprint: row.fingerprint, round: Number(r.round_number), goneOn: row.reportDate });
    }
  }
  const pulled = new Date(report.pulledAt).getTime();
  return report.items.flatMap((item) => {
    const fact = gone.get(item.fingerprint);
    return fact && new Date(fact.goneOn).getTime() < pulled ? [fact] : [];
  });
}

/** One report in the client's file, as the client's "My reports" shows it: no teammate's name, no reader. */
export interface ClientReportEntry extends Omit<ReportHistoryEntry, "by" | "readerKey"> {
  /** True when the team brought it in; false when the monitoring service sent it by itself. */
  byTeam: boolean;
}

/** Every report in the signed-in client's file, newest first, with what each one changed. Own rows only (RLS). */
export async function loadClientReportHistory(db: SupabaseClient, userId: string): Promise<ClientReportEntry[]> {
  const { data, error } = await db
    .from("report_pulls")
    .select("id, pulled_at, created_at, source, reader_key, import_summary")
    .eq("user_id", userId)
    .order("pulled_at", { ascending: true })
    .limit(60);
  if (error) throw new Error(`report_pulls: ${error.message}`);
  return historyFromPullRows((data as Row[] | null) ?? [])
    .map(({ by: _by, readerKey, ...entry }) => ({ ...entry, byTeam: readerKey !== null }))
    .reverse();
}

/** One report of the signed-in client's, read again from its stored JSON. Null when it is not theirs or does not read. */
export async function loadClientReportById(db: SupabaseClient, userId: string, pullId: string): Promise<NormalizedReport | null> {
  const { data, error } = await db.from("report_pulls").select("id, raw").eq("user_id", userId).eq("id", pullId).maybeSingle();
  if (error || !data) return null;
  try {
    return parseReport((data as Row).raw);
  } catch {
    return null;
  }
}

const BUREAUS: readonly Bureau[] = ["equifax", "experian", "transunion"];

function scoresOf(raw: unknown): Partial<Record<Bureau, number>> {
  const bureaus = (raw as { bureaus?: Record<string, { score?: unknown } | undefined> } | null)?.bureaus ?? {};
  const out: Partial<Record<Bureau, number>> = {};
  for (const bureau of BUREAUS) {
    const score = bureaus[bureau]?.score;
    if (typeof score === "number" && Number.isFinite(score)) out[bureau] = score;
  }
  return out;
}

export async function loadClientReport(db: SupabaseClient, userId: string): Promise<ClientReportPayload> {
  const [pulls, profile, rounds] = await Promise.all([
    db.from("report_pulls").select("id, pulled_at, raw").eq("user_id", userId).order("pulled_at", { ascending: false }).limit(12),
    db.from("profiles").select("full_name, address_lines").eq("id", userId).maybeSingle(),
    db.from("attack_rounds").select("round_number, results").eq("user_id", userId),
  ]);
  if (pulls.error) throw new Error(`report_pulls: ${pulls.error.message}`);
  const rows = (pulls.data as Row[] | null) ?? [];
  let report: NormalizedReport | null = null;
  try {
    report = rows[0] ? parseReport(rows[0].raw) : null;
  } catch {
    report = null;
  }
  const scoreHistory = [...rows].reverse().map((row) => ({ date: String(row.pulled_at).slice(0, 10), scores: scoresOf(row.raw) }));
  const p = (profile.data as Row | null) ?? {};
  const reappeared = reappearedFacts(report, rounds.error ? [] : ((rounds.data as Row[] | null) ?? []));
  return {
    report,
    ...(reappeared.length > 0 ? { reappeared } : {}),
    scoreHistory,
    profile: { fullName: typeof p.full_name === "string" ? p.full_name : "", addressLines: Array.isArray(p.address_lines) ? (p.address_lines as string[]) : [] },
  };
}

export interface ClientRoundLetter {
  targetType: LetterTargetType;
  targetKey: string;
  templateKey: string;
  mail: ClientLetterMail;
}

export interface ClientRoundPayload {
  /** The newest round the team mailed; null while none has gone out. */
  round: {
    number: number;
    /** "mailed": the bureaus' window is running. "complete": a newer report came in. */
    status: "mailed" | "complete";
    mailedAt: string;
    /** The report items the round's letters cover. */
    fingerprints: string[];
    letters: ClientRoundLetter[];
  } | null;
}

const MAIL_CLASSES: readonly MailClass[] = ["first_class", "certified", "certified_return_receipt"];
const MAIL_STATUSES: readonly MailStatus[] = ["not_sent", "in_transit", "delivered", "returned", "undeliverable"];
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export async function loadClientRound(db: SupabaseClient, userId: string): Promise<ClientRoundPayload> {
  const rounds = await db
    .from("attack_rounds")
    .select("id, round_number, status, mailed_at")
    .eq("user_id", userId)
    .in("status", ["mailed", "complete"])
    .order("round_number", { ascending: false })
    .limit(1);
  if (rounds.error) throw new Error(`attack_rounds: ${rounds.error.message}`);
  const round = ((rounds.data as Row[] | null) ?? [])[0];
  if (!round || !isoOrNull(round.mailed_at)) return { round: null };

  const letters = await db
    .from("letters")
    .select("id, target_type, target_key, template_key, status, mail_class, mail_status, mailed_at, delivered_at, returned_at")
    .eq("user_id", userId)
    .eq("round_id", String(round.id));
  if (letters.error) throw new Error(`letters: ${letters.error.message}`);
  const sent = ((letters.data as Row[] | null) ?? []).filter((l) => l.status !== "draft");
  const links = sent.length > 0 ? await db.from("letter_items").select("letter_id, item_id").in("letter_id", sent.map((l) => String(l.id))) : { data: [], error: null };
  if (links.error) throw new Error(`letter_items: ${links.error.message}`);
  const itemIds = [...new Set(((links.data as Row[] | null) ?? []).map((l) => String(l.item_id)))];
  const items = itemIds.length > 0 ? await db.from("report_items").select("id, fingerprint").in("id", itemIds) : { data: [], error: null };
  if (items.error) throw new Error(`report_items: ${items.error.message}`);

  return {
    round: {
      number: Number(round.round_number),
      status: round.status === "complete" ? "complete" : "mailed",
      mailedAt: isoOrNull(round.mailed_at)!,
      fingerprints: ((items.data as Row[] | null) ?? []).map((i) => String(i.fingerprint)),
      letters: sent.map((l) => ({
        targetType: String(l.target_type) as LetterTargetType,
        targetKey: String(l.target_key),
        templateKey: String(l.template_key),
        mail: {
          mailClass: MAIL_CLASSES.find((c) => c === l.mail_class) ?? "first_class",
          status: MAIL_STATUSES.find((s) => s === l.mail_status) ?? "in_transit",
          mailedAt: isoOrNull(l.mailed_at),
          deliveredAt: isoOrNull(l.delivered_at),
          returnedAt: isoOrNull(l.returned_at),
        },
      })),
    },
  };
}
