"use client";

import { useEffect, useState } from "react";
import type { ClientLetterMail } from "../mail/clientView";

// The mail record of the client's letters, as the client app reads it.
//
// Signed in, this is the client's own letters (letters.mail_class,
// mail_status, mailed_at, delivered_at, returned_at, migration 0013) — not
// wired yet, like the rest of the client app's data. The demo reads what this
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
