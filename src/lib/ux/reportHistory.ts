"use client";

import { useEffect, useState } from "react";
import type { ClientReportEntry } from "../clientCase/server";
import { demoClientRawReport, DEMO_CLIENT_REPORT } from "../demo";
import { diffReports } from "../domain/diff";
import { parseReport } from "../domain/parser";
import type { NormalizedReport } from "../domain/types";
import { changeRecords, personalInfoChanges } from "../reports/reimport";
import type { StaffRound } from "../staff/types";
import { isSupabaseConfigured } from "../supabase/config";

// "My reports" in the client app (Más): every report in the client's file,
// newest first, with what each one changed, and the printable audit of each.
// With a database it is GET /api/report/history (their own reports only); in
// the demo, the sample report and an invented earlier one, compared with the
// same code the team's import uses. Never a score, never "deleted".

const DAY = 24 * 60 * 60 * 1000;

/** The demo's earlier report: the sample, 41 days before, with an old address and two accounts that later no longer appear. */
export function demoEarlierReport(now: Date): NormalizedReport {
  const raw = demoClientRawReport();
  raw.pulledAt = new Date(now.getTime() - 41 * DAY).toISOString();
  raw.bureaus.equifax!.personalInfo.push({ field: "address", value: "77 Former Ave, Pasadena, TX 77506" });
  raw.bureaus.experian!.tradelines.push({
    creditor: "Fingerhut",
    accountNumberMasked: "****5521",
    accountType: "credit_card",
    status: "charge_off",
    paymentStatus: "charge-off",
    balance: 412,
    remarks: [],
  });
  raw.bureaus.transunion!.inquiries.push({ inquirer: "Auto Lender Inc", date: "2026-03-02", type: "hard" });
  return parseReport(raw);
}

/** The demo's list, newest first: two reports, the second compared with the first. */
export function demoClientReportHistory(now: Date): ClientReportEntry[] {
  const earlier = demoEarlierReport(now);
  const current: NormalizedReport = { ...DEMO_CLIENT_REPORT, pulledAt: now.toISOString() };
  const diff = diffReports(earlier, current);
  // Round 1, as the demo tells it, disputed the old address and a name variant.
  const disputed = earlier.items.filter((i) => i.category === "personal_info" && /Former Ave|JR/.test(i.name));
  const round = {
    number: 1,
    status: "responded",
    mailedAt: new Date(now.getTime() - 37 * DAY).toISOString(),
    respondedAt: now.toISOString(),
    letters: [{ items: disputed }],
  } as unknown as StaffRound;
  const changes = changeRecords(personalInfoChanges([round], current));
  const base = { source: current.source, skippedPersonalInfo: 0, reappeared: 0 };
  return [
    {
      ...base,
      id: "demo-2",
      at: current.pulledAt,
      reportDate: current.pulledAt,
      itemCount: current.items.length,
      first: false,
      removed: diff.deleted.length,
      added: diff.added.length,
      changed: diff.changed.length,
      closedRound: 1,
      personalInfo: changes,
      byTeam: true,
    },
    {
      ...base,
      id: "demo-1",
      at: earlier.pulledAt,
      reportDate: earlier.pulledAt,
      itemCount: earlier.items.length,
      first: true,
      removed: 0,
      added: 0,
      changed: 0,
      closedRound: null,
      personalInfo: [],
      byTeam: true,
    },
  ];
}

/** One of the demo's reports, for its audit page. */
export function demoClientReportById(id: string, now: Date): NormalizedReport | null {
  if (id === "demo-2") return { ...DEMO_CLIENT_REPORT, pulledAt: now.toISOString() };
  if (id === "demo-1") return demoEarlierReport(now);
  return null;
}

export function useClientReportHistory(): { ready: boolean; entries: ClientReportEntry[]; live: boolean } {
  const live = isSupabaseConfigured();
  const [state, setState] = useState<{ entries: ClientReportEntry[]; live: boolean } | null>(null);
  useEffect(() => {
    if (!live) {
      setState({ entries: demoClientReportHistory(new Date()), live: false });
      return;
    }
    let cancelled = false;
    fetch("/api/report/history", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ authenticated: boolean; entries?: ClientReportEntry[] }>) : null))
      .then((body) => {
        if (cancelled) return;
        if (body && body.authenticated) setState({ entries: body.entries ?? [], live: true });
        else setState({ entries: demoClientReportHistory(new Date()), live: false });
      })
      .catch(() => !cancelled && setState({ entries: [], live: true }));
    return () => {
      cancelled = true;
    };
  }, [live]);
  return { ready: state !== null, entries: state?.entries ?? [], live: state?.live ?? live };
}

/** One report of the client's, for the audit page. */
export async function loadClientReportForAudit(id: string): Promise<NormalizedReport | null> {
  if (!isSupabaseConfigured()) return demoClientReportById(id, new Date());
  const res = await fetch(`/api/report/history?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { authenticated?: boolean; report?: NormalizedReport } | null;
  if (body && body.authenticated === false) return demoClientReportById(id, new Date());
  return body?.report ?? null;
}
