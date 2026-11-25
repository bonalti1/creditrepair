import { demoAdsSummary } from "../ads/data";
import { readDemoContentBoard } from "../content/store";
import { readDemoThreads } from "../partners/portalDemo";
import { isDemoMode } from "../supabase/config";
import { can, type Viewer } from "../staff/permissions";
import type { StaffLocale } from "../staff/i18n/locale";
import type { StaffClient } from "../staff/types";
import type { Lead } from "../leads/types";
import { contentSummary } from "./content";
import type { ControlExtras } from "./overview";
import type { PartnerNoteWaiting } from "./server";

// Where the Overview and the Today list get what the clients list does not
// carry, and where "Escalate to the owner" goes. The database one asks
// /api/staff/control; the demo computes what it can from the invented
// records (partner notes, the leads' hand-offs) and says plainly what it
// cannot (no database: no tech health, no review requests). The content
// board is the one the demo's Content tab keeps in this browser.

export type Extras = ControlExtras & { partnerNotes: PartnerNoteWaiting[] };

export interface ControlData {
  readonly demo: boolean;
  extras(input: { clients: readonly StaffClient[]; leads: readonly Lead[] | null }): Promise<Extras>;
  escalate(input: { key: string; title: string; note: string }): Promise<{ ok: boolean; message?: string }>;
  resolve(id: string): Promise<{ ok: boolean }>;
}

const DEMO_KEY = "credalti.demo.control.v1";
type DemoEscalation = { id: string; key: string; title: string; note: string | null; by: string; at: string; resolvedAt?: string | null };

function readEscalations(): DemoEscalation[] {
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "[]") as DemoEscalation[];
  } catch {
    return [];
  }
}

function writeEscalations(list: DemoEscalation[]): void {
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(list));
  } catch {
    // This visit only.
  }
}

export function resetDemoControl(): void {
  try {
    window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing kept.
  }
}

const DEMO_REASON: Record<StaffLocale, string> = {
  en: "The demo has no database, so there is nothing to read.",
  es: "La demo no tiene base de datos, así que no hay nada que leer.",
};

export function getControlData(viewer: Viewer | null, locale: StaffLocale): ControlData {
  if (isDemoMode()) {
    return {
      demo: true,
      async extras({ clients, leads }) {
        const visible = new Map(clients.map((c) => [c.id, c]));
        const partnerNotes: PartnerNoteWaiting[] = Object.entries(readDemoThreads(new Date())).flatMap(([clientId, notes]) => {
          const last = [...notes].sort((a, b) => a.at.localeCompare(b.at)).pop();
          const client = visible.get(clientId);
          return last && client && last.authorKind === "partner"
            ? [{ id: last.id, clientId, clientName: `${client.firstName} ${client.lastName}`, partnerFirstName: last.authorFirstName, at: last.at }]
            : [];
        });
        const escalations = viewer?.role === "admin" ? readEscalations().filter((e) => !e.resolvedAt) : null;
        let content = null;
        if (can(viewer?.role, "content.view")) {
          const board = readDemoContentBoard();
          content = contentSummary(board.pieces, board.schedules, board.settings, new Date());
        }
        return {
          content,
          // The Ads Manager's sample account (src/lib/ads/demo.ts), labelled as sample on the card.
          ads: can(viewer?.role, "ads.view") ? demoAdsSummary() : null,
          partnerNotesWaiting: partnerNotes.length,
          partnerNotes,
          reviewRequests30d: null,
          complaints7d: leads ? leads.filter((l) => l.handoff?.reason === "complaint").length : null,
          escalations,
          health: null,
          unavailable: DEMO_REASON[locale],
        };
      },
      async escalate({ key, title, note }) {
        writeEscalations([...readEscalations(), { id: `e-${Date.now()}`, key, title, note: note || null, by: viewer?.name.split(" ")[0] ?? "", at: new Date().toISOString() }]);
        return { ok: true };
      },
      async resolve(id) {
        writeEscalations(readEscalations().map((e) => (e.id === id ? { ...e, resolvedAt: new Date().toISOString() } : e)));
        return { ok: true };
      },
    };
  }
  return {
    demo: false,
    async extras() {
      const res = await fetch("/api/staff/control", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()) as { extras: Extras }).extras;
    },
    async escalate(input) {
      try {
        const res = await fetch("/api/staff/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "escalate", ...input, note: input.note || undefined }) });
        return { ok: res.ok };
      } catch {
        return { ok: false };
      }
    },
    async resolve(id) {
      const res = await fetch("/api/staff/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve", id }) }).catch(() => null);
      return { ok: Boolean(res?.ok) };
    },
  };
}
