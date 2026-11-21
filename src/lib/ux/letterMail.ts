"use client";

import { useEffect, useState } from "react";
import type { ClientLetterMail } from "../mail/clientView";
import { isSupabaseConfigured } from "../supabase/config";
import { fetchClientRound } from "./caseApi";

// The mail record of the client's letters, as the client app reads it.
//
// With a database, this is the client's own letters (letters.mail_class,
// mail_status, mailed_at, delivered_at, returned_at, migration 0013), through
// GET /api/rounds under their own row level security. The demo reads what this
// browser saved under LETTER_MAIL_KEY and nothing else: with nothing saved, a
// mailed letter reads "on its way" and no delivery date is ever invented.

export const LETTER_MAIL_KEY = "bonalti.letterMail.v1";

/** "equifax|dispute_611_accounts": one letter of the round, by recipient and template. */
export function letterMailKey(targetKey: string, templateKey: string): string {
  return `${targetKey}|${templateKey}`;
}

export function useLetterMail(): Record<string, Partial<ClientLetterMail>> {
  const [saved, setSaved] = useState<Record<string, Partial<ClientLetterMail>>>({});
  useEffect(() => {
    // With a database: the client's own letters of the newest mailed round (GET /api/rounds).
    if (isSupabaseConfigured()) {
      let cancelled = false;
      fetchClientRound()
        .then((answer) => {
          if (cancelled || !answer.authenticated || !answer.round) return;
          setSaved(Object.fromEntries(answer.round.letters.map((l) => [letterMailKey(l.targetKey, l.templateKey), l.mail])));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }
    try {
      const raw = window.localStorage.getItem(LETTER_MAIL_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) setSaved(parsed as Record<string, Partial<ClientLetterMail>>);
    } catch {
      // Nothing saved, or storage unavailable: the letters read from the round alone.
    }
  }, []);
  return saved;
}
