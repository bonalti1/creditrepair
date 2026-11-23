"use client";

import { useEffect, useState } from "react";
import { DEMO_CLIENT_REPORT, DEMO_SCORE_HISTORY } from "../demo";
import type { NormalizedReport, ReportItem } from "../domain/types";
import { isSupabaseConfigured } from "../supabase/config";
import type { ReappearedFact } from "../clientCase/server";
import { fetchClientReport, type ReportAnswer } from "./caseApi";
import type { JourneyState } from "./journey";

// The client's report, for every screen that shows it (Home, the review, the
// letters, the rounds, the audit, the chat).
//
// Demo (Supabase not configured): the sample report, from the very first
// render, exactly as the screens always had it.
// With Supabase: the newest report the team imported into the client's
// account (GET /api/report, their own rows only). Until there is one, `waiting`
// is true and the screens say that the team is importing it.

export type ScoreHistory = ReadonlyArray<{ date: string; scores: Partial<Record<"equifax" | "experian" | "transunion", number>> }>;

export interface ClientReportView {
  report: NormalizedReport;
  items: ReportItem[];
  scoreHistory: ScoreHistory;
  /** The name and address the letters carry; null in the demo. */
  profile: { fullName: string; addressLines: string[] } | null;
  /** True when this is the client's own record, not the sample. */
  live: boolean;
  /** False only while the client's own report is being read. Always true in the demo. */
  ready: boolean;
  /** On the database, with no report on file yet. */
  waiting: boolean;
  /** Items a past round saw disappear that this report lists again: marked "Reappeared" for review. */
  reappeared: ReappearedFact[];
}

const DEMO_VIEW: ClientReportView = {
  report: DEMO_CLIENT_REPORT,
  items: DEMO_CLIENT_REPORT.items,
  scoreHistory: DEMO_SCORE_HISTORY,
  profile: null,
  live: false,
  ready: true,
  waiting: false,
  reappeared: [],
};

const EMPTY_REPORT: NormalizedReport = { pulledAt: "", source: "", items: [], scores: {} };

/** The view a server answer gives. Signed out (no account): the sample, as everywhere else in the app. */
export function reportView(answer: ReportAnswer | null): ClientReportView {
  if (!answer) return { ...DEMO_VIEW, report: EMPTY_REPORT, items: [], scoreHistory: [], live: true, ready: false };
  if (!answer.authenticated) return DEMO_VIEW;
  const report = answer.report ?? EMPTY_REPORT;
  return {
    report,
    items: report.items,
    scoreHistory: answer.scoreHistory,
    profile: answer.profile,
    live: true,
    ready: true,
    waiting: answer.report === null,
    reappeared: answer.reappeared ?? [],
  };
}

export function useClientReport(): ClientReportView {
  const live = isSupabaseConfigured();
  const [answer, setAnswer] = useState<ReportAnswer | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    fetchClientReport()
      .then((a) => {
        if (!cancelled) setAnswer(a);
      })
      // The server could not be reached: the screens say the report is on its way rather than show the sample.
      .catch(() => {
        if (!cancelled) setAnswer({ authenticated: true, report: null, scoreHistory: [], profile: { fullName: "", addressLines: [] } });
      });
    return () => {
      cancelled = true;
    };
  }, [live]);
  return live ? reportView(answer) : DEMO_VIEW;
}

/**
 * The journey with the report's real state: no report on file yet is the "import" step.
 * In the demo only the mailing date changes: the one this device saved, when there is one.
 */
export function withReport(state: JourneyState, view: Pick<ClientReportView, "live" | "waiting">, mailedAt?: string | null): JourneyState {
  if (!view.live) return mailedAt && state.roundApproved ? { ...state, mailedAt } : state;
  return { ...state, reportImported: !view.waiting, ...(mailedAt !== undefined ? { mailedAt: state.roundApproved ? mailedAt : null } : {}) };
}
