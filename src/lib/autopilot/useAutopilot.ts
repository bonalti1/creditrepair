"use client";

import { useCallback, useEffect, useState } from "react";
import { getAutopilotData, type AutopilotView } from "./data";
import { DEFAULT_AUTOPILOT, NO_CHANNELS } from "./types";

// The autopilot's switches and channels for a page. Until they load, the
// rules run with everything new off (the database's defaults), so nothing is
// shown as going by itself before it is known.

export function useAutopilot() {
  const data = getAutopilotData();
  const [view, setView] = useState<AutopilotView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setView(await data.load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setView({ settings: DEFAULT_AUTOPILOT, channels: NO_CHANNELS, gaps: { whatsapp: [], email: [] } });
    }
  }, [data]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    autopilot: data,
    ready: view !== null,
    settings: view?.settings ?? DEFAULT_AUTOPILOT,
    channels: view?.channels ?? NO_CHANNELS,
    gaps: view?.gaps ?? { whatsapp: [], email: [] },
    env: { settings: view?.settings ?? DEFAULT_AUTOPILOT, channels: view?.channels ?? NO_CHANNELS },
    error,
    reload,
  };
}
