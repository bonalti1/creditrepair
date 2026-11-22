import type { ShareHow, ShareLevel, SharingLevel } from "./sharing";

// What /equipo/socios shows about sharing: which clients share with which
// partner, at what level and since when, and who looked at a client's page.
// The current level is the newest consent record of each pair, the same rule
// as the database function (migration 0023).

export interface ConsentRecord {
  /** Order of the records; newest is the highest. */
  seq: number;
  clientId: string;
  partnerId: string;
  level: ShareLevel;
  how: ShareHow;
  at: string;
}

export interface StaffShareRow {
  partnerId: string;
  clientId: string;
  clientName: string;
  level: SharingLevel;
  how: ShareHow;
  /** When this stretch of sharing began. */
  since: string;
}

export interface StaffViewRow {
  partnerId: string;
  clientId: string;
  clientName: string;
  at: string;
}

/** The pairs whose newest record is not "none". */
export function currentShares(records: ConsentRecord[], nameOf: (clientId: string) => string): StaffShareRow[] {
  const byPair = new Map<string, ConsentRecord[]>();
  for (const r of [...records].sort((a, b) => a.seq - b.seq)) {
    const key = `${r.partnerId}:${r.clientId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r]);
  }
  const out: StaffShareRow[] = [];
  for (const list of byPair.values()) {
    const last = list.at(-1)!;
    if (last.level === "none") continue;
    const lastNone = list.map((r) => r.level).lastIndexOf("none");
    out.push({ partnerId: last.partnerId, clientId: last.clientId, clientName: nameOf(last.clientId), level: last.level, how: last.how, since: list[lastNone + 1]!.at });
  }
  return out.sort((a, b) => b.since.localeCompare(a.since));
}
