import { NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/errors";
import { readJsonBody } from "@/lib/security/body";
import { rateLimit } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/staff/access";
import { clientsBodySchema } from "@/lib/staff/api";
import { loadStaffClients } from "@/lib/staff/load";
import { loadTeam } from "@/lib/staff/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { assignmentProblem, checkNewClient, prospectRecord, roundRobinNext, SYSTEM_ACTOR, withAssignment } from "@/lib/staff/team";

// Two things staff do to the client list that are not about a client's case:
//
//   add_prospect  Someone sales talked to, added by hand (administrators and
//                 sales; a salesperson always adds for themselves). Name,
//                 phone, optional email, state and goal. Staff never enter a
//                 Social Security number or a date of birth: the client gives
//                 their identity data themselves, in their own app. With the
//                 round-robin on, the next active specialist gets them.
//   assign        Give clients to a teammate, or to nobody (administrators).
//
// The caller's role is checked here, from their own row, before anything is
// read. Writes use the service role, and every change goes to team_audit.
//
// GET: the console's clients (src/lib/staff/load.ts), for any active member,
// read through the member's OWN connection so the role-scoped read policies of
// migration 0012 decide who appears and how much of each case: never the
// service role. `?id=` reads one client.

const idSchema = z.string().uuid();

export async function GET(req: Request) {
  const limited = rateLimit(req, "staff-clients-read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  // Every role has follow-up: this is the "any active member" check.
  const allowed = await requireCapability("clients.followup");
  if (!allowed.ok) return allowed.response;
  const { member } = allowed;
  const id = new URL(req.url).searchParams.get("id");
  if (id !== null && !idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const reader = await getServerSupabase();
  if (!reader) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const clients = await loadStaffClients(reader, id ? { clientId: id } : {});
    if (id) {
      const client = clients[0] ?? null;
      return client ? NextResponse.json({ client }) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ clients });
  } catch (error) {
    await reportError(error, { where: "api/staff/clients:read", userId: member.userId });
    return NextResponse.json({ error: "Could not read the clients." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "staff-clients", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await readJsonBody(req, 20_000);
  if (!body.ok) return NextResponse.json({ error: "Invalid request body" }, { status: body.status });
  const parsed = clientsBodySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const input = parsed.data;

  const allowed = await requireCapability(input.action === "add_prospect" ? "clients.add" : "clients.assign");
  if (!allowed.ok) return allowed.response;
  const { member, db } = allowed;
  const now = new Date();

  try {
    const { state, records } = await loadTeam(db);

    if (input.action === "add_prospect") {
      const credited = { ...input, salesperson: member.role === "sales" ? member.handle : (input.salesperson ?? member.handle) };
      // The same phone may already belong to an open prospect or to a client with an account.
      const phone = credited.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      const e164 = phone.length === 10 ? `+1${phone}` : null;
      const existing: Array<{ phone: string; firstName: string; lastName: string }> = [];
      if (e164) {
        const [prospects, profiles] = await Promise.all([
          db.from("prospects").select("first_name, last_name, phone_e164").eq("phone_e164", e164).is("converted_user_id", null),
          db.from("profiles").select("full_name, phone_e164").eq("phone_e164", e164),
        ]);
        for (const p of prospects.data ?? []) existing.push({ phone: p.phone_e164, firstName: p.first_name, lastName: p.last_name });
        for (const p of profiles.data ?? []) existing.push({ phone: p.phone_e164, firstName: p.full_name || "un cliente", lastName: "" });
      }
      const check = checkNewClient(credited, existing);
      if (!check.ok) return NextResponse.json({ error: "Invalid", message: "Revisa los datos marcados.", problems: check.problems }, { status: 422 });

      const next = state.settings.autoAssign ? roundRobinNext(state.members, state.settings.lastAutoAssigned) : null;
      const assignee = next ? (records.get(next)?.userId ?? null) : null;
      const { data: row, error } = await db
        .from("prospects")
        .insert({
          first_name: check.value.firstName,
          last_name: check.value.lastName,
          phone_e164: check.value.phone,
          email: check.value.email,
          state: check.value.state,
          goal: check.value.goal,
          salesperson: check.value.salesperson,
          created_by: member.userId,
          assigned_to: assignee,
        })
        .select("id, created_at")
        .single();
      if (error || !row) throw new Error(error?.message ?? "insert returned no row");
      await db.from("team_audit").insert({ actor: member.userId, kind: "prospect_added", prospect_id: row.id, detail: { salesperson: check.value.salesperson } });
      let client = prospectRecord(row.id as string, check.value, member.handle, new Date(row.created_at as string));
      if (assignee && next) {
        await db.from("team_settings").update({ last_auto_assigned: assignee }).eq("id", true);
        await db.from("team_audit").insert({ actor: null, kind: "client_assigned", prospect_id: row.id, member: assignee, member_handle: next, detail: { auto: true } });
        client = withAssignment(client, next, SYSTEM_ACTOR, now.toISOString(), true);
      }
      return NextResponse.json({ ok: true, client });
    }

    // assign
    const problem = assignmentProblem(state.members, input.to);
    if (problem) return NextResponse.json({ error: "Not allowed", message: problem }, { status: 409 });
    const to = input.to ? (records.get(input.to)?.userId ?? null) : null;
    if (input.to && !to) {
      return NextResponse.json({ error: "Not allowed", message: "Esa persona todavía no entra a la consola: no se le pueden asignar clientes." }, { status: 409 });
    }
    const ids = [...new Set(input.clientIds)];
    const [profiles, prospects, current] = await Promise.all([
      db.from("profiles").select("id").in("id", ids),
      db.from("prospects").select("id, assigned_to").in("id", ids),
      db.from("client_assignments").select("user_id, staff_user_id").in("user_id", ids),
    ]);
    const before = new Map<string, string | null>((current.data ?? []).map((r) => [r.user_id as string, (r.staff_user_id as string | null) ?? null]));
    let count = 0;
    for (const { id } of profiles.data ?? []) {
      if ((before.get(id) ?? null) === to) continue;
      const { error } = await db
        .from("client_assignments")
        .upsert({ user_id: id, staff_user_id: to, assigned_at: now.toISOString(), assigned_by: member.userId, auto: false });
      if (error) throw new Error(error.message);
      await db.from("team_audit").insert({ actor: member.userId, kind: "client_assigned", client_id: id, member: to, member_handle: input.to });
      count += 1;
    }
    for (const prospect of prospects.data ?? []) {
      if (((prospect.assigned_to as string | null) ?? null) === to) continue;
      const { error } = await db.from("prospects").update({ assigned_to: to }).eq("id", prospect.id);
      if (error) throw new Error(error.message);
      await db.from("team_audit").insert({ actor: member.userId, kind: "client_assigned", prospect_id: prospect.id, member: to, member_handle: input.to });
      count += 1;
    }
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    await reportError(error, { where: "api/staff/clients", userId: member.userId });
    return NextResponse.json({ error: "Could not save it. Nothing changed; please try again." }, { status: 500 });
  }
}
