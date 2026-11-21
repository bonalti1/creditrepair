import { DEMO_RAW_REPORT } from "../../demo";
import type { RawReport } from "../../domain/parser";
import type { StaffMember } from "../../staff/access";
import type { StaffRole } from "../../staff/types";
import type { Harness } from "./pg";

// People and records for the database tests, written the way the app writes
// them: accounts as Supabase Auth would create them, profiles as the login
// page does, the agreement as /api/agreement/* records it (with the service
// role), staff as the owner's setup snippet adds them.

export const DAY = 24 * 60 * 60 * 1000;
export const ago = (days: number, from = Date.now()): string => new Date(from - days * DAY).toISOString();

let counter = 0;
/** A fresh, valid v4-looking uuid for each call. */
export function uid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

export async function addClient(
  h: Harness,
  options: { name?: string; phone?: string; referredBy?: string | null; address?: string[]; state?: string } = {},
): Promise<string> {
  const id = uid();
  const phone = options.phone ?? `+1713555${String(1000 + counter).slice(-4)}`;
  await h.createUser(id, { phone });
  const { error } = await h.service.from("profiles").insert({
    id,
    full_name: options.name ?? "Rosa Martínez",
    phone_e164: phone,
    state: options.state ?? "TX",
    referred_by: options.referredBy ?? null,
    address_lines: options.address ?? ["123 Main St", "Houston, TX 77002"],
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function addStaff(h: Harness, role: StaffRole, handle: string, name = handle): Promise<StaffMember> {
  const id = uid();
  await h.createUser(id, { email: `${handle}@credalti.test` });
  const { error } = await h.service.from("staff_members").insert({ user_id: id, role, handle, display_name: name, active: true });
  if (error) throw new Error(error.message);
  return { userId: id, handle, name, role };
}

export async function assign(h: Harness, clientId: string, staffUserId: string, by: string | null = null): Promise<void> {
  const { error } = await h.service.from("client_assignments").upsert({ user_id: clientId, staff_user_id: staffUserId, assigned_by: by, auto: false });
  if (error) throw new Error(error.message);
  await h.service.from("team_audit").insert({ actor: by, kind: "client_assigned", client_id: clientId, member: staffUserId });
}

/**
 * A signed agreement, as /api/agreement/acknowledge and /sign record it, with
 * the cancellation window already over (signed `signedDaysAgo` days ago,
 * deadline five days after). The fee is the one the charge trigger will compare.
 */
export async function signAgreement(h: Harness, clientId: string, options: { signedDaysAgo?: number; deadlineInDays?: number; fee?: string } = {}): Promise<void> {
  const signedDaysAgo = options.signedDaysAgo ?? 12;
  const signed = Date.now() - signedDaysAgo * DAY;
  const deadline = options.deadlineInDays !== undefined ? Date.now() + options.deadlineInDays * DAY : signed + 5 * DAY;
  const { error } = await h.service.from("service_agreements").insert({
    user_id: clientId,
    document_version: "2026-11-test",
    disclosure_acknowledged_at: new Date(signed - 10 * 60 * 1000).toISOString(),
    disclosure_locale: "es",
    disclosure_hash: "a".repeat(64),
    signer_name: "Rosa Martínez",
    signed_at: new Date(signed).toISOString(),
    locale: "es",
    document_hash: "b".repeat(64),
    terms: { monthlyFee: options.fee ?? "89.00", companyName: "Credalti" },
    cancellation_deadline: new Date(deadline).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function addDocuments(h: Harness, clientId: string): Promise<void> {
  const { error } = await h.service.from("identity_documents").insert([
    { user_id: clientId, kind: "government_id", storage_path: `${clientId}/id.jpg` },
    { user_id: clientId, kind: "proof_of_address", storage_path: `${clientId}/address.jpg` },
  ]);
  if (error) throw new Error(error.message);
}

/** The app's sample report, dated `daysAgo` days ago, in the app's own JSON format (what staff paste). */
export function sampleReport(daysAgo = 2, edit?: (raw: RawReport) => void): RawReport {
  const raw = structuredClone(DEMO_RAW_REPORT);
  raw.pulledAt = ago(daysAgo);
  edit?.(raw);
  return raw;
}
