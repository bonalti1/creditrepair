"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { PULSE_MOMENTS, type PulseMoment, type PulseRating } from "./pulse";

// Which pulse questions this client has already answered or skipped, and how
// an answer is sent. With a database: answers go to POST /api/pulse and the
// answered moments come back from GET /api/pulse, so the question is not asked
// again on another device. Skipping is remembered on this device. Demo: all of
// it stays on this device.

export const PULSE_KEY = "bonalti.pulse.v1";

interface LocalPulse {
  done: Partial<Record<PulseMoment, "answered" | "skipped">>;
  /** Demo only: the answers themselves. */
  answers: Array<{ moment: PulseMoment; rating: PulseRating; comment: string | null; at: string }>;
}

function readLocal(): LocalPulse {
  try {
    const raw = window.localStorage.getItem(PULSE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LocalPulse>) : null;
    return { done: parsed?.done ?? {}, answers: Array.isArray(parsed?.answers) ? parsed.answers : [] };
  } catch {
    return { done: {}, answers: [] };
  }
}

function writeLocal(next: LocalPulse): void {
  try {
    window.localStorage.setItem(PULSE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: asked again next visit, which is harmless.
  }
}

async function post(body: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/pulse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}

export function usePulseStore() {
  const live = isSupabaseConfigured();
  const [done, setDone] = useState<Set<PulseMoment>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const local = readLocal();
    const mine = new Set(Object.keys(local.done) as PulseMoment[]);
    if (!live) {
      setDone(mine);
      setReady(true);
      return;
    }
    let cancelled = false;
    fetch("/api/pulse", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ answered?: string[] }>) : null))
      .then((body) => {
        if (cancelled) return;
        for (const m of body?.answered ?? []) if ((PULSE_MOMENTS as readonly string[]).includes(m)) mine.add(m as PulseMoment);
        setDone(new Set(mine));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  const mark = useCallback((moment: PulseMoment, how: "answered" | "skipped", answer?: LocalPulse["answers"][number]) => {
    const local = readLocal();
    writeLocal({ done: { ...local.done, [moment]: how }, answers: answer && !live ? [...local.answers, answer] : local.answers });
    setDone((current) => new Set([...current, moment]));
  }, [live]);

  /** One tap on a face: the answer is saved at once. */
  const answer = useCallback(
    async (moment: PulseMoment, rating: PulseRating, locale: "es" | "en"): Promise<boolean> => {
      const ok = live ? await post({ moment, rating, locale }) : true;
      if (ok) mark(moment, "answered", { moment, rating, comment: null, at: new Date().toISOString() });
      return ok;
    },
    [live, mark],
  );

  /** The optional comment, added once to the answer just given. */
  const comment = useCallback(
    async (moment: PulseMoment, text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return true;
      if (live) return post({ moment, comment: trimmed });
      const local = readLocal();
      writeLocal({ ...local, answers: local.answers.map((a) => (a.moment === moment && a.comment === null ? { ...a, comment: trimmed } : a)) });
      return true;
    },
    [live],
  );

  const skip = useCallback((moment: PulseMoment) => mark(moment, "skipped"), [mark]);

  return { ready, done, answer, comment, skip };
}
