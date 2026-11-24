"use client";

import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured } from "../supabase/config";
import { callsEnabled } from "./config";
import { demoWindows } from "./demo";
import type { CallBooking, CallStatus } from "./queue";
import { windowFromRequest, type CallWindow, type WindowProblem, type WindowRequest } from "./slots";

// The team's calls screen and the home queue's calls card. With a database:
// /api/staff/calls ("calls.manage"). In the demo: the example schedule, the
// hours added on this browser, and one example booking. Calls off: nothing.

const KEY = "bonalti.calls.demo.v1";

interface DemoState {
  added: CallWindow[];
  removed: string[];
  closed: Record<string, CallStatus>;
}

function readDemo(): DemoState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as DemoState | null;
    if (parsed && Array.isArray(parsed.added)) return { added: parsed.added, removed: parsed.removed ?? [], closed: parsed.closed ?? {} };
  } catch {
    // fall through
  }
  return { added: [], removed: [], closed: {} };
}

function writeDemo(state: DemoState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The demo forgets.
  }
}

/** The demo's one example booking, tomorrow's first slot. */
function demoBooking(windows: CallWindow[], closed: Record<string, CallStatus>): CallBooking[] {
  const w = windows[0];
  if (!w) return [];
  const start = new Date(new Date(w.startsAt).getTime() + w.slotMinutes * 60_000).toISOString();
  return [
    {
      id: "demo-booking-1",
      windowId: w.id,
      slotStart: start,
      slotEnd: new Date(new Date(start).getTime() + w.slotMinutes * 60_000).toISOString(),
      caseRef: "CR-7KQ4M",
      userId: null,
      firstName: "Rosa",
      phone: "+17135550142",
      email: null,
      confirmChannel: "whatsapp",
      locale: "es",
      timeZone: "America/Chicago",
      state: "TX",
      question: "¿Cuánto tarda cada ronda de cartas?",
      status: closed["demo-booking-1"] ?? "booked",
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      closedAt: null,
      closedByName: null,
      staffNote: null,
      messages: [{ kind: "confirmation", channel: "whatsapp", status: "sent", sentAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }],
    },
  ];
}

export function useCalls() {
  const enabled = callsEnabled();
  const live = isSupabaseConfigured();
  const [windows, setWindows] = useState<CallWindow[]>([]);
  const [bookings, setBookings] = useState<CallBooking[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return setReady(true);
    if (!live) {
      const demo = readDemo();
      const all = [...demoWindows(new Date()), ...demo.added].filter((w) => !demo.removed.includes(w.id)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      setWindows(all);
      setBookings(demoBooking(all, demo.closed));
      return setReady(true);
    }
    try {
      const res = await fetch("/api/staff/calls", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { windows: CallWindow[]; bookings: CallBooking[] }) : { windows: [], bookings: [] };
      setWindows(body.windows);
      setBookings(body.bookings);
    } catch {
      setWindows([]);
      setBookings([]);
    }
    setReady(true);
  }, [enabled, live]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; problems: string[] }> => {
      try {
        const res = await fetch("/api/staff/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = (await res.json().catch(() => ({}))) as { problems?: string[] };
        await reload();
        return res.ok ? { ok: true } : { ok: false, problems: data.problems ?? ["error"] };
      } catch {
        return { ok: false, problems: ["network"] };
      }
    },
    [reload],
  );

  const addWindow = useCallback(
    async (req: WindowRequest): Promise<{ ok: true } | { ok: false; problems: Array<WindowProblem | string> }> => {
      if (!live) {
        const parsed = windowFromRequest(req, new Date());
        if (!parsed.ok) return parsed;
        const demo = readDemo();
        demo.added.push({ id: `demo-added-${Date.now()}`, startsAt: parsed.startsAt, endsAt: parsed.endsAt, slotMinutes: req.slotMinutes, timeZone: req.timeZone, createdByName: "Demo", removedAt: null });
        writeDemo(demo);
        await reload();
        return { ok: true };
      }
      return post({ action: "add_window", ...req });
    },
    [live, post, reload],
  );

  const removeWindow = useCallback(
    async (id: string) => {
      if (!live) {
        const demo = readDemo();
        demo.removed.push(id);
        writeDemo(demo);
        await reload();
        return { ok: true as const };
      }
      return post({ action: "remove_window", windowId: id });
    },
    [live, post, reload],
  );

  const closeBooking = useCallback(
    async (id: string, outcome: Exclude<CallStatus, "booked">, note: string | null) => {
      if (!live) {
        const demo = readDemo();
        demo.closed[id] = outcome;
        writeDemo(demo);
        await reload();
        return { ok: true as const };
      }
      return post({ action: "close_booking", bookingId: id, outcome, note });
    },
    [live, post, reload],
  );

  return { enabled, live, ready, windows, bookings, addWindow, removeWindow, closeBooking };
}
