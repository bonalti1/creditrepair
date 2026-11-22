"use client";

import { useCallback, useEffect, useState } from "react";
import type { DisputeReasonCode } from "../letters/reasons";
import { isSupabaseConfigured } from "../supabase/config";
import { fetchClientRound } from "./caseApi";
import { isDisputeReasonCode } from "./disputeReason";

// Shared review state so the user's decisions follow them across pages
// (dashboard, item wizard, letters page). One of the core "10x" bets: the
// app always knows where you left off — you never re-review.
// Signed in: server-backed (item_flags via /api/flags, RLS-scoped) with
// write-through. Signed out / demo: localStorage only.

export type ReviewState = "correct" | "flagged" | "attested";

export interface StoredFlag {
  state: ReviewState;
  /** The customer's own words about what is wrong. Never printed in a letter. */
  reason?: string;
  /**
   * The standard reason picked from the catalogue (letters/reasons.ts): what the
   * letter prints after the item. Missing on answers saved before reasons existed.
   */
  reasonCode?: DisputeReasonCode;
  attestedAt?: string;
  /**
   * The data checks (domain/checks.ts) whose facts the customer chose to
   * include in their letter, by check id. Only ever set by the customer ticking
   * "include" after picking a reason those checks relate to. Missing: none.
   */
  checkIds?: string[];
}

export type FlagsMap = Record<string, StoredFlag>;

export const STORAGE_KEY = "bonalti.review.v1";
export const APPROVED_KEY = "bonalti.roundApproved.v1";
/** The answers as they were when the round was approved: what the mailed letters were built from. */
export const MAILED_KEY = "bonalti.roundMailed.v1";
/** When the round was approved (ISO). Missing on a round approved before dates were kept. */
export const MAILED_AT_KEY = "bonalti.roundMailedAt.v1";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const STATES: ReadonlySet<string> = new Set(["correct", "flagged", "attested"]);

/**
 * Stored answers as this version reads them. The saved shape only ever gained
 * fields, so answers saved before reasons existed load unchanged, without a
 * reason code. An entry that is not an answer is dropped; a reason code that
 * is not in the catalogue is dropped and the answer itself is kept.
 */
export function normalizeFlags(raw: unknown): FlagsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const flags: FlagsMap = {};
  for (const [fingerprint, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.state !== "string" || !STATES.has(v.state)) continue;
    const flag: StoredFlag = { state: v.state as ReviewState };
    if (typeof v.reason === "string") flag.reason = v.reason;
    if (isDisputeReasonCode(v.reasonCode)) flag.reasonCode = v.reasonCode;
    if (typeof v.attestedAt === "string") flag.attestedAt = v.attestedAt;
    if (Array.isArray(v.checkIds)) {
      const ids = v.checkIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 20);
      if (ids.length > 0) flag.checkIds = ids;
    }
    flags[fingerprint] = flag;
  }
  return flags;
}

/**
 * The answers a mailed round's letters were built from, as the database keeps
 * them: every item the round's letters cover counts as confirmed, with the
 * client's answer when it is still on record. An answer changed afterwards
 * does not rewrite what was mailed.
 */
export function roundSnapshot(flags: FlagsMap, fingerprints: readonly string[], mailedAt: string): FlagsMap {
  return Object.fromEntries(
    fingerprints.map((fp) => [fp, flags[fp]?.state === "attested" && flags[fp]?.attestedAt ? flags[fp]! : { state: "attested" as const, attestedAt: mailedAt }]),
  );
}

