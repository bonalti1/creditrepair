"use client";

import { useCallback, useEffect, useState } from "react";

// Shared review state, persisted in localStorage so the user's decisions follow
// them across pages (dashboard, item wizard, attack builder). One of the core
// "10x" bets: the app always knows where you left off — you never re-review.
// TODO(Phase 2): swap the localStorage backend for the item_flags table once
// Supabase Auth is wired; the hook API stays the same.

export type ReviewState = "correct" | "flagged" | "attested";

export interface StoredFlag {
  state: ReviewState;
  reason?: string;
  attestedAt?: string;
}

export type FlagsMap = Record<string, StoredFlag>;

const STORAGE_KEY = "bonalti.review.v1";
const APPROVED_KEY = "bonalti.roundApproved.v1";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useFlags() {
  const [flags, setFlags] = useState<FlagsMap>({});
  const [roundApproved, setRoundApprovedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFlags(load<FlagsMap>(STORAGE_KEY, {}));
    setRoundApprovedState(load<boolean>(APPROVED_KEY, false));
    setHydrated(true);
  }, []);

  const persist = useCallback((next: FlagsMap) => {
    setFlags(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode) — state stays in memory.
    }
  }, []);

  const review = useCallback(
    (fingerprint: string, state: ReviewState, extra?: Partial<StoredFlag>) => {
      persist({ ...flags, [fingerprint]: { state, ...extra } });
    },
    [flags, persist],
  );

  const clear = useCallback(
    (fingerprint: string) => {
      const next = { ...flags };
      delete next[fingerprint];
      persist(next);
    },
    [flags, persist],
  );

  const setRoundApproved = useCallback((value: boolean) => {
    setRoundApprovedState(value);
    try {
      window.localStorage.setItem(APPROVED_KEY, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, []);

  return { flags, review, clear, roundApproved, setRoundApproved, hydrated };
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
