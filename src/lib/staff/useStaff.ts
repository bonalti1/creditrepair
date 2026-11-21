"use client";

import { useCallback, useEffect, useState } from "react";
import { getStaffData } from "./data";
import type { StaffClient } from "./types";

// The console's clients for a page, loaded in the browser. `now` is taken
// when the data is read, so stages, exceptions and dates on one screen all
// agree. Call `reload` after any action.

const SALES_NAME_KEY = "bonalti.salesName"; // set on the invite page

/** The name staff notes are signed with: what they typed on the invite page, or "equipo". */
export function staffAuthor(): string {
  try {
    const name = window.localStorage.getItem(SALES_NAME_KEY)?.trim();
    return name ? name.toLowerCase() : "equipo";
  } catch {
    return "equipo";
  }
}

/** The teammate's name as they typed it, or "" when they have not given one. Signs replies to clients. */
export function staffName(): string {
  try {
    return window.localStorage.getItem(SALES_NAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Remember the teammate's name in this browser (the same name the invite page uses). */
export function rememberStaffName(name: string): void {
  try {
    window.localStorage.setItem(SALES_NAME_KEY, name.trim());
  } catch {
    // Storage unavailable: the name lasts for this visit only.
  }
}

export function useStaff() {
  const data = getStaffData();
  const [state, setState] = useState<{ clients: StaffClient[]; now: Date } | null>(null);

  const reload = useCallback(async () => {
    const clients = await data.listClients();
    setState({ clients, now: new Date() });
  }, [data]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, ready: state !== null, clients: state?.clients ?? [], now: state?.now ?? new Date(0), reload };
}
