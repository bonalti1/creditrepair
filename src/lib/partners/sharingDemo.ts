import type { StaffClient } from "../staff/types";
import { buildDemoPartners, DEMO_PORTAL_PARTNER } from "./demo";
import { progressFromStaffClient, type PartnerProgress, type ShareHow, type ShareLevel, type SharingLevel } from "./sharing";
import type { StaffShareRow, StaffViewRow } from "./sharingStaff";

// ─────────────────────────────────────────────────────────────────────────
// DEMO ONLY. Nobody here exists. Which invented clients chose to share their
// progress with which invented partner, and the views of their pages, so the
// partner portal ("Mis clientes"), the staff screen and the client's "Quién
// puede ver tu progreso" show something without a database. The demo client
// (this device's own case) shares with Laura only if the person at the
// keyboard chooses to; that choice is kept in this browser.
// ─────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

interface DemoShare {
  partnerId: string;
  clientId: string;
  level: SharingLevel;
  how: ShareHow;
  sharedDaysAgo: number;
}

const DEMO_SHARES: DemoShare[] = [
  { partnerId: "p-laura", clientId: "c12", level: "summary", how: "referred", sharedDaysAgo: 40 },
  { partnerId: "p-laura", clientId: "c09", level: "progress", how: "referred", sharedDaysAgo: 46 },
  { partnerId: "p-laura", clientId: "c06", level: "progress", how: "referred", sharedDaysAgo: 9 },
  { partnerId: "p-laura", clientId: "c13", level: "summary", how: "added_by_code", sharedDaysAgo: 30 },
  { partnerId: "p-jorge", clientId: "c14", level: "summary", how: "referred", sharedDaysAgo: 50 },
  { partnerId: "p-jorge", clientId: "c11", level: "progress", how: "referred", sharedDaysAgo: 15 },
];

/** Demo views of client pages: [partner, client, days ago]. */
const DEMO_VIEWS: Array<[string, string, number]> = [
  ["p-laura", "c12", 0.2],
  ["p-laura", "c13", 1],
  ["p-laura", "c12", 3],
  ["p-jorge", "c14", 2],
  ["p-laura", "c09", 4],
  ["p-jorge", "c11", 6],
];

export function demoPartnerClients(partnerId: string, clients: StaffClient[], now: Date): PartnerProgress[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  return DEMO_SHARES.filter((s) => s.partnerId === partnerId && byId.has(s.clientId))
    .map((s) => progressFromStaffClient(byId.get(s.clientId)!, { level: s.level, how: s.how, sharedAt: new Date(now.getTime() - s.sharedDaysAgo * DAY).toISOString() }))
    .sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}

export function demoShares(clients: StaffClient[], now: Date): StaffShareRow[] {
  const name = new Map(clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  return DEMO_SHARES.filter((s) => name.has(s.clientId)).map((s) => ({
    partnerId: s.partnerId,
    clientId: s.clientId,
    clientName: name.get(s.clientId)!,
    level: s.level,
    how: s.how,
    since: new Date(now.getTime() - s.sharedDaysAgo * DAY).toISOString(),
  }));
}

export function demoViews(clients: StaffClient[], now: Date): StaffViewRow[] {
  const name = new Map(clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  return DEMO_VIEWS.filter(([, c]) => name.has(c)).map(([partnerId, clientId, days]) => ({ partnerId, clientId, clientName: name.get(clientId)!, at: new Date(now.getTime() - days * DAY).toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
}

// ── The demo client's own choice (this device) ──────────────────────────

const KEY = "credalti.demoSharing.v1";

export interface DemoClientSharing {
  /** By partner id. */
  levels: Record<string, ShareLevel>;
  /** Partners added by code, by id. */
  added: string[];
  history: Array<{ partnerId: string; level: ShareLevel; previousLevel: ShareLevel; at: string }>;
}

export function readDemoClientSharing(): DemoClientSharing {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { levels: {}, added: [], history: [], ...(JSON.parse(raw) as Partial<DemoClientSharing>) };
  } catch {
    // Storage unavailable: nothing shared.
  }
  return { levels: {}, added: [], history: [] };
}

export function writeDemoClientSharing(partnerId: string, level: ShareLevel, added = false): DemoClientSharing {
  const current = readDemoClientSharing();
  const previousLevel = current.levels[partnerId] ?? "none";
  const next: DemoClientSharing = {
    levels: { ...current.levels, [partnerId]: level },
    added: added && !current.added.includes(partnerId) ? [...current.added, partnerId] : current.added,
    history: previousLevel === level ? current.history : [{ partnerId, level, previousLevel, at: new Date().toISOString() }, ...current.history],
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  return next;
}

/** The partner who referred the demo client: Laura, like the demo portal. */
export function demoReferringPartner(now: Date) {
  return buildDemoPartners(now).find((p) => p.id === DEMO_PORTAL_PARTNER)!;
}

/** Invented views of the demo client's own progress, only while they share. */
export function demoClientViews(sharing: DemoClientSharing, now: Date): Array<{ partnerId: string; at: string }> {
  const out: Array<{ partnerId: string; at: string }> = [];
  for (const [partnerId, level] of Object.entries(sharing.levels)) {
    if (level === "none") continue;
    const since = sharing.history.find((h) => h.partnerId === partnerId && h.previousLevel === "none")?.at;
    // Before the choice nobody looked; the demo shows the views a partner would make afterwards.
    const base = since ? Math.max(new Date(since).getTime(), now.getTime() - 9 * DAY) : now.getTime() - 9 * DAY;
    for (const daysAfter of [0.1, 2.5, 6]) {
      const at = base + daysAfter * DAY;
      if (at <= now.getTime()) out.push({ partnerId, at: new Date(at).toISOString() });
    }
    if (out.length === 0) out.push({ partnerId, at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString() });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** A demo partner by referral code (the welcome, the "Cómo funciona" page, adding by code). Approved partners only. */
export function demoPartnerByCode(code: string, now: Date = new Date()) {
  return buildDemoPartners(now).find((p) => p.referralCode === code && p.status === "approved") ?? null;
}