export function useFlags() {
  const [flags, setFlags] = useState<FlagsMap>({});
  const [roundApproved, setRoundApprovedState] = useState(false);
  const [mailedFlags, setMailedFlags] = useState<FlagsMap | null>(null);
  const [roundMailedAt, setRoundMailedAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    // With a database (supabase/config.ts), the client's own answers and the
    // rounds the team mailed are the record: nothing this browser kept from
    // before (or from the demo) is shown, not even for a moment.
    if (isSupabaseConfigured()) {
      let cancelled = false;
      Promise.all([
        fetch("/api/flags")
          .then((r) => (r.ok ? (r.json() as Promise<{ authenticated: boolean; flags: unknown }>) : null))
          .catch(() => null),
        fetchClientRound().catch(() => null),
      ])
        .then(([data, answer]) => {
          if (cancelled) return;
          if (data?.authenticated) {
            const server = normalizeFlags(data.flags);
            setFlags(server);
            setSynced(true);
            const round = answer?.authenticated ? answer.round : null;
            // The newest round the team mailed: its date, and the answers its letters were built from.
            setRoundApprovedState(Boolean(round));
            setRoundMailedAt(round?.mailedAt ?? null);
            setMailedFlags(round ? roundSnapshot(server, round.fingerprints, round.mailedAt) : null);
          } else {
            // Signed out: this device's copy, as in the demo.
            setFlags(normalizeFlags(load<unknown>(STORAGE_KEY, {})));
            setRoundApprovedState(load<boolean>(APPROVED_KEY, false));
          }
        })
        .finally(() => {
          if (!cancelled) setHydrated(true);
        });
      return () => {
        cancelled = true;
      };
    }

    setFlags(normalizeFlags(load<unknown>(STORAGE_KEY, {})));
    setRoundApprovedState(load<boolean>(APPROVED_KEY, false));
    const mailed = load<unknown>(MAILED_KEY, null);
    setMailedFlags(mailed ? normalizeFlags(mailed) : null);
    const mailedAt = load<unknown>(MAILED_AT_KEY, null);
    setRoundMailedAt(typeof mailedAt === "string" ? mailedAt : null);
    setHydrated(true);

    // When signed in, the server copy (item_flags, RLS-scoped) is the source
    // of truth; localStorage remains the demo/offline cache.
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { authenticated: boolean; flags: unknown } | null) => {
        if (data?.authenticated) {
          setFlags(normalizeFlags(data.flags));
          setSynced(true);
        }
      })
      .catch(() => undefined);
  }, []);

  const persist = useCallback((next: FlagsMap) => {
    setFlags(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode) — state stays in memory.
    }
  }, []);

  const writeThrough = useCallback(
    (fingerprint: string, state: ReviewState | null, reason?: string, reasonCode?: DisputeReasonCode, checkIds?: string[]) => {
      if (!synced) return;
      fetch("/api/flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, state, reason, reasonCode, checkIds, locale: "es" }),
      }).catch(() => undefined);
    },
    [synced],
  );

  const review = useCallback(
    (fingerprint: string, state: ReviewState, extra?: Partial<StoredFlag>) => {
      persist({ ...flags, [fingerprint]: { state, ...extra } });
      writeThrough(fingerprint, state, extra?.reason, extra?.reasonCode, extra?.checkIds);
    },
    [flags, persist, writeThrough],
  );

  const clear = useCallback(
    (fingerprint: string) => {
      const next = { ...flags };
      delete next[fingerprint];
      persist(next);
      writeThrough(fingerprint, null);
    },
    [flags, persist, writeThrough],
  );

  const setRoundApproved = useCallback(
    (value: boolean) => {
      // Approving keeps a copy of the answers the letters were built from, so
      // an answer changed later does not rewrite what was already mailed.
      const snapshot = value ? flags : null;
      const at = value ? new Date().toISOString() : null;
      setRoundApprovedState(value);
      setMailedFlags(snapshot);
      setRoundMailedAt(at);
      try {
        window.localStorage.setItem(APPROVED_KEY, JSON.stringify(value));
        if (snapshot) window.localStorage.setItem(MAILED_KEY, JSON.stringify(snapshot));
        else window.localStorage.removeItem(MAILED_KEY);
        if (at) window.localStorage.setItem(MAILED_AT_KEY, JSON.stringify(at));
        else window.localStorage.removeItem(MAILED_AT_KEY);
      } catch {
        // ignore
      }
    },
    [flags],
  );

  /**
   * The answers this round's letters were built from: the copy taken at
   * approval, or the current answers when there is no copy (not approved yet,
   * or approved before copies were kept).
   */
  const roundFlags = roundApproved && mailedFlags ? mailedFlags : flags;

  return { flags, roundFlags, review, clear, roundApproved, roundMailedAt, setRoundApproved, hydrated, synced };
}

export function countByState(flags: FlagsMap) {
  const values = Object.values(flags);
  return {
    reviewed: values.length,
    correct: values.filter((f) => f.state === "correct").length,
    flagged: values.filter((f) => f.state === "flagged").length,
    attested: values.filter((f) => f.state === "attested").length,
  };
}
