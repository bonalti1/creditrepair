import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_OPEN_STATES, openingProblems, type OpeningRequest } from "./states";

// Which states are opened, on the database (state_openings, migration 0030).
// Service role only; the callers check who is asking. A database without the
// table (or a read that fails) answers with the launch state alone, never
// with more: a failure can close a state, never open one.

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface StateOpening {
  state: string;
  opened: boolean;
  attorneyName: string | null;
  attorneyReviewedOn: string | null;
  registrationRef: string | null;
  bondConfirmed: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function openingFromRow(row: Row): StateOpening {
  return {
    state: text(row.state),
    opened: row.opened === true,
    attorneyName: text(row.attorney_name) || null,
    attorneyReviewedOn: text(row.attorney_reviewed_on).slice(0, 10) || null,
    registrationRef: text(row.registration_ref) || null,
    bondConfirmed: row.bond_confirmed === true,
    note: text(row.note) || null,
    updatedAt: row.updated_at ? new Date(text(row.updated_at)).toISOString() : null,
    updatedBy: text(row.updated_by_name) || null,
  };
}

export async function loadStateOpenings(db: SupabaseClient): Promise<StateOpening[]> {
  const { data, error } = await db.from("state_openings").select("*");
  if (error) throw new Error(`state_openings: ${error.message}`);
  return ((data as Row[] | null) ?? []).map(openingFromRow);
}

/** The opened states; the launch state alone when the table cannot be read. */
export async function loadOpenStates(db: SupabaseClient | null): Promise<string[]> {
  if (!db) return [...DEFAULT_OPEN_STATES];
  try {
    const { data, error } = await db.from("state_openings").select("state").eq("opened", true);
    if (error) return [...DEFAULT_OPEN_STATES];
    return ((data as Row[] | null) ?? []).map((r) => text(r.state));
  } catch {
    return [...DEFAULT_OPEN_STATES];
  }
}

export type SaveOpeningResult = { ok: true; opening: StateOpening } | { ok: false; problems: string[] };

/** Opens or closes a state, with the attorney's review on record. Every change is in the team's audit. */
export async function saveStateOpening(
  db: SupabaseClient,
  req: OpeningRequest & { note?: string | null },
  by: { userId: string; handle: string },
  today: Date = new Date(),
): Promise<SaveOpeningResult> {
  const problems = openingProblems(req, today);
  if (problems.length > 0) return { ok: false, problems };
  const state = req.state.toUpperCase();
  const row = {
    state,
    opened: req.opened,
    ...(req.opened
      ? {
          attorney_name: req.attorneyName!.trim(),
          attorney_reviewed_on: req.attorneyReviewedOn,
          registration_ref: req.registrationRef?.trim() || null,
          bond_confirmed: Boolean(req.bondConfirmed),
        }
      : {}),
    note: req.note?.trim().slice(0, 500) || null,
    updated_at: new Date().toISOString(),
    updated_by: by.userId,
    updated_by_name: by.handle,
  };
  const { data, error } = await db.from("state_openings").upsert(row, { onConflict: "state" }).select("*").single();
  if (error) {
    if (error.code === "23514") return { ok: false, problems: ["invalid"] };
    throw new Error(`state_openings: ${error.message}`);
  }
  await db.from("team_audit").insert({ actor: by.userId, kind: "state_opening_changed", detail: { state, opened: req.opened, attorneyName: req.attorneyName ?? null, attorneyReviewedOn: req.attorneyReviewedOn ?? null } });
  return { ok: true, opening: openingFromRow(data as Row) };
}
