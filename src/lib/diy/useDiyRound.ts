"use client";

import { useCallback, useEffect, useState } from "react";
import { demoOfferedPlan } from "../billing/planData";
import { isSupabaseConfigured } from "../supabase/config";
import { forgetClientCase } from "../ux/caseApi";
import type { DiyRound } from "./server";
import { mailFeeCents } from "./rules";

// Credalti DIY, the client's letters page: the round Alti prepared, "I mailed
// them" and "Mail them for me". With a database: /api/attacks/approve
// (prepare) and /api/diy. The demo: this device only, marked as a demo, with
// the demo catalogue's DIY plan for the fee per letter.

export const DIY_DEMO_KEY = "credalti.diyDemo.v1";

export interface DiyDemoState {
  preparedAt: string | null;
  mailedOn: string | null;
  request: { letters: number; totalCents: number; at: string; mailedAt: string | null } | null;
}

const EMPTY: DiyDemoState = { preparedAt: null, mailedOn: null, request: null };

function readDemo(): DiyDemoState {
  try {
    const raw = window.localStorage.getItem(DIY_DEMO_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<DiyDemoState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeDemo(state: DiyDemoState): void {
  try {
    window.localStorage.setItem(DIY_DEMO_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable
  }
}

export type DiyActionResult = { ok: true } | { ok: false; code: string };

export interface DiyView {
  hydrated: boolean;
  demo: boolean;
  /** With a database: the prepared round as the server has it. */
  round: DiyRound | null;
  /** True once the letters of the current round are prepared. */
  prepared: boolean;
  preparedAt: string | null;
  /** The fee per letter in the signed plan (the demo: the demo plan's); null when mailing is not offered. */
  feeCents: number | null;
  request: { letters: number; totalCents: number; status: "requested" | "mailed"; mailedAt: string | null } | null;
  prepare(roundNumber: number): Promise<DiyActionResult>;
  markMailed(roundNumber: number, mailedOn: string): Promise<DiyActionResult>;
  mailForMe(roundNumber: number, letters: number, totalCents: number, letterIds?: string[]): Promise<DiyActionResult>;
  /** Demo only: start over. */
  reset(): void;
}

export function useDiyRound(): DiyView {
  const demo = !isSupabaseConfigured();
  const [hydrated, setHydrated] = useState(false);
  const [round, setRound] = useState<DiyRound | null>(null);
  const [state, setState] = useState<DiyDemoState>(EMPTY);

  const load = useCallback(async () => {
    if (demo) {
      setState(readDemo());
      return;
    }
    const res = await fetch("/api/diy", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? ((await res.json()) as { authenticated?: boolean; round?: DiyRound | null }) : null;
    if (body?.authenticated) setRound(body.round ?? null);
    else setState(readDemo());
  }, [demo]);

  useEffect(() => {
    void load().finally(() => setHydrated(true));
  }, [load]);

  const post = async (path: string, body: unknown): Promise<DiyActionResult> => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false, code: "network" };
    const json = (await res.json().catch(() => ({}))) as { code?: string; round?: DiyRound | null };
    if (!res.ok) return { ok: false, code: json.code ?? `http_${res.status}` };
    if (json.round !== undefined) setRound(json.round ?? null);
    forgetClientCase();
    return { ok: true };
  };

  const serverRound = round && round.status === "draft" && round.letters.length > 0 ? round : null;
  const demoFee = mailFeeCents(demoOfferedPlan("diy"));
  const request = demo || !round
    ? state.request
      ? { letters: state.request.letters, totalCents: state.request.totalCents, status: state.request.mailedAt ? ("mailed" as const) : ("requested" as const), mailedAt: state.request.mailedAt }
      : null
    : round.request
      ? { letters: round.request.letterCount, totalCents: round.request.totalCents, status: round.request.status === "mailed" ? ("mailed" as const) : ("requested" as const), mailedAt: round.request.mailedAt }
      : null;

  return {
    hydrated,
    demo,
    round,
    prepared: demo || !round ? Boolean(state.preparedAt) : Boolean(serverRound),
    preparedAt: demo || !round ? state.preparedAt : (serverRound?.preparedAt ?? null),
    feeCents: demo || !round ? demoFee : round.feeCents,
    request,
    async prepare(roundNumber) {
      if (demo || !isSupabaseConfigured()) {
        const next = { ...readDemo(), preparedAt: new Date().toISOString() };
        writeDemo(next);
        setState(next);
        return { ok: true };
      }
      const result = await post("/api/attacks/approve", { roundNumber });
      if (result.ok) await load();
      return result;
    },
    async markMailed(roundNumber, mailedOn) {
      if (demo) {
        const next = { ...readDemo(), mailedOn };
        writeDemo(next);
        setState(next);
        return { ok: true };
      }
      return post("/api/diy", { action: "mailed", roundNumber, mailedOn });
    },
    async mailForMe(roundNumber, letters, totalCents, letterIds) {
      if (demo) {
        // The demo: the request is recorded and "mailed" at once, so the whole path can be seen. Nothing is sent or charged.
        const at = new Date().toISOString();
        const next = { ...readDemo(), request: { letters, totalCents, at, mailedAt: at } };
        writeDemo(next);
        setState(next);
        return { ok: true };
      }
      return post("/api/diy", { action: "mail_for_me", roundNumber, acceptedTotalCents: totalCents, ...(letterIds ? { letterIds } : {}) });
    },
    reset() {
      writeDemo(EMPTY);
      setState(EMPTY);
    },
  };
}
