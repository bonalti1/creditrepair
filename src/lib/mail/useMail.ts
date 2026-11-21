"use client";

import { useCallback, useEffect, useState } from "react";
import { getMailData } from "./data";
import type { FurnisherEntry } from "./furnishers";

// The furnisher address book for a page, loaded in the browser, and how the
// console mails (Lob or simulated). Pages that decide whether a round may go
// out wait for `ready`: before the book loads, nothing is shown as sendable.

export function useMail() {
  const mail = getMailData();
  const [book, setBook] = useState<FurnisherEntry[] | null>(null);

  const reload = useCallback(async () => {
    setBook(await mail.listFurnishers());
  }, [mail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { mail, mode: mail.mode, ready: book !== null, furnishers: book ?? [], reload };
}
