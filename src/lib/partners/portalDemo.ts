import { buildDemoTeam } from "../staff/team";
import type { StaffClient } from "../staff/types";
import { buildDemoPartners } from "./demo";
import { CARE_ROLE_LABEL, type ClientShareRequest, type TeamNote } from "./portal";
import { referralView, type CareTeamMember, type PartnerReferral } from "./rules";
import { partnerDisplay } from "./sharing";
import { demoPartnerClients, readDemoClientSharing } from "./sharingDemo";

// ─────────────────────────────────────────────────────────────────────────
// DEMO ONLY. Nobody here exists. The partner portal's dashboard without a
// database: the demo partner's referrals with who looks after them and when
// sales reached out, the "ask to follow progress" requests and the notes
// between the partner and the team. Kept in this browser, so the portal, the
// client app (this device's own demo case, referred by the same partner) and
// the staff console show the same requests and notes.
// ─────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const REQUESTS_KEY = "credalti.demoShareRequests.v1";
const THREAD_KEY = "credalti.demoPartnerThread.v1";

/** The referral id of this device's own demo case in the demo portal. */
export const DEMO_ME = "demo-me";

function careOf(handle: string | null | undefined, now: Date): CareTeamMember | null {
  const member = buildDemoTeam(now).members.find((m) => m.handle === handle && m.active);
  return member ? { firstName: member.name.split(" ")[0] ?? member.name, role: member.role } : null;
}

/** Minutes after a referral that the demo's salesperson first wrote (invented, steady per client): the demo's example of the speed. */
const contactMinutes = (id: string) => 14 + ([...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 70);

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Storage unavailable.
  }
  return fallback;
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this visit only.
  }
}

// ── Requests ────────────────────────────────────────────────────────────

type DemoRequests = Record<string, { at: string; dismissedAt?: string | null }>;

export function readDemoShareRequests(): DemoRequests {
  return readJson<DemoRequests>(REQUESTS_KEY, {});
}

export function writeDemoShareRequest(referralId: string, at: string): void {
  writeJson(REQUESTS_KEY, { ...readDemoShareRequests(), [referralId]: { at, dismissedAt: null } });
}

export function dismissDemoShareRequest(referralId: string, at: string): void {
  const all = readDemoShareRequests();
  if (all[referralId]) writeJson(REQUESTS_KEY, { ...all, [referralId]: { ...all[referralId]!, dismissedAt: at } });
}

/** This device's own requests, as the client app reads them. */
export function demoClientShareRequests(now: Date): ClientShareRequest[] {
  const mine = readDemoShareRequests()[DEMO_ME];
  if (!mine) return [];
  const laura = buildDemoPartners(now).find((p) => p.id === "p-laura")!;
  return [{ id: "demo-request", partnerId: laura.id, partnerName: partnerDisplay(laura), at: mine.at, dismissedAt: mine.dismissedAt ?? null }];
}

// ── The demo partner's referrals ────────────────────────────────────────

/** The demo client's own name on this device (the invitation's), for the partner's list. */
function deviceName(): string {
  try {
    return window.localStorage.getItem("bonalti.inviteName") || "Rosa Martínez";
  } catch {
    return "Rosa Martínez";
  }
}

