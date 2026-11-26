import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "../supabase/admin";
import { registerLiveFunnelSource, type LiveFunnelSource, type VideoEvents } from "../webinars/live";

// The live funnel, as the Webinars section reads it (docs/WEBINARS.md, «How
// the live funnel plugs in»; docs/LIVE-FUNNEL.md, «For the Webinars
// section»). Imported once, at the top of src/lib/webinars/server.ts, so the
// live console, the webinar page and the campaign scorecard count, for the
// leads they already chose:
//
//   reports   the lead uploaded their report on /live   (live_leads.report_at)
//   sent      their personal video went out             (video_sent_at)
//   watched   they watched it (80 % or to the end)       (video_watched_at)
//   started   they tapped «Get started» on /v/<token>   (started_at)
//
// Only these four facts are read, by lead id: no name, no phone, no report
// data. The Webinars routes check the member's capability first; the facts
// are read with the service role, like the counts a specialist sees.

type Row = Record<string, unknown>;

export const LIVE_FUNNEL_SOURCE_ID = "live-funnel";

/** Ids per query: a long `in (...)` list would not fit in a URL. */
const CHUNK = 200;

/** The four facts, from live_leads rows. Pure. */
export function funnelEventsFromRows(rows: readonly Row[]): Required<VideoEvents> {
  const sent = new Set<string>();
  const watched = new Set<string>();
  const reports = new Set<string>();
  const started = new Set<string>();
  for (const r of rows) {
    const id = String(r.lead_id ?? "");
    if (!id) continue;
    if (r.report_at) reports.add(id);
    if (r.video_sent_at) sent.add(id);
    if (r.video_watched_at) watched.add(id);
    if (r.started_at) started.add(id);
  }
  return { sent, watched, reports, started };
}

/** The funnel's facts for these leads, read through `db`. */
export async function loadFunnelEvents(db: SupabaseClient, leadIds: readonly string[]): Promise<Required<VideoEvents>> {
  const ids = [...new Set(leadIds)].filter(Boolean);
  const all: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from("live_leads").select("lead_id, report_at, video_sent_at, video_watched_at, started_at").in("lead_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`live_leads: ${error.message}`);
    all.push(...((data as Row[] | null) ?? []));
  }
  return funnelEventsFromRows(all);
}

/** The source the Webinars section reads (service role; none configured: an error, so the counters say "No data yet"). */
export function liveFunnelWebinarSource(connect: () => SupabaseClient | null = getAdminClient): LiveFunnelSource {
  return {
    id: LIVE_FUNNEL_SOURCE_ID,
    async videos(leadIds) {
      const db = connect();
      if (!db) throw new Error("live funnel: no database");
      return loadFunnelEvents(db, leadIds);
    },
  };
}

registerLiveFunnelSource(liveFunnelWebinarSource());
