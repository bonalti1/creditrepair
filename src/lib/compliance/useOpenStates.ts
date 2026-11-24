"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import type { StateOpening } from "./stateOpenings";
import { DEFAULT_OPEN_STATES, stateStatus, type OpeningRequest, openingProblems, type StateStatus } from "./states";

// The opened states for a screen. With a database: GET /api/states (public)
// and, for the team's page, /api/staff/states. In the demo: this browser
// keeps the switches (starting with Texas open). Until the answer arrives,
// only the launch state counts as open: a screen never opens more than the
// server would.

export const STATES_KEY = "bonalti.states.v1";

function readLocal(): StateOpening[] {
  try {
    const raw = window.localStorage.getItem(STATES_KEY);
    const parsed = raw ? (JSON.parse(raw) as StateOpening[]) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return DEFAULT_OPEN_STATES.map((state) => ({ state, opened: true, attorneyName: null, attorneyReviewedOn: null, registrationRef: null, bondConfirmed: false, note: "Launch state (Phase 0).", updatedAt: null, updatedBy: null }));
}

function writeLocal(rows: StateOpening[]): void {
  try {
    window.localStorage.setItem(STATES_KEY, JSON.stringify(rows));
  } catch {
    // Storage unavailable: the demo forgets the change.
  }
}

export function useOpenStates(): { ready: boolean; opened: string[]; status: (code: string) => StateStatus } {
  const live = isSupabaseConfigured();
  const [opened, setOpened] = useState<string[] | null>(null);
  useEffect(() => {
    if (!live) {
      setOpened(readLocal().filter((r) => r.opened).map((r) => r.state));
      return;
    }
    let cancelled = false;
    fetch("/api/states", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ opened?: string[] }>) : null))
      .then((body) => !cancelled && setOpened(body?.opened ?? [...DEFAULT_OPEN_STATES]))
      .catch(() => !cancelled && setOpened([...DEFAULT_OPEN_STATES]));
    return () => {
      cancelled = true;
    };
  }, [live]);
  const list = opened ?? [...DEFAULT_OPEN_STATES];
  return { ready: opened !== null, opened: list, status: (code: string) => stateStatus(code, list) };
}

/** The team's page: every decision on record, and the switch. */
export function useStateOpenings() {
  const live = isSupabaseConfigured();
  const [rows, setRows] = useState<StateOpening[] | null>(null);
  const reload = useCallback(async () => {
    if (!live) return setRows(readLocal());
    try {
      const res = await fetch("/api/staff/states", { cache: "no-store" });
      setRows(res.ok ? (((await res.json()) as { openings: StateOpening[] }).openings ?? []) : []);
    } catch {
      setRows([]);
    }
  }, [live]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (req: OpeningRequest & { note?: string | null }): Promise<{ ok: true } | { ok: false; problems: string[] }> => {
      if (!live) {
        const problems = openingProblems(req);
        if (problems.length > 0) return { ok: false, problems };
        const current = readLocal().filter((r) => r.state !== req.state);
        current.push({
          state: req.state,
          opened: req.opened,
          attorneyName: req.attorneyName ?? null,
          attorneyReviewedOn: req.attorneyReviewedOn ?? null,
          registrationRef: req.registrationRef ?? null,
          bondConfirmed: Boolean(req.bondConfirmed),
          note: req.note ?? null,
          updatedAt: new Date().toISOString(),
          updatedBy: "demo",
        });
        writeLocal(current);
        await reload();
        return { ok: true };
      }
      try {
        const res = await fetch("/api/staff/states", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
        const body = (await res.json().catch(() => ({}))) as { problems?: string[] };
        await reload();
        return res.ok ? { ok: true } : { ok: false, problems: body.problems ?? ["error"] };
      } catch {
        return { ok: false, problems: ["network"] };
      }
    },
    [live, reload],
  );
  return { live, ready: rows !== null, rows: rows ?? [], save };
}
