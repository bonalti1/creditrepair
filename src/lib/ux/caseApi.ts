"use client";

import type { ClientReportPayload, ClientRoundPayload } from "../clientCase/server";

// The client's own case from the server (GET /api/report, GET /api/rounds),
// read once per page load and shared by every store that needs it. Called
// only when Supabase is configured (supabase/config.ts); the demo never asks.

export type ReportAnswer = ({ authenticated: true } & ClientReportPayload) | { authenticated: false };
export type RoundAnswer = ({ authenticated: true } & ClientRoundPayload) | { authenticated: false };

let report: Promise<ReportAnswer> | null = null;
let round: Promise<RoundAnswer> | null = null;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function fetchClientReport(): Promise<ReportAnswer> {
  report ??= get<ReportAnswer>("/api/report").catch((error) => {
    report = null;
    throw error;
  });
  return report;
}

export function fetchClientRound(): Promise<RoundAnswer> {
  round ??= get<RoundAnswer>("/api/rounds").catch((error) => {
    round = null;
    throw error;
  });
  return round;
}

/** Forget what was read, so the next screen reads again (after the client changes something). */
export function forgetClientCase(): void {
  report = null;
  round = null;
}
