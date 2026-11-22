"use client";

import { useCallback, useEffect, useState } from "react";
import { getMailData } from "./data";
import type { FurnisherEntry, FurnisherGapRecord } from "./furnishers";

// The furnisher address book for a page, loaded in the browser, and how the
// console mails (Lob or simulated). Pages that decide whether a round may go
// out wait for `ready`: before the book loads, nothing is shown as sendable.
// `gaps`: the companies whose address is missing, as first seen for every
// client (migration 0022), for the queue's one-item-per-company clock.

export function useMail() {
  const mail = getMailData();
  const [book, setBook] = useState<FurnisherEntry[] | null>(null);
  const [gaps, setGaps] = useState<FurnisherGapRecord[]>([]);

  const reload = useCallback(async () => {
    setBook(await mail.listFurnishers());
    setGaps((await mail.listGaps?.()) ?? []);
  }, [mail]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { mail, mode: mail.mode, ready: book !== null, furnishers: book ?? [], gaps, reload };
}