export function demoReferrals(partnerId: string, clients: StaffClient[], sent: PartnerReferral[], now: Date): PartnerReferral[] {
  const shared = new Set(demoPartnerClients(partnerId, clients, now).map((c) => c.clientId));
  const requests = readDemoShareRequests();
  const fromClients = clients
    .filter((c) => c.leadSource?.partnerId === partnerId)
    .map((c) => {
      const invitedAt = c.leadSource?.invitedAt ?? new Date(new Date(c.createdAt).getTime() + contactMinutes(c.id) * 60_000).toISOString();
      const base = referralView({ ...c, leadSource: c.leadSource ? { ...c.leadSource, invitedAt } : c.leadSource });
      const hasAccount = c.signedUpAt !== null;
      return {
        ...base,
        contactedAt: invitedAt,
        care: careOf(c.assignedTo ?? c.salesperson, now),
        hasAccount,
        sharedClientId: shared.has(c.id) ? c.id : null,
        shareRequestedAt: requests[c.id]?.at ?? null,
      } satisfies PartnerReferral;
    });
  const out = [...sent.map((r) => ({ ...r, care: r.care ?? careOf("ana", now) })), ...fromClients];
  if (partnerId === "p-laura") {
    // A referral sent this morning that the team has not reached yet.
    out.push({ id: "demo-referred", firstName: "Mónica", lastInitial: "R", referredAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), status: "referred", contactedAt: null, care: careOf("ana", now), hasAccount: false, sharedClientId: null, shareRequestedAt: null });
    const name = deviceName().split(/\s+/);
    const sharing = (readDemoClientSharing().levels["p-laura"] ?? "none") !== "none";
    out.push({
      id: DEMO_ME,
      firstName: name[0] ?? "Rosa",
      lastInitial: (name[1] ?? "M").slice(0, 1),
      referredAt: new Date(now.getTime() - 6 * DAY).toISOString(),
      status: "contacted",
      contactedAt: new Date(now.getTime() - 6 * DAY + 38 * 60_000).toISOString(),
      care: careOf("ana", now),
      hasAccount: true,
      sharedClientId: sharing ? DEMO_ME : null,
      shareRequestedAt: requests[DEMO_ME]?.at ?? null,
    });
  }
  return out.sort((a, b) => b.referredAt.localeCompare(a.referredAt));
}

/** Who looks after a demo client who shares (their assigned teammate). */
export function demoClientCare(client: StaffClient | null, now: Date): CareTeamMember | null {
  if (!client) return careOf("ana", now);
  return careOf(client.assignedTo ?? null, now);
}

// ── Notes between the partner and the team ──────────────────────────────

type DemoThreads = Record<string, Array<TeamNote & { partnerId: string }>>;

function seedThreads(now: Date): DemoThreads {
  const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return {
    c12: [
      { id: "dn-1", partnerId: "p-laura", authorKind: "partner", authorFirstName: "Laura", authorRole: null, body: "Heriberto asked me whether he needs to send anything else before his next round. Could someone check in with him?", at: at(3) },
      { id: "dn-2", partnerId: "p-laura", authorKind: "staff", authorFirstName: "Marta", authorRole: "specialist", body: "Thanks, Laura. I wrote to him in his app today: he has what he needs for now. The date of his next round is in his timeline.", at: new Date(new Date(at(3)).getTime() + 72 * 60_000).toISOString() },
    ],
  };
}

export function readDemoThreads(now: Date = new Date()): DemoThreads {
  return { ...seedThreads(now), ...readJson<DemoThreads>(THREAD_KEY, {}) };
}

export function demoThread(clientId: string, partnerId: string, now: Date = new Date()): TeamNote[] {
  return (readDemoThreads(now)[clientId] ?? []).filter((n) => n.partnerId === partnerId).sort((a, b) => a.at.localeCompare(b.at));
}

export function addDemoNote(clientId: string, partnerId: string, note: Omit<TeamNote, "id" | "at">, now: Date = new Date()): TeamNote {
  const all = readDemoThreads(now);
  const added: TeamNote & { partnerId: string } = { ...note, id: `dn-${now.getTime()}`, at: now.toISOString(), partnerId };
  writeJson(THREAD_KEY, { ...all, [clientId]: [...(all[clientId] ?? []), added] });
  return added;
}

/** "Marta · Credit specialist" for the staff console's thread. */
export function staffAuthorLine(note: TeamNote, locale: "es" | "en"): string {
  return note.authorRole ? `${note.authorFirstName} · ${CARE_ROLE_LABEL[locale][note.authorRole]}` : note.authorFirstName;
}
