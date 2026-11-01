"use client";

import { useCallback, useEffect, useState } from "react";

// Shared review state so the user's decisions follow them across pages
// (dashboard, item wizard, attack builder). One of the core "10x" bets: the
// app always knows where you left off — you never re-review.
// Signed in: server-backed (item_flags via /api/flags, RLS-scoped) with
// write-through. Signed out / demo: localStorage only.

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
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    setFlags(load<FlagsMap>(STORAGE_KEY, {}));
    setRoundApprovedState(load<boolean>(APPROVED_KEY, false));
    setHydrated(true);

    // When signed in, the server copy (item_flags, RLS-scoped) is the source
    // of truth; localStorage remains the demo/offline cache.
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { authenticated: boolean; flags: FlagsMap } | null) => {
        if (data?.authenticated) {
          setFlags(data.flags);
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
    (fingerprint: string, state: ReviewState | null, reason?: string) => {
      if (!synced) return;
      fetch("/api/flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, state, reason, locale: "es" }),
      }).catch(() => undefined);
    },
    [synced],
  );

  const review = useCallback(
    (fingerprint: string, state: ReviewState, extra?: Partial<StoredFlag>) => {
      persist({ ...flags, [fingerprint]: { state, ...extra } });
      writeThrough(fingerprint, state, extra?.reason);
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

  const setRoundApproved = useCallback((value: boolean) => {
    setRoundApprovedState(value);
    try {
      window.localStorage.setItem(APPROVED_KEY, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, []);

  return { flags, review, clear, roundApproved, setRoundApproved, hydrated, synced };
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
