import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoalKey } from "../sales/invite";
import { GOALS } from "../sales/invite";
import { checkHouseholdMember, type HouseholdCheck, type HouseholdMemberInput } from "./household";

// Adding a household member, on the server (service role), for the two
// routes that do it: the staff invite (/api/staff/household) and the client's
// onboarding (/api/household). The caller has already checked who may add
// for whom. Here: the checks against what is on record, the member's own
// prospect (source 'household'), the household row, and the team's record.
// The link for the discount is made by the database once both have accounts.

type Row = Record<string, unknown>;

export interface HouseholdPrimary {
  kind: "user" | "prospect";
  id: string;
  firstName: string;
  phone: string | null;
  state: string;
  goal: GoalKey;
  /** The salesperson's handle, carried to the member; null when the person came without one. */
  salesperson: string | null;
  /** The staff user who works the first person: the member starts with the same teammate (separate cases). */
  assignedTo: string | null;
}

export type AddHouseholdResult =
  | { ok: true; prospectId: string; householdId: string; member: Extract<HouseholdCheck, { ok: true }>["value"] }
  | { ok: false; status: number; message: { en: string; es: string }; problems?: Extract<HouseholdCheck, { ok: false }>["problems"] };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** The person adding a member, read with the service role: a client's profile, or a prospect. Null when neither exists. */
export async function loadHouseholdPrimary(db: SupabaseClient, id: string): Promise<HouseholdPrimary | null> {
  const { data: profile } = await db.from("profiles").select("id, full_name, phone_e164, state, goal, referred_by").eq("id", id).maybeSingle();
  if (profile) {
    const p = profile as Row;
    const { data: assignment } = await db.from("client_assignments").select("staff_user_id").eq("user_id", id).maybeSingle();
    const { data: prospect } = await db.from("prospects").select("salesperson").eq("converted_user_id", id).limit(1).maybeSingle();
    const goal = GOALS.find((g) => g.key === p.goal)?.key ?? "general";
    return {
      kind: "user",
      id,
      firstName: text(p.full_name).split(" ")[0] || "",
      phone: text(p.phone_e164) || null,
      state: text(p.state) || "TX",
      goal,
      salesperson: text(p.referred_by) || text((prospect as Row | null)?.salesperson) || null,
      assignedTo: text((assignment as Row | null)?.staff_user_id) || null,
    };
  }
  const { data: prospect } = await db.from("prospects").select("id, first_name, phone_e164, state, goal, salesperson, assigned_to, converted_user_id").eq("id", id).maybeSingle();
  if (!prospect) return null;
  const p = prospect as Row;
  if (p.converted_user_id) return loadHouseholdPrimary(db, text(p.converted_user_id));
  return {
    kind: "prospect",
    id,
    firstName: text(p.first_name),
    phone: text(p.phone_e164) || null,
    state: text(p.state) || "TX",
    goal: GOALS.find((g) => g.key === p.goal)?.key ?? "general",
    salesperson: text(p.salesperson) || null,
    assignedTo: text(p.assigned_to) || null,
  };
}

export async function addHouseholdMember(
  db: SupabaseClient,
  primary: HouseholdPrimary,
  input: HouseholdMemberInput,
  by: { kind: "staff" | "client"; userId: string | null; name: string },
): Promise<AddHouseholdResult> {
  // A household is two people: one open household per person.
  const column = primary.kind === "user" ? "primary_user_id" : "primary_prospect_id";
  const { data: open } = await db.from("household_members").select("id").eq(column, primary.id).is("ended_at", null).limit(1);
  if ((open as Row[] | null)?.length) {
    return {
      ok: false,
      status: 409,
      message: { en: "This person already has a household member. A household is two people.", es: "Esta persona ya tiene a alguien de su hogar. Un hogar son dos personas." },
    };
  }
  const phoneDigits = input.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const e164 = phoneDigits.length === 10 ? `+1${phoneDigits}` : null;
  const taken: string[] = [];
  if (e164) {
    const [prospects, profiles] = await Promise.all([
      db.from("prospects").select("phone_e164").eq("phone_e164", e164).is("converted_user_id", null).is("lost_at", null),
      db.from("profiles").select("phone_e164").eq("phone_e164", e164),
    ]);
    for (const r of [...((prospects.data as Row[] | null) ?? []), ...((profiles.data as Row[] | null) ?? [])]) taken.push(text(r.phone_e164));
  }
  const check = checkHouseholdMember(input, primary.phone, taken);
  if (!check.ok) return { ok: false, status: 422, message: { en: "Check the fields marked.", es: "Revisa los datos marcados." }, problems: check.problems };
  const member = check.value;

  const { data: row, error } = await db
    .from("prospects")
    .insert({
      first_name: member.firstName,
      last_name: member.lastName,
      phone_e164: member.phone,
      email: member.email,
      state: primary.state,
      goal: primary.goal,
      salesperson: primary.salesperson,
      created_by: by.kind === "staff" ? by.userId : null,
      assigned_to: primary.assignedTo,
      source: "household",
      locale: member.locale,
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(`prospects: ${error?.message ?? "no row"}`);
  const prospectId = text((row as Row).id);

  const { data: household, error: householdError } = await db
    .from("household_members")
    .insert({
      [column]: primary.id,
      member_prospect_id: prospectId,
      primary_name: primary.firstName.slice(0, 80) || "—",
      member_name: `${member.firstName} ${member.lastName}`.slice(0, 80),
      relationship: member.relationship,
      added_by: by.kind,
      created_by: by.userId,
      created_by_name: by.name.slice(0, 80),
    })
    .select("id")
    .single();
  if (householdError || !household) throw new Error(`household_members: ${householdError?.message ?? "no row"}`);

  await db.from("team_audit").insert({
    actor: by.kind === "staff" ? by.userId : null,
    kind: "household_member_added",
    prospect_id: prospectId,
    ...(primary.kind === "user" ? { client_id: primary.id } : {}),
    detail: { addedBy: by.kind, relationship: member.relationship },
  });
  return { ok: true, prospectId, householdId: text((household as Row).id), member };
}
