"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStaffData } from "./data";
import { guardStaffData } from "./guard";
import { can, visibleClients, type Capability, type Viewer } from "./permissions";
import type { TeamState } from "./team";
import { demoViewer, getTeamData } from "./teamData";
import { loadTeamActions, saveTeamActions } from "./teamStore";
import { useStaffLocale } from "./i18n/StaffLocale";
import type { StaffClient } from "./types";

// The console's clients for a page, loaded in the browser. `now` is taken
// when the data is read, so stages, exceptions and dates on one screen all
// agree. Call `reload` after any action.

const SALES_NAME_KEY = "bonalti.salesName"; // set on the invite page

// ── Who is using the console ────────────────────────────────────────────
//
// With a database, the server knows who is signed in: the layout reads the
// member's row (access.ts getStaffMember) and the shell provides it here. In
// the demo there is nobody signed in, so the demo team stands in and the
// header's "Ver como" picks whose view to show.

/** The signed-in member, provided by the console's shell. Null in the demo. */
export const StaffViewerContext = createContext<Viewer | null>(null);

/** Fired when the demo switches whose view it shows. */
export const VIEWER_CHANGED = "credalti:staff-viewer";

let currentViewer: Viewer | null = null;

/** The name staff notes are signed with: the member using the console, else what they typed on the invite page, or "equipo". */
export function staffAuthor(): string {
  if (currentViewer) return currentViewer.handle;
  try {
    const name = window.localStorage.getItem(SALES_NAME_KEY)?.trim();
    return name ? name.toLowerCase() : "equipo";
  } catch {
    return "equipo";
  }
}

/** The teammate's first name (the member using the console), else as they typed it, or "". Signs replies to clients. */
export function staffName(): string {
  if (currentViewer) return currentViewer.name.split(" ")[0] ?? "";
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
  const raw = getStaffData();
  const teamData = getTeamData();
  const signedIn = useContext(StaffViewerContext);
  const { locale } = useStaffLocale();
  const [state, setState] = useState<{ all: StaffClient[]; team: TeamState; viewer: Viewer | null; now: Date } | null>(null);

  const reload = useCallback(async () => {
    const [all, team] = await Promise.all([raw.listClients(), teamData.load()]);
    const viewer = signedIn ?? (raw.demo ? demoViewer(team, loadTeamActions().viewAs) : null);
    currentViewer = viewer;
    setState({ all, team, viewer, now: new Date() });
  }, [raw, teamData, signedIn]);

  useEffect(() => {
    void reload();
    const again = () => void reload();
    window.addEventListener(VIEWER_CHANGED, again);
    return () => window.removeEventListener(VIEWER_CHANGED, again);
  }, [reload]);

  const viewer = state?.viewer ?? null;
  // Every read and every action goes through the viewer's permissions.
  const data = useMemo(
    () =>
      guardStaffData(raw, viewer, {
        locale,
        // The demo records who sent each round; the database route records it on the server.
        onRoundsSent: (rounds, by) => {
          if (!raw.demo) return;
          const actions = loadTeamActions();
          const sentBy = { ...actions.sentBy };
          for (const { clientId, roundNumber } of rounds) sentBy[clientId] = { ...sentBy[clientId], [String(roundNumber)]: by };
          saveTeamActions({ ...actions, sentBy });
        },
      }),
    [raw, viewer, locale],
  );
  const clients = useMemo(() => visibleClients(viewer, state?.all ?? []), [viewer, state]);

  return {
    data,
    team: teamData,
    ready: state !== null,
    /** The clients this member may see. */
    clients,
    now: state?.now ?? new Date(0),
    reload,
    viewer,
    members: state?.team.members ?? [],
    settings: state?.team.settings ?? { autoAssign: false, lastAutoAssigned: null },
    teamEvents: state?.team.events ?? [],
    can: (capability: Capability) => can(viewer?.role, capability),
    /** The console's language (i18n/StaffLocale.tsx). */
    locale,
  };
}

/**
 * Only who is looking, without loading the clients: for the console's frame.
 * In the demo it follows "Ver como".
 */
export function useViewer(): { viewer: Viewer | null; ready: boolean } {
  const signedIn = useContext(StaffViewerContext);
  const [state, setState] = useState<{ viewer: Viewer | null } | null>(null);
  useEffect(() => {
    if (signedIn) {
      setState({ viewer: signedIn });
      return;
    }
    const read = async () => {
      const raw = getStaffData();
      const team = await getTeamData().load();
      setState({ viewer: raw.demo ? demoViewer(team, loadTeamActions().viewAs) : null });
    };
    void read();
    const again = () => void read();
    window.addEventListener(VIEWER_CHANGED, again);
    return () => window.removeEventListener(VIEWER_CHANGED, again);
  }, [signedIn]);
  return { viewer: state?.viewer ?? null, ready: state !== null };
}
