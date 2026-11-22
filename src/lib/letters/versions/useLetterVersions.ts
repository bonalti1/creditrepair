"use client";

import { useCallback, useEffect, useState } from "react";
import { getLetterVersionsData } from "./data";
import type { LetterVersion } from "./versions";

// The letter versions for a page, loaded in the browser.
//
//   useLetterVersions()                     every version: the editor (administrators).
//   useLetterVersions({ approvedOnly: true }) the approved ones: the console's
//       previews and printed letters, so they show the text that is mailed.
//
// A page that prints letters waits for `ready`. If the read fails (for
// example a role that may not read them), `versions` is empty and letters
// show version 1, which is also what the server would refuse to mail.

export function useLetterVersions(options: { approvedOnly?: boolean } = {}) {
  const data = getLetterVersionsData();
  const approvedOnly = Boolean(options.approvedOnly);
  const [state, setState] = useState<{ versions: LetterVersion[]; allowUnapproved: boolean; error: string | null } | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await data.list({ approvedOnly });
      setState({ ...result, error: null });
    } catch (error) {
      setState({ versions: [], allowUnapproved: false, error: error instanceof Error ? error.message : "No pudimos leer las cartas." });
    }
  }, [data, approvedOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    demo: data.demo,
    ready: state !== null,
    versions: state?.versions ?? [],
    allowUnapproved: state?.allowUnapproved ?? false,
    error: state?.error ?? null,
    reload,
  };
}
