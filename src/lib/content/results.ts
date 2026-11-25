import { RESULT_METRICS, type Channel, type ContentPiece, type ContentResult, type ResultMetric, type Theme } from "./types";

// Results: real numbers only. A metric nobody measured is null and reads
// "No data yet"; it is never shown as 0. Entries are kept as they were typed
// or read (append-only); the newest value of each metric on each channel
// counts, and a piece's total adds its channels.
//
// Leads are linked to a piece through its campaign code: the piece's links
// carry utm_content=<code> (types.ts trackedLink), and a lead's first touch
// (prospects.source_detail.firstTouch, migration 0017) keeps the UTM tags it
// arrived with. A count appears only where at least one lead matched; with
// no match there is no evidence either way, so it stays "No data yet".

export type MetricValues = Record<ResultMetric, number | null>;

const empty = (): MetricValues => Object.fromEntries(RESULT_METRICS.map((m) => [m, null])) as MetricValues;

/** The newest value of each metric on each channel of one piece. */
export function latestByChannel(results: readonly ContentResult[], pieceId: string): Map<Channel, MetricValues> {
  const out = new Map<Channel, MetricValues>();
  const sorted = results.filter((r) => r.pieceId === pieceId).sort((a, b) => (a.at < b.at ? -1 : 1));
  for (const r of sorted) {
    const row = out.get(r.channel) ?? empty();
    for (const metric of RESULT_METRICS) {
      const value = r.values[metric];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) row[metric] = value;
    }
    out.set(r.channel, row);
  }
  return out;
}

/** Add values where they exist; null stays null only when every side is null. */
export function addValues(a: MetricValues, b: MetricValues): MetricValues {
  const out = empty();
  for (const m of RESULT_METRICS) out[m] = a[m] === null && b[m] === null ? null : (a[m] ?? 0) + (b[m] ?? 0);
  return out;
}

export interface Attribution {
  /** Leads whose first touch carried the piece's code. */
  leads: number;
  /** Of those, how many became clients (created their account). */
  clients: number;
}

/** A lead's first touch, as the attribution needs it. */
export interface LeadTouch {
  campaign?: string | null;
  utmContent?: string | null;
  utmCampaign?: string | null;
  converted: boolean;
}

/** Leads per campaign code, from the leads' first-touch tags. */
export function attributeLeads(pieces: readonly Pick<ContentPiece, "campaignCode">[], leads: readonly LeadTouch[]): Map<string, Attribution> {
  const codes = new Set(pieces.map((p) => p.campaignCode.toLowerCase()));
  const out = new Map<string, Attribution>();
  for (const lead of leads) {
    const code = [lead.utmContent, lead.utmCampaign, lead.campaign].map((v) => (v ?? "").trim().toLowerCase()).find((v) => codes.has(v));
    if (!code) continue;
    const row = out.get(code) ?? { leads: 0, clients: 0 };
    row.leads += 1;
    if (lead.converted) row.clients += 1;
    out.set(code, row);
  }
  return out;
}

export interface PieceResults {
  piece: ContentPiece;
  byChannel: Map<Channel, MetricValues>;
  totals: MetricValues;
  attribution: Attribution | null;
  /** True when any number exists for the piece. */
  hasData: boolean;
}

export function pieceResults(piece: ContentPiece, results: readonly ContentResult[], attribution: Map<string, Attribution> = new Map()): PieceResults {
  const byChannel = latestByChannel(results, piece.id);
  let totals = empty();
  for (const values of byChannel.values()) totals = addValues(totals, values);
  const attributed = attribution.get(piece.campaignCode.toLowerCase()) ?? null;
  const hasData = RESULT_METRICS.some((m) => totals[m] !== null) || attributed !== null;
  return { piece, byChannel, totals, attribution: attributed, hasData };
}

export interface ThemeResults {
  theme: Theme;
  pieces: number;
  posted: number;
  withData: number;
  totals: MetricValues;
  attributedLeads: number | null;
  attributedClients: number | null;
}

/** Results by theme: what kind of content brings people in. */
export function themeResults(rows: readonly PieceResults[]): ThemeResults[] {
  const out = new Map<Theme, ThemeResults>();
  for (const row of rows) {
    const t = out.get(row.piece.theme) ?? { theme: row.piece.theme, pieces: 0, posted: 0, withData: 0, totals: empty(), attributedLeads: null, attributedClients: null };
    t.pieces += 1;
    if (row.piece.posts.length > 0 || ["posted", "measured"].includes(row.piece.status)) t.posted += 1;
    if (row.hasData) t.withData += 1;
    t.totals = addValues(t.totals, row.totals);
    if (row.attribution) {
      t.attributedLeads = (t.attributedLeads ?? 0) + row.attribution.leads;
      t.attributedClients = (t.attributedClients ?? 0) + row.attribution.clients;
    }
    out.set(row.piece.theme, t);
  }
  return [...out.values()].sort((a, b) => b.withData - a.withData || b.posted - a.posted);
}

/** Validate a manual entry: whole numbers from 0, at least one, leads and clients never above clicks when both are given. */
export function resultEntryProblem(values: Partial<Record<ResultMetric, number | null>>): string | null {
  const given = RESULT_METRICS.filter((m) => values[m] !== undefined && values[m] !== null);
  if (given.length === 0) return "empty";
  for (const m of given) {
    const v = values[m]!;
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000_000) return "not_a_count";
  }
  if (values.signed != null && values.leads != null && values.signed > values.leads) return "more_clients_than_leads";
  return null;
}

/** "12,400" / "12.400". */
export function formatCount(n: number, locale: "en" | "es"): string {
  return new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US").format(n);
}
