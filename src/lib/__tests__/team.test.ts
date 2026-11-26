import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { NO_BILLING, type BillingCharge } from "../billing/types";
import { paidUpBilling, sampleMethod } from "../staff/billing";
import { ACTIVITY_TYPES, activityFeed, actorHandle, clientActivity, filterActivity, teamActivity } from "../staff/activity";
import { clientsBodySchema, MAX_BULK_ASSIGN, teamBodySchema } from "../staff/api";
import { billingState, clientRows, clientsCsv, csvCell, CSV_COLUMNS, filterRows, historyFor, nextStepFor } from "../staff/clientList";
import { applyDemoActions, EMPTY_ACTIONS, type StaffData } from "../staff/data";
import { buildDemoClients } from "../staff/demoClients";
import { exceptionKindOfKey, guardStaffData, PermissionError } from "../staff/guard";
import {
  behindCycle,
  businessMetrics,
  endedAt,
  formatPercent,
  inRange,
  isActiveClient,
  METRIC_INFOS,
  monthlySeries,
  periodRange,
  PERIODS,
  startOfTexasMonth,
} from "../staff/metrics";
import {
  can,
  canSeeClient,
  CAPABILITIES,
  CAPABILITY_LABELS,
  defaultsToMine,
  deniedReason,
  exceptionVisibleTo,
  isMine,
  isStaffRole,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SUMMARIES,
  rolesThatCan,
  scopeOf,
  STAFF_ROLES,
  visibleClients,
  type Viewer,
} from "../staff/permissions";
import { clientExceptions, clientStage, EXCEPTION_KINDS, sendableRound } from "../staff/stage";
import {
  addMember,
  assignableMembers,
  assignmentProblem,
  buildDemoTeam,
  changeRole,
  checkNewClient,
  cleanPersonName,
  memberName,
  newHandle,
  normalizeEmail,
  normalizePhone,
  prospectRecord,
  roundRobinNext,
  setAutoAssign,
  setMemberActive,
  teamEventText,
  withAssignment,
  type NewClientInput,
  type TeamMember,
  type TeamState,
} from "../staff/team";
import { applyTeamActions, EMPTY_TEAM_ACTIONS } from "../staff/teamStore";
import { clientTimeline } from "../staff/timeline";
import type { StaffClient, StaffRole, StaffRound } from "../staff/types";
import { setStaffLocaleFallback } from "../staff/i18n/locale";

// Written against the Spanish console: the sentences these tests pin are the Spanish ones.
setStaffLocaleFallback("es");

// Noon in Texas on Saturday 5 December 2026, as in the other staff tests.
const NOW = new Date("2026-12-05T18:00:00.000Z");
const later = new Date(NOW.getTime() + 5 * 60 * 1000);
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const ADMIN: Viewer = { handle: "carmen", name: "Carmen Ruiz", role: "admin" };
const SPECIALIST: Viewer = { handle: "marta", name: "Marta Leal", role: "specialist" };
const SALES: Viewer = { handle: "ana", name: "Ana Prieto", role: "sales" };

const demo = () => buildDemoClients(NOW);
const team = () => buildDemoTeam(NOW);

function member(handle: string, role: StaffRole, extra: Partial<TeamMember> = {}): TeamMember {
  return {
    handle,
    name: `${handle.charAt(0).toUpperCase()}${handle.slice(1)} Prueba`,
    role,
    email: `${handle}@ejemplo.com`,
    phone: null,
    active: true,
    invitedAt: ago(100),
    invitedBy: null,
    deactivatedAt: null,
    ...extra,
  };
}

const state = (members: TeamMember[]): TeamState => ({ members, settings: { autoAssign: false, lastAutoAssigned: null }, events: [] });

// ── The permission matrix ───────────────────────────────────────────────

describe("team: the permission matrix", () => {
  it("decides every capability for every role, with a label", () => {
    for (const role of STAFF_ROLES) {
      expect(Object.keys(ROLE_PERMISSIONS[role].can).sort()).toEqual([...CAPABILITIES].sort());
      expect(ROLE_LABELS.es[role].length).toBeGreaterThan(3);
      expect(ROLE_SUMMARIES.es[role].length).toBeGreaterThan(20);
    }
    for (const capability of CAPABILITIES) expect(CAPABILITY_LABELS.es[capability].length).toBeGreaterThan(5);
  });

  it("gives an administrator everything and every client", () => {
    for (const capability of CAPABILITIES) expect(can("admin", capability), capability).toBe(true);
    expect(scopeOf("admin")).toBe("all");
  });

  it("a specialist works the clients assigned to them: reports, letters, replies; no money changes, no team, no business numbers", () => {
    expect(scopeOf("specialist")).toBe("assigned");
    for (const yes of ["case.view", "reports.import", "rounds.send", "clients.reply", "clients.export", "clients.followup", "billing.view"] as const) {
      expect(can("specialist", yes), yes).toBe(true);
    }
    for (const no of ["clients.add", "clients.invite", "clients.assign", "billing.pause", "billing.refund", "business.view", "team.manage"] as const) {
      expect(can("specialist", no), no).toBe(false);
    }
  });

  it("sales adds people and invites, sees only who they brought in, and no letters or money", () => {
    expect(scopeOf("sales")).toBe("brought");
    for (const yes of ["clients.add", "clients.invite", "clients.followup"] as const) expect(can("sales", yes), yes).toBe(true);
    for (const no of ["case.view", "reports.import", "rounds.send", "clients.reply", "billing.view", "billing.pause", "billing.refund", "clients.assign", "clients.export", "business.view", "team.manage"] as const) {
      expect(can("sales", no), no).toBe(false);
    }
  });

  it("refunds, pausing billing, the team and the business numbers are an administrator's only", () => {
    for (const capability of ["billing.refund", "billing.pause", "team.manage", "business.view", "clients.assign"] as const) {
      expect(rolesThatCan(capability)).toEqual(["admin"]);
    }
  });

  it("nobody without a known role may do anything", () => {
    for (const role of [null, undefined, "", "owner", "ADMIN"]) {
      for (const capability of CAPABILITIES) expect(can(role as StaffRole, capability)).toBe(false);
      expect(scopeOf(role as StaffRole)).toBeNull();
    }
    expect(isStaffRole("specialist")).toBe(true);
    expect(isStaffRole("owner")).toBe(false);
  });

  it("explains a refusal in one short line, naming who may", () => {
    expect(deniedReason("billing.refund")).toBe("Solo un administrador puede devolver cobros.");
    expect(deniedReason("rounds.send")).toBe("Solo un administrador o un especialista puede enviar e imprimir rondas.");
    expect(deniedReason("clients.add")).toBe("Solo un administrador o ventas puede agregar clientes a mano.");
    for (const capability of CAPABILITIES) {
      expect(deniedReason(capability)).toMatch(/^Solo .+\.$/);
      expect(checkClaimGuardrails(deniedReason(capability))).toEqual([]);
    }
  });

  it("no capability lets anyone on the team answer for the client", () => {
    for (const capability of CAPABILITIES) expect(capability).not.toMatch(/answer|flag|attest|dispute|mark/i);
    const data = readFileSync("src/lib/staff/teamData.ts", "utf8");
    expect(data).not.toMatch(/answers\s*[:=]|ItemAnswer|item_flags/);
  });

  it("is the same in the database: the read scopes in migration 0012 follow the matrix", () => {
    const sql = readFileSync("supabase/migrations/0012_team.sql", "utf8").replace(/--.*$/gm, "");
    const rolesIn = (fn: string) => {
      const body = sql.slice(sql.indexOf(`create function public.${fn}(`));
      return [...body.slice(0, body.indexOf("$$;")).matchAll(/staff_role\(\) in \(([^)]+)\)/g)].flatMap((m) => m[1]!.split(",").map((r) => r.trim().replace(/'/g, "")));
    };
    expect(rolesIn("staff_can_see_case").sort()).toEqual(rolesThatCan("case.view").sort());
    expect(rolesIn("staff_can_see_billing").sort()).toEqual(rolesThatCan("billing.view").sort());
    const client = sql.slice(sql.indexOf("create function public.staff_can_see_client("));
    const scopeSql = client.slice(0, client.indexOf("$$;"));
    expect(scopeSql).toMatch(/s\.role = 'admin'/);
    expect(scopeSql).toMatch(/s\.role = 'specialist' and exists \(\s*select 1 from public\.client_assignments/);
    expect(scopeSql).toMatch(/s\.role = 'sales' and s\.handle is not null and exists \(\s*select 1 from public\.profiles p where p\.id = client and p\.referred_by = s\.handle/);
    expect(STAFF_ROLES.map((r) => scopeOf(r))).toEqual(["all", "assigned", "brought"]);
  });
});

describe("team: who sees which client", () => {
  const clients = demo();

  it("an administrator sees everyone; a specialist only their assigned clients; sales only the people they brought in", () => {
    expect(visibleClients(ADMIN, clients)).toHaveLength(clients.length);
    const marta = visibleClients(SPECIALIST, clients);
    expect(marta.length).toBeGreaterThan(5);
    expect(marta.every((c) => c.assignedTo === "marta")).toBe(true);
    const ana = visibleClients(SALES, clients);
    expect(ana.length).toBeGreaterThan(3);
    expect(ana.every((c) => c.salesperson === "ana")).toBe(true);
    // A client nobody works yet is seen by an administrator only.
    const nobody = clients.find((c) => !c.assignedTo && c.salesperson !== "ana")!;
    expect(canSeeClient(ADMIN, nobody)).toBe(true);
    expect(canSeeClient(SPECIALIST, nobody)).toBe(false);
    expect(canSeeClient(null, nobody)).toBe(false);
  });

  it("a specialist who once sold someone does not see them unless assigned: the role decides, not history", () => {
    const sold = { assignedTo: "carmen", salesperson: "marta" } as StaffClient;
    expect(canSeeClient(SPECIALIST, sold)).toBe(false);
    expect(isMine(SPECIALIST, sold)).toBe(true);
  });

  it("'Mis clientes' is assigned or brought in, and it is the default for anyone who cannot see everyone", () => {
    expect(isMine(ADMIN, { assignedTo: "carmen", salesperson: "luis" } as StaffClient)).toBe(true);
    expect(isMine(ADMIN, { assignedTo: "marta", salesperson: "carmen" } as StaffClient)).toBe(true);
    expect(isMine(ADMIN, { assignedTo: "marta", salesperson: "ana" } as StaffClient)).toBe(false);
    expect(defaultsToMine("admin")).toBe(false);
    expect(defaultsToMine("specialist")).toBe(true);
    expect(defaultsToMine("sales")).toBe(true);
  });

  it("sales is shown only the notices about getting a person started", () => {
    const shown = EXCEPTION_KINDS.filter((k) => exceptionVisibleTo("sales", k));
    // And the gentle follow-up for a Credalti DIY client whose letters wait unmailed (docs/SERVICE-OPTIONS.md).
    expect(shown.sort()).toEqual(["agreement_unsigned", "diy_followup", "documents_missing"]);
    for (const k of EXCEPTION_KINDS) {
      expect(exceptionVisibleTo("admin", k)).toBe(true);
      // The DIY follow-up is a sales conversation (the "options.followup" capability): admin and sales.
      expect(exceptionVisibleTo("specialist", k)).toBe(k !== "diy_followup");
      expect(exceptionVisibleTo(null, k)).toBe(false);
    }
  });
});

// ── The data, as one member may use it ──────────────────────────────────

/** The demo data in memory, with the calls it received. */
function fakeData() {
  let clients = demo();
  const calls: string[] = [];
  const data: StaffData = {
    demo: true,
    listClients: async () => clients,
    getClient: async (id) => clients.find((c) => c.id === id) ?? null,
    markRoundsSent: async (refs) => {
      calls.push(`send:${refs.map((r) => `${r.clientId}:${r.roundNumber}`).join(",")}`);
      // Like the demo data layer: only a round that may go out now is marked.
      const may = refs.filter((r) => sendableRound(clients.find((c) => c.id === r.clientId)!, later)?.number === r.roundNumber);
      const sent = Object.fromEntries(may.map((r) => [r.clientId, { [String(r.roundNumber)]: later.toISOString() }]));
      clients = applyDemoActions(clients, { ...EMPTY_ACTIONS, sent });
    },
    addNote: async (clientId, text, author) => {
      calls.push(`note:${clientId}`);
      return { id: "n", at: later.toISOString(), author, text };
    },
    resolveException: async (clientId, key) => void calls.push(`handled:${clientId}:${key}`),
    saveReport: async (clientId) => void calls.push(`report:${clientId}`),
    saveReportSample: async (clientId) => {
      calls.push(`sample:${clientId}`);
      return { sample: { id: "s", provider: "x", savedAt: "", savedBy: "", fileName: null, text: "" }, persisted: true };
    },
    sendReply: async (clientId) => {
      calls.push(`reply:${clientId}`);
      return { sent: false, problems: [] };
    },
    refundCharge: async (clientId) => {
      calls.push(`refund:${clientId}`);
      return { ok: true };
    },
    pauseBilling: async (clientId) => {
      calls.push(`pause:${clientId}`);
      return { ok: true };
    },
    resumeBilling: async (clientId) => {
      calls.push(`resume:${clientId}`);
      return { ok: true };
    },
    recordChargeback: async (clientId) => {
      calls.push(`chargeback:${clientId}`);
      return { ok: true };
    },
    setChargebackStatus: async (clientId) => {
      calls.push(`chargeback-status:${clientId}`);
      return { ok: true };
    },
  };
  return { data, calls };
}

describe("team: the data layer checks the role again", () => {
  it("lists and opens only the clients the viewer may see", async () => {
    const { data } = fakeData();
    const marta = guardStaffData(data, SPECIALIST);
    expect((await marta.listClients()).every((c) => c.assignedTo === "marta")).toBe(true);
    expect(await marta.getClient("c10")).toBeNull(); // Carmen's client
    expect(await marta.getClient("c20")).not.toBeNull();
    expect(await guardStaffData(data, null).listClients()).toEqual([]);
  });

  it("sends only rounds the role may send, for clients the viewer has, and records who sent them", async () => {
    const { data, calls } = fakeData();
    const senders: string[] = [];
    const marta = guardStaffData(data, SPECIALIST, { onRoundsSent: (refs, by) => void senders.push(...refs.map((r) => `${r.clientId}:${by}`)) });
    // c07 and c08 are Marta's and ready; c14 is Carmen's and ready.
    await marta.markRoundsSent([{ clientId: "c07", roundNumber: 1 }, { clientId: "c14", roundNumber: 2 }, { clientId: "c08", roundNumber: 1 }]);
    expect(calls).toEqual(["send:c07:1,c08:1"]);
    expect(senders).toEqual(["c07:marta", "c08:marta"]);
    await expect(guardStaffData(data, SALES).markRoundsSent([{ clientId: "c03", roundNumber: 1 }])).rejects.toBeInstanceOf(PermissionError);
    await expect(guardStaffData(data, SALES).markRoundsSent([{ clientId: "c03", roundNumber: 1 }])).rejects.toThrow(deniedReason("rounds.send"));
  });

  it("only records a sender for a round that actually went out", async () => {
    const { data } = fakeData();
    const senders: string[] = [];
    // c09's round is prepared but its report is too old to send on: the data layer skips it.
    await guardStaffData(data, SPECIALIST, { onRoundsSent: (refs) => void senders.push(...refs.map((r) => r.clientId)) }).markRoundsSent([{ clientId: "c09", roundNumber: 1 }]);
    expect(senders).toEqual([]);
  });

  it("refuses money to anyone but an administrator, with the reason, and never reaches the data", async () => {
    const { data, calls } = fakeData();
    const marta = guardStaffData(data, SPECIALIST);
    expect(await marta.refundCharge("c20", "c20-ch1", "Motivo suficiente aquí", "marta")).toEqual({ ok: false, message: deniedReason("billing.refund") });
    expect(await marta.pauseBilling("c20", "Motivo", "marta")).toEqual({ ok: false, message: deniedReason("billing.pause") });
    expect(await marta.resumeBilling("c20")).toEqual({ ok: false, message: deniedReason("billing.pause") });
    expect(calls).toEqual([]);
    expect(await guardStaffData(data, ADMIN).refundCharge("c20", "c20-ch1", "Motivo suficiente aquí", "carmen")).toEqual({ ok: true });
    expect(calls).toEqual(["refund:c20"]);
  });

  it("an administrator acting on a client outside nobody's scope still works; a specialist on someone else's client does not", async () => {
    const { data, calls } = fakeData();
    await expect(guardStaffData(data, SPECIALIST).addNote("c10", "x", "marta")).rejects.toThrow(/no está entre los tuyos/);
    await expect(guardStaffData(data, SPECIALIST).sendReply("c10", "x", "Marta")).rejects.toBeInstanceOf(PermissionError);
    await guardStaffData(data, ADMIN).addNote("c10", "x", "carmen");
    expect(calls).toEqual(["note:c10"]);
  });

  it("sales cannot import, reply, or close a fulfillment notice, but can follow up their own people", async () => {
    const { data, calls } = fakeData();
    const ana = guardStaffData(data, SALES);
    await expect(ana.saveReport("c03", { readerKey: "x", report: {} as never, by: "ana" })).rejects.toThrow(deniedReason("reports.import"));
    await expect(ana.saveReportSample("c03", { provider: "x", text: "", fileName: null, by: "ana" })).rejects.toBeInstanceOf(PermissionError);
    await expect(ana.sendReply("c03", "Hola", "Ana")).rejects.toThrow(deniedReason("clients.reply"));
    await expect(ana.resolveException("c09", "report_stale")).rejects.toThrow(/lo atiende el equipo/);
    await ana.resolveException("c03", "documents_missing");
    await ana.addNote("c03", "Le escribí.", "ana");
    expect(calls).toEqual(["handled:c03:documents_missing", "note:c03"]);
  });

  it("reads an exception's kind from its key", () => {
    expect(exceptionKindOfKey("question:c04-q1")).toBe("question_waiting");
    expect(exceptionKindOfKey("payment_past_due:c15-ch1")).toBe("payment_past_due");
    expect(exceptionKindOfKey("review_stalled")).toBe("review_stalled");
  });
});

// ── Team rules ──────────────────────────────────────────────────────────

describe("team: adding people", () => {
  const base = state([member("carmen", "admin"), member("marta", "specialist", { phone: "+17135550191" })]);

  it("adds a person with a role and an email or a phone, as pending until they sign in, and records it", () => {
    const result = addMember(base, { name: "  Jorge   Paz ", email: "Jorge@Ejemplo.com ", role: "specialist" }, "carmen", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.member).toMatchObject({ handle: "jorge", name: "Jorge Paz", email: "jorge@ejemplo.com", phone: null, role: "specialist", active: true, pending: true, invitedBy: "carmen" });
    expect(result.state.members).toHaveLength(3);
    expect(result.state.events.at(-1)).toMatchObject({ kind: "member_added", by: "carmen", member: "jorge", to: "specialist" });
    const byPhone = addMember(base, { name: "Ana Prieto", phone: "(713) 555-0192", role: "sales" }, "carmen", NOW);
    expect(byPhone.ok && byPhone.member?.phone).toBe("+17135550192");
  });

  it("refuses a missing name, role or contact, and contact details that do not read", () => {
    const refuse = (input: Parameters<typeof addMember>[1]) => {
      const r = addMember(base, input, "carmen", NOW);
      return r.ok ? "" : r.message;
    };
    expect(refuse({ name: "", email: "a@b.com", role: "sales" })).toMatch(/nombre/);
    expect(refuse({ name: "J0rge<script>", email: "a@b.com", role: "sales" })).toMatch(/nombre/);
    expect(refuse({ name: "Jorge Paz", email: "a@b.com", role: "owner" })).toMatch(/rol/);
    expect(refuse({ name: "Jorge Paz", role: "sales" })).toMatch(/correo o su teléfono/);
    expect(refuse({ name: "Jorge Paz", email: "jorge@", role: "sales" })).toMatch(/correo no parece válido/);
    expect(refuse({ name: "Jorge Paz", phone: "555-12", role: "sales" })).toMatch(/teléfono no parece válido/);
  });

  it("does not add the same person twice, even one who was deactivated: they are reactivated instead", () => {
    const withEx = state([...base.members, member("rocio", "specialist", { active: false, deactivatedAt: ago(5), email: "rocio@ejemplo.com" })]);
    const again = addMember(withEx, { name: "Rocío Vela", email: "ROCIO@ejemplo.com", role: "specialist" }, "carmen", NOW);
    expect(again.ok ? "" : again.message).toMatch(/Reactívala/);
    const samePhone = addMember(withEx, { name: "Otra Persona", phone: "713-555-0191", role: "sales" }, "carmen", NOW);
    expect(samePhone.ok ? "" : samePhone.message).toMatch(/ya está en el equipo con ese teléfono/);
  });

  it("gives everyone a handle no one has used", () => {
    expect(newHandle("Ana Prieto", [])).toBe("ana");
    expect(newHandle("Ana Prieto", ["ana"])).toBe("ana-prieto");
    expect(newHandle("Ana Prieto", ["ana", "ana-prieto"])).toBe("ana-2");
    expect(newHandle("Ángela Núñez", [])).toBe("angela");
    expect(normalizeEmail("x")).toBeNull();
    expect(normalizePhone("+1 (713) 555-0142")).toBe("+17135550142");
    expect(normalizePhone("123-456-7890")).toBeNull();
    expect(cleanPersonName("O'Neil-Ruiz")).toBe("O'Neil-Ruiz");
  });
});

describe("team: roles and deactivation", () => {
  const base = state([member("carmen", "admin"), member("marta", "specialist"), member("ana", "sales")]);

  it("changes a role and records from what to what", () => {
    const r = changeRole(base, "ana", "specialist", "carmen", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.members.find((m) => m.handle === "ana")!.role).toBe("specialist");
    expect(r.state.events.at(-1)).toMatchObject({ kind: "role_changed", member: "ana", from: "sales", to: "specialist" });
    expect(teamEventText(r.state.events.at(-1)!, r.state.members)).toBe("Carmen Prueba cambió el rol de Ana Prueba: Ventas → Especialista");
    // The same role again changes nothing and records nothing.
    expect(changeRole(base, "ana", "sales", "carmen", NOW)).toEqual({ ok: true, state: base });
  });

  it("always keeps one active administrator", () => {
    const r = changeRole(base, "carmen", "specialist", "carmen", NOW);
    expect(r.ok ? "" : r.message).toMatch(/única persona administradora/);
    const d = setMemberActive(base, "carmen", false, "marta", NOW);
    expect(d.ok ? "" : d.message).toMatch(/única persona administradora/);
    // With a second administrator, either can step down.
    const two = state([...base.members, member("luis", "admin")]);
    expect(changeRole(two, "carmen", "specialist", "luis", NOW).ok).toBe(true);
    expect(setMemberActive(two, "carmen", false, "luis", NOW).ok).toBe(true);
  });

  it("nobody deactivates themselves", () => {
    const two = state([...base.members, member("luis", "admin")]);
    const r = setMemberActive(two, "carmen", false, "carmen", NOW);
    expect(r.ok ? "" : r.message).toMatch(/No puedes desactivar tu propia cuenta/);
  });

  it("deactivates without deleting: the name stays, the date is kept, and reactivating clears it", () => {
    const off = setMemberActive(base, "marta", false, "carmen", NOW);
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    const marta = off.state.members.find((m) => m.handle === "marta")!;
    expect(marta).toMatchObject({ active: false, deactivatedAt: NOW.toISOString(), name: "Marta Prueba" });
    expect(off.state.members).toHaveLength(3);
    expect(memberName(off.state.members, "marta")).toBe("Marta Prueba");
    expect(assignableMembers(off.state.members).map((m) => m.handle)).toEqual(["carmen"]);
    const on = setMemberActive(off.state, "marta", true, "carmen", NOW);
    expect(on.ok && on.state.members.find((m) => m.handle === "marta")).toMatchObject({ active: true, deactivatedAt: null });
    expect(on.ok && on.state.events.map((e) => e.kind)).toEqual(["member_deactivated", "member_reactivated"]);
    expect(setMemberActive(base, "nadie", false, "carmen", NOW).ok).toBe(false);
  });

  it("switches the round-robin and says so", () => {
    const r = setAutoAssign(base, true, "carmen", NOW);
    expect(r.ok && r.state.settings.autoAssign).toBe(true);
    expect(r.ok && teamEventText(r.state.events[0]!, base.members)).toBe("Carmen Prueba activó la asignación automática de clientes nuevos");
    expect(setAutoAssign(base, false, "carmen", NOW)).toEqual({ ok: true, state: base });
  });

  it("the demo team: four invented people, one administrator, one specialist, two in sales, with its history", () => {
    const t = team();
    expect(t.members.map((m) => `${m.handle}:${m.role}`)).toEqual(["carmen:admin", "marta:specialist", "ana:sales", "luis:sales"]);
    expect(t.members.every((m) => m.active)).toBe(true);
    for (const m of t.members) if (m.phone) expect(m.phone).toMatch(/^\+1\d{3}55501\d{2}$/);
    expect(t.settings.autoAssign).toBe(true);
    expect(t.events.length).toBeGreaterThan(2);
    for (const event of t.events) expect(checkClaimGuardrails(teamEventText(event, t.members))).toEqual([]);
    // Every salesperson and every assignee the demo clients name is on the team.
    const handles = new Set(t.members.map((m) => m.handle));
    for (const c of demo()) {
      expect(handles.has(c.salesperson), c.salesperson).toBe(true);
      if (c.assignedTo) expect(["carmen", "marta"]).toContain(c.assignedTo);
    }
  });
});

describe("team: assignment", () => {
  const members = [
    member("carmen", "admin", { invitedAt: ago(300) }),
    member("marta", "specialist", { invitedAt: ago(200) }),
    member("jorge", "specialist", { invitedAt: ago(100) }),
    member("rocio", "specialist", { invitedAt: ago(150), active: false, deactivatedAt: ago(10) }),
    member("ana", "sales", { invitedAt: ago(250) }),
  ];

  it("the round-robin gives clients to active specialists in turn, in the order they joined", () => {
    expect(roundRobinNext(members, null)).toBe("marta");
    expect(roundRobinNext(members, "marta")).toBe("jorge");
    expect(roundRobinNext(members, "jorge")).toBe("marta");
    // Someone who left, or who is not a specialist, is skipped.
    expect(roundRobinNext(members, "rocio")).toBe("marta");
    expect(roundRobinNext(members, "carmen")).toBe("marta");
    expect(roundRobinNext(members.filter((m) => m.role !== "specialist"), null)).toBeNull();
    // Twelve clients in a row split evenly.
    let last: string | null = null;
    const tally: Record<string, number> = {};
    for (let i = 0; i < 12; i += 1) {
      last = roundRobinNext(members, last);
      tally[last!] = (tally[last!] ?? 0) + 1;
    }
    expect(tally).toEqual({ marta: 6, jorge: 6 });
  });

  it("a client goes to an active administrator or specialist, or to nobody", () => {
    expect(assignmentProblem(members, "marta")).toBeNull();
    expect(assignmentProblem(members, "carmen")).toBeNull();
    expect(assignmentProblem(members, null)).toBeNull();
    expect(assignmentProblem(members, "ana")).toMatch(/Ventas no trabaja los casos/);
    expect(assignmentProblem(members, "rocio")).toMatch(/desactivada/);
    expect(assignmentProblem(members, "nadie")).toMatch(/no está en el equipo/);
  });

  it("keeps every assignment, and an assignment to the same person changes nothing", () => {
    const c = demo().find((x) => x.id === "c07")!;
    const moved = withAssignment(c, "jorge", "carmen", later.toISOString());
    expect(moved.assignedTo).toBe("jorge");
    expect(moved.assignments!.at(-1)).toEqual({ at: later.toISOString(), to: "jorge", by: "carmen", auto: false });
    expect(moved.assignments).toHaveLength((c.assignments?.length ?? 0) + 1);
    expect(withAssignment(moved, "jorge", "carmen", later.toISOString())).toBe(moved);
    expect(withAssignment(moved, null, "carmen", later.toISOString()).assignedTo).toBeNull();
    expect(c.assignedTo).toBe("marta");
  });

  it("the demo replays assignments and senders over the clients; a sender only sticks to a mailed round", () => {
    const clients = demo();
    const after = applyTeamActions(clients, {
      ...EMPTY_TEAM_ACTIONS,
      assignments: { c03: [{ at: later.toISOString(), to: "marta", by: "carmen", auto: false }] },
      sentBy: { c07: { "1": "carmen" }, c20: { "2": "carmen" } },
    });
    const byId = (id: string) => after.find((c) => c.id === id)!;
    expect(byId("c03").assignedTo).toBe("marta");
    expect(byId("c07").rounds[0]!.sentBy).toBeUndefined(); // ready, not mailed
    expect(byId("c20").rounds[1]!.sentBy).toBe("carmen");
    expect(applyTeamActions(clients, EMPTY_TEAM_ACTIONS)).toEqual(clients);
  });

  it("the demo's clients: leads and the unsigned are nobody's; every mailed round says who sent it", () => {
    for (const c of demo()) {
      if (clientStage(c, later) === "lead") expect(c.assignedTo ?? null).toBeNull();
      // "sistema": a round the autopilot mailed by itself after its review window (autopilot/demo.ts: Joaquín's).
      for (const r of c.rounds) if (r.mailedAt) expect(["carmen", "marta", "sistema"]).toContain(r.sentBy);
      if (c.assignedTo) expect(c.assignments?.at(-1)?.to).toBe(c.assignedTo);
    }
  });
});

describe("team: adding a person by hand", () => {
  const input: NewClientInput = { firstName: " Lucía ", lastName: "Herrera", phone: "(713) 555-0188", email: "", state: "tx", goal: "auto", salesperson: "Ana" };

  it("takes a name, phone, optional email, state and goal, and makes a prospect credited to a salesperson", () => {
    const check = checkNewClient(input, demo());
    expect(check).toEqual({ ok: true, value: { firstName: "Lucía", lastName: "Herrera", phone: "+17135550188", email: null, state: "TX", goal: "auto", salesperson: "ana" } });
    if (!check.ok) return;
    const client = prospectRecord("n1", check.value, "ana", NOW);
    expect(clientStage(client, NOW)).toBe("lead");
    expect(client).toMatchObject({ addedBy: "ana", salesperson: "ana", goal: "auto", signedUpAt: null, agreementSignedAt: null, billing: NO_BILLING });
    expect(clientExceptions(client, NOW)).toEqual([]);
    expect(clientActivity(client, team().members)[0]!.text).toBe("Ana Prieto agregó a Lucía Herrera a mano (ventas: Ana Prieto)");
  });

  it("says what is wrong with each field, and finds a phone already on file", () => {
    const check = checkNewClient({ firstName: "", lastName: "1", phone: "713", email: "nope", state: "ZZ", goal: "lottery", salesperson: "" }, []);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(Object.keys(check.problems).sort()).toEqual(["email", "firstName", "goal", "lastName", "phone", "salesperson", "state"]);
    const dup = checkNewClient({ ...input, phone: "+1 713 555 0101" }, demo());
    expect(!dup.ok && dup.problems.phone).toBe("Ya hay un cliente con este teléfono: Mariana Robles.");
  });

  it("has no place for a Social Security number or a date of birth, anywhere staff type", () => {
    const sources = ["src/lib/staff/team.ts", "src/lib/staff/api.ts", "src/components/staff/AddClient.tsx", "src/app/api/staff/clients/route.ts"].map((f) => readFileSync(f, "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/\b(ssn|dob|dateOfBirth|birth_?date|socialSecurity)\s*[:?=]/i);
    }
    expect(readFileSync("src/lib/staff/team.ts", "utf8")).toMatch(/Staff never type a Social Security number or a date of birth/);
    expect(readFileSync("src/components/staff/AddClient.tsx", "utf8")).toMatch(/No pedimos su número de Seguro Social ni su fecha de nacimiento/);
    // The request refuses any field it does not expect.
    expect(clientsBodySchema.safeParse({ action: "add_prospect", firstName: "Lu", lastName: "He", phone: "7135550188", state: "TX", goal: "auto", ssn: "123-45-6789" }).success).toBe(false);
  });

  it("produces the invite page's own link and message, not a copy of it", () => {
    const add = readFileSync("src/components/staff/AddClient.tsx", "utf8");
    expect(add).toMatch(/import \{ buildInvitePath, GOALS, inviteMessage, type GoalKey \} from "@\/lib\/sales\/invite"/);
    // In the client's language, chosen on the panel: the link carries it and the message is written in it.
    expect(add).toMatch(/buildInvitePath\(\{[^}]*\blang \}\)/);
    expect(add).toMatch(/inviteMessage\(\{ name: added\.firstName \}, url, lang\)/);
    expect(add).not.toMatch(/Aquí está tu enlace/);
  });
});

describe("team: what the staff routes accept", () => {
  it("team changes: four actions, strict bodies, valid roles and handles", () => {
    expect(teamBodySchema.safeParse({ action: "add_member", name: "Jorge Paz", email: "j@x.com", role: "specialist" }).success).toBe(true);
    expect(teamBodySchema.safeParse({ action: "change_role", handle: "ana", role: "admin" }).success).toBe(true);
    expect(teamBodySchema.safeParse({ action: "set_active", handle: "ana", active: false }).success).toBe(true);
    expect(teamBodySchema.safeParse({ action: "set_auto_assign", on: true }).success).toBe(true);
    for (const bad of [
      { action: "delete_member", handle: "ana" },
      { action: "change_role", handle: "ana", role: "owner" },
      { action: "change_role", handle: "Ana Pérez", role: "admin" },
      { action: "set_active", handle: "ana", active: false, userId: "x" },
      { action: "add_member", name: "J", role: "sales" },
    ]) {
      expect(teamBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("assignment: database ids only, at most a batch, a handle or nobody", () => {
    const id = "3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77";
    expect(clientsBodySchema.safeParse({ action: "assign", clientIds: [id], to: "marta" }).success).toBe(true);
    expect(clientsBodySchema.safeParse({ action: "assign", clientIds: [id], to: null }).success).toBe(true);
    expect(clientsBodySchema.safeParse({ action: "assign", clientIds: ["c07"], to: "marta" }).success).toBe(false);
    expect(clientsBodySchema.safeParse({ action: "assign", clientIds: [], to: "marta" }).success).toBe(false);
    expect(clientsBodySchema.safeParse({ action: "assign", clientIds: Array(MAX_BULK_ASSIGN + 1).fill(id), to: "marta" }).success).toBe(false);
  });

  const post = (path: string, body: unknown) =>
    new Request(`https://x.test${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("in the demo (no database) they answer like the other staff routes, and a bad body is refused first", async () => {
    const teamRoute = await import("@/app/api/staff/team/route");
    const clientsRoute = await import("@/app/api/staff/clients/route");
    const refused = await teamRoute.POST(post("/api/staff/team", { action: "set_auto_assign", on: true }));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "Supabase not configured" });
    expect((await teamRoute.GET(new Request("https://x.test/api/staff/team"))).status).toBe(503);
    expect((await clientsRoute.POST(post("/api/staff/clients", { action: "assign", clientIds: ["3f2b6c1e-8a44-4d0e-9a51-0c9d2f6f1a77"], to: "marta" }))).status).toBe(503);
    expect((await clientsRoute.POST(post("/api/staff/clients", { action: "assign", clientIds: ["c07"], to: "marta" }))).status).toBe(400);
  });

  it("every staff route checks the caller's role on the server, from their own row", () => {
    const read = (path: string) => readFileSync(path, "utf8");
    const team = read("src/app/api/staff/team/route.ts");
    expect(team).toMatch(/requireCapability\("team\.manage"\)/);
    expect(team).toMatch(/rateLimit\(req, "staff-team"/);
    expect(team).toMatch(/teamBodySchema\.safeParse/);
    expect(team).toMatch(/reportError/);
    const clients = read("src/app/api/staff/clients/route.ts");
    expect(clients).toMatch(/requireCapability\(input\.action === "add_prospect" \? "clients\.add" : "clients\.assign"\)/);
    expect(clients).toMatch(/member\.role === "sales" \? member\.handle/);
    expect(read("src/app/api/billing/refund/route.ts")).toMatch(/requireCapability\("billing\.refund"\)/);
    expect(read("src/app/api/billing/pause/route.ts")).toMatch(/requireCapability\("billing\.pause"\)/);
    const access = read("src/lib/staff/access.ts");
    expect(access).toMatch(/if \(!can\(member\.role, capability\)\)/);
    expect(access).toMatch(/\.from\("staff_members"\)[\s\S]*\.eq\("user_id", auth\.user\.id\)/);
    // Every route that acts for staff checks a capability.
    const staffRoutes = sourceFiles("src/app/api").filter((f) => /getStaffAccess|requireCapability/.test(read(f)));
    for (const route of staffRoutes) expect(read(route), route).toMatch(/requireCapability\(/);
    expect(read("src/app/api/furnishers/route.ts")).toMatch(/requireCapability\("rounds\.send"\)/);
    // team, clients, case, reports, rounds, mail, refund, pause, furnishers, autopilot (holds, opt-outs,
    // settings), AI intake's report and letter uploads, partners, prospects (invited).
    expect(read("src/app/api/staff/autopilot/route.ts")).toMatch(/requireCapability\(CAPABILITY\[input\.action\]\)/);
    expect(read("src/app/api/staff/intake/report/route.ts")).toMatch(/requireCapability\("reports\.import"\)/);
    expect(read("src/app/api/staff/intake/letter/route.ts")).toMatch(/requireCapability\("reports\.import"\)/);
    expect(read("src/app/api/staff/partners/route.ts")).toMatch(/requireCapability\("partners\.manage"\)/);
    expect(read("src/app/api/staff/prospects/route.ts")).toMatch(/requireCapability\("clients\.invite"\)/);
    // Saved answers and AltiBot's drafts (migration 0020): whoever answers clients.
    expect(read("src/app/api/staff/answers/route.ts")).toMatch(/requireCapability\("clients\.reply"\)/);
    expect(read("src/app/api/staff/drafts/route.ts")).toMatch(/requireCapability\("clients\.reply"\)/);
    // The letter editor (letters.edit) and the approved letter texts (case.view).
    expect(read("src/app/api/staff/letters/route.ts")).toMatch(/requireCapability\("letters\.edit"\)/);
    expect(read("src/app/api/staff/letters/approved/route.ts")).toMatch(/requireCapability\("case\.view"\)/);
    // Billing plans, invoices and exports, the evidence pack (migration 0026): administrators.
    expect(read("src/app/api/staff/plans/route.ts")).toMatch(/requireCapability\("billing\.plans"\)/);
    expect(read("src/app/api/staff/billing/route.ts")).toMatch(/requireCapability\("billing\.plans"\)/);
    expect(read("src/app/api/staff/billing/evidence/route.ts")).toMatch(/requireCapability\("billing\.plans"\)/);
    // Household signup (migration 0027): whoever adds leads, for the people they may see.
    expect(read("src/app/api/staff/household/route.ts")).toMatch(/requireCapability\("clients\.add"\)/);
    // Reviews (migration 0029): the sites and ratings for an administrator; a reply draft for whoever answers clients.
    expect(read("src/app/api/staff/reviews/route.ts")).toMatch(/requireCapability\("reviews\.manage"\)/);
    expect(read("src/app/api/staff/reviews/reply/route.ts")).toMatch(/requireCapability\("clients\.reply"\)/);
    // States (migration 0030): opening one is an administrator's.
    expect(read("src/app/api/staff/states/route.ts")).toMatch(/requireCapability\("states\.manage"\)/);
    
    // Partner offers and loan officers accepting new clients (migration 0030): administrators.
    expect(read("src/app/api/staff/offers/route.ts")).toMatch(/requireCapability\("partners\.manage"\)/);
    // Calls with a person (migration 0032, off by default): whoever handles calls (administrators and sales).
    expect(read("src/app/api/staff/calls/route.ts")).toMatch(/requireCapability\("calls\.manage"\)/);
    // Notes with a referral partner about a client (migration 0033): whoever follows up a client.
    expect(read("src/app/api/staff/partner-notes/route.ts")).toMatch(/requireCapability\("clients\.followup"\)/);
    // Credalti Control (migration 0034): the lead inbox and its autopilot switch, phone alerts, the Overview.
    expect(read("src/app/api/staff/leads/route.ts")).toMatch(/requireCapability\("leads\.work"\)/);
    expect(read("src/app/api/staff/leads/autopilot/route.ts")).toMatch(/requireCapability\("autopilot\.manage"\)/);
    expect(read("src/app/api/staff/alerts/route.ts")).toMatch(/requireCapability\("clients\.followup"\)/);
    expect(read("src/app/api/staff/control/route.ts")).toMatch(/requireCapability\("clients\.followup"\)/);
    // Content (migration 0035): the board, files, Alti's assistant and connecting accounts.
    expect(read("src/app/api/staff/content/assist/route.ts")).toMatch(/requireCapability\("content\.edit"\)/);
    // The accounting department (migration 0036): the accounting capability.
    expect(read("src/app/api/staff/accounting/route.ts")).toMatch(/requireCapability\("accounting"\)/);
    expect(read("src/app/api/staff/accounting/receipt/route.ts")).toMatch(/requireCapability\("accounting"\)/);
    // The Ads Manager (migration 0037): the numbers for ads.view, Alti's ad copy and the briefs for ads.draft, by action.
    expect(read("src/app/api/staff/ads/route.ts")).toMatch(/requireCapability\(briefsOnly \? "ads\.draft" : "ads\.view"\)/);
    expect(read("src/app/api/staff/ads/route.ts")).toMatch(/requireCapability\(CAPABILITY\[input\.action\]\)/);
    // SEO (migration 0039): the department (seo.view, each action its own capability), site health (seo.view), Alti's drafts (seo.edit).
    expect(read("src/app/api/staff/seo/route.ts")).toMatch(/requireCapability\("seo\.view"\)/);
    expect(read("src/app/api/staff/seo/route.ts")).toMatch(/requireCapability\(capability\)/);
    expect(read("src/app/api/staff/seo/health/route.ts")).toMatch(/requireCapability\("seo\.view"\)/);
    expect(read("src/app/api/staff/seo/draft/route.ts")).toMatch(/requireCapability\("seo\.edit"\)/);
    // Launch readiness (administrators) and Ideas (everyone adds; ideas.approve decides), migration 0040.
    expect(read("src/app/api/staff/launch/route.ts")).toMatch(/requireCapability\("launch"\)/);
    expect(read("src/app/api/staff/ideas/route.ts")).toMatch(/requireCapability\(capabilityFor\(input\.action\)\)/);
    expect(read("src/app/api/staff/ideas/route.ts")).toMatch(/requireCapability\("ideas\.add"\)/);
    // The Video Studio (migration 0038): the board and actions, files, Alti's draft, automatic captions.
    expect(read("src/app/api/staff/video/route.ts")).toMatch(/requireCapability\(VIDEO_ACTION_CAPABILITY\[input\.action\]\)/);
    expect(read("src/app/api/staff/video/route.ts")).toMatch(/requireCapability\("content\.view"\)/);
    expect(read("src/app/api/staff/video/files/route.ts")).toMatch(/requireCapability\(input\.action === "sign" \? "content\.view" : "content\.edit"\)/);
    expect(read("src/app/api/staff/video/assist/route.ts")).toMatch(/requireCapability\("content\.edit"\)/);
    expect(read("src/app/api/staff/video/transcribe/route.ts")).toMatch(/requireCapability\("content\.edit"\)/);
    // Fulfillment (migration 0041): document review, monitoring checks and commissions, the CRC import.
    expect(read("src/app/api/staff/documents/route.ts")).toMatch(/requireCapability\("documents\.review"\)/);
    expect(read("src/app/api/staff/monitoring/route.ts")).toMatch(/requireCapability\("clients\.followup"\)/);
    expect(read("src/app/api/staff/monitoring/route.ts")).toMatch(/requireCapability\("monitoring\.commissions"\)/);
    expect(read("src/app/api/staff/import/route.ts")).toMatch(/requireCapability\("clients\.import"\)/);
    // The live funnel (migration 0043): report reviews and the personal video (reviews.video), the import (reports.import).
    expect(read("src/app/api/staff/live/route.ts")).toMatch(/requireCapability\("reviews\.video"\)/);
    expect(read("src/app/api/staff/live/route.ts")).toMatch(/requireCapability\(input\.action === "import" \? "reports\.import" : "reviews\.video"\)/);
    // Webinars and the campaign scorecard, and a person in the signup chat (migration 0044).
    expect(read("src/app/api/staff/webinars/route.ts")).toMatch(/requireCapability\(campaigns \? "campaigns\.view" : "webinars\.view"\)/);
    expect(read("src/app/api/staff/webinars/route.ts")).toMatch(/requireCapability\(CAPABILITY\[input\.action\]\)/);
    expect(read("src/app/api/staff/signup-chats/route.ts")).toMatch(/requireCapability\("leads\.work"\)/);
    expect(staffRoutes.length).toBe(54);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// ── The activity log ────────────────────────────────────────────────────

describe("team: the activity log", () => {
  const clients = demo();
  const t = team();
  const byId = (id: string) => clients.find((c) => c.id === id)!;

  it("tells who did what on a client, newest first, from the records alone", () => {
    const ernesto = clientActivity(byId("c10"), t.members);
    expect(ernesto.map((e) => e.at)).toEqual([...ernesto.map((e) => e.at)].sort().reverse());
    expect(ernesto.find((e) => e.type === "refunded")).toMatchObject({ actor: "carmen", text: "Carmen Ruiz devolvió el cobro de la ronda 1 de Ernesto Villaseñor ($89.00)" });
    expect(ernesto.find((e) => e.type === "round_sent")).toMatchObject({ actor: "carmen" });
    expect(ernesto.find((e) => e.type === "signed")).toMatchObject({ actor: "client" });
    expect(ernesto.find((e) => e.type === "lead")).toMatchObject({ actor: "carmen", text: "Carmen Ruiz empezó la conversación con Ernesto Villaseñor" });
    const samuel = clientActivity(byId("c14"), t.members);
    // A reply keeps the name it was signed with; it is matched to the teammate.
    expect(samuel.find((e) => e.type === "replied")).toMatchObject({ actor: "carmen" });
    const graciela = clientActivity(byId("c11"), t.members).filter((e) => e.type === "assigned");
    expect(graciela.map((e) => e.text)).toEqual(["Carmen Ruiz tomó el caso de Graciela Montoya", "El sistema asignó el caso de Graciela Montoya a Marta Leal (por turno)"]);
    const auto = clientActivity(byId("c17"), t.members).find((e) => e.type === "assigned")!;
    expect(auto).toMatchObject({ actor: "system", text: "El sistema asignó el caso de Estela Coronado a Marta Leal (por turno)" });
  });

  it("puts the team's changes in the global feed, and filters by person, client and type", () => {
    const feed = activityFeed(clients, t.members, t.events);
    expect(feed.map((e) => e.at)).toEqual([...feed.map((e) => e.at)].sort().reverse());
    expect(new Set(feed.map((e) => e.id)).size).toBe(feed.length);
    expect(new Set(feed.map((e) => e.type))).toEqual(new Set(ACTIVITY_TYPES.filter((type) => type !== "billing_paused")));
    expect(filterActivity(feed, { type: "team" })).toHaveLength(t.events.length);
    expect(filterActivity(feed, { actor: "marta", type: "round_sent" }).every((e) => e.text.startsWith("Marta Leal envió la ronda"))).toBe(true);
    expect(filterActivity(feed, { clientId: "c10" })).toEqual(clientActivity(byId("c10"), t.members));
    expect(teamActivity(t.events, t.members)[0]!.text).toBe("Carmen Ruiz activó la asignación automática de clientes nuevos");
  });

  it("a teammate's actions in the demo show up with their name", () => {
    const after = applyTeamActions(applyDemoActions(clients, { ...EMPTY_ACTIONS, sent: { c07: { "1": later.toISOString() } } }), {
      ...EMPTY_TEAM_ACTIONS,
      sentBy: { c07: { "1": "carmen" } },
    });
    const entries = clientActivity(after.find((c) => c.id === "c07")!, t.members);
    expect(entries[0]).toMatchObject({ type: "round_sent", actor: "carmen", at: later.toISOString() });
  });

  it("matches a recorded name to a teammate, and keeps anything else as recorded", () => {
    expect(actorHandle(t.members, "Carmen")).toBe("carmen");
    expect(actorHandle(t.members, "marta")).toBe("marta");
    expect(actorHandle(t.members, "equipo")).toBe("equipo");
    expect(actorHandle(t.members, "")).toBe("equipo");
    expect(actorHandle(t.members, "sistema")).toBe("system");
    expect(actorHandle(t.members, "Rocío")).toBe("rocío");
  });

  it("every line passes the claim rules", () => {
    for (const entry of activityFeed(clients, t.members, t.events)) expect(checkClaimGuardrails(entry.text), entry.text).toEqual([]);
  });
});

// ── Business metrics ────────────────────────────────────────────────────

/** A client with `rounds` mailed every 40 days, the first `firstDaysAgo` days ago, all paid. */
function worked(id: string, overrides: Partial<StaffClient>, rounds: Array<{ mailed: number; responded?: number; results?: number }> = []): StaffClient {
  const letters = (n: number) =>
    Array.from({ length: 2 }, (_, i) => ({
      id: `${id}-r${n}-l${i}`,
      recipient: { type: "bureau" as const, key: "equifax", name: "Equifax", addressLines: [] },
      templateKey: "x",
      category: "tradeline" as const,
      stage: "dispute" as const,
      items: [{ fingerprint: `${id}-fp${n}-${i}` }, { fingerprint: `${id}-shared` }] as never,
      mailStatus: "delivered" as const,
    }));
  const built: StaffRound[] = rounds.map((r, i) => ({
    number: i + 1,
    status: r.responded !== undefined ? "responded" : "mailed",
    mailedAt: ago(r.mailed),
    respondedAt: r.responded !== undefined ? ago(r.responded) : null,
    letters: letters(i + 1),
    ...(r.results ? { results: Array.from({ length: r.results }, (_, k) => ({ fingerprint: `${id}-fp${i + 1}-${k}`, outcome: "removed" as const, reportDate: ago(r.responded!) })) } : {}),
  }));
  const base: StaffClient = {
    id,
    firstName: "Prueba",
    lastName: id,
    phone: "+17135550100",
    state: "TX",
    addressLines: [],
    salesperson: "ana",
    createdAt: ago(200),
    signedUpAt: ago(199),
    agreementSignedAt: ago(198),
    documents: ["government_id", "proof_of_address"],
    report: null,
    answers: {},
    rounds: built,
    agreementMonthlyFee: "89.00",
    billing: NO_BILLING,
    lastActivityAt: ago(1),
    notes: [],
    questions: [],
    handled: {},
    ...overrides,
  };
  return overrides.billing ? base : { ...base, billing: paidUpBilling(base, "89.00", NOW) };
}

describe("team: business metrics", () => {
  it("periods are this month on the Texas calendar, the last 30 and 90 days, or everything", () => {
    expect(periodRange("month", NOW).from!.toISOString()).toBe("2026-12-01T06:00:00.000Z");
    // In daylight time, midnight in Texas is 05:00 UTC.
    expect(startOfTexasMonth(2026, 7).toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(periodRange("30d", NOW).from!.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(periodRange("90d", NOW).from!.getTime()).toBe(NOW.getTime() - 90 * DAY);
    expect(periodRange("all", NOW)).toEqual({ from: null, to: NOW });
    expect(inRange(ago(10), periodRange("30d", NOW))).toBe(true);
    expect(inRange(ago(31), periodRange("30d", NOW))).toBe(false);
    expect(inRange(null, periodRange("all", NOW))).toBe(false);
    expect(PERIODS).toEqual(["month", "30d", "90d", "all"]);
  });

  it("counts clients: leads, signatures, cancellations, conversion and churn in the window; active, paused and ended today", () => {
    const clients = [
      worked("a", { createdAt: ago(20), signedUpAt: ago(19), agreementSignedAt: ago(18) }),
      worked("b", { createdAt: ago(25), signedUpAt: null, agreementSignedAt: null }),
      worked("c", { createdAt: ago(10), signedUpAt: ago(9), agreementSignedAt: ago(8), agreementCancelledAt: ago(7), cancelledWithinWindow: true }),
      worked("d", { createdAt: ago(100), serviceEndRequestedAt: ago(5) }),
      worked("e", { createdAt: ago(200) }),
    ];
    const m = businessMetrics(clients, team().members, "30d", NOW);
    expect(m.clients).toMatchObject({ newLeads: 3, signed: 2, cancelled: 1, active: 2, ended: 2 });
    expect(m.clients.conversion).toBeCloseTo(2 / 3);
    // In force during the window: a, c, d, e. Stopped in it: c and d.
    expect(m.clients.churn).toBeCloseTo(2 / 4);
    expect(endedAt(clients[3]!)).toBe(ago(5));
    expect(isActiveClient(clients[3]!, NOW)).toBe(false);
    expect(businessMetrics([], [], "30d", NOW).clients).toMatchObject({ conversion: null, churn: null, newLeads: 0 });
  });

  it("counts the work: rounds, letters, distinct items, the days to the first round, and who is behind the 40-day cycle", () => {
    const clients = [
      worked("a", { agreementSignedAt: ago(60) }, [{ mailed: 50, responded: 18, results: 1 }, { mailed: 10 }]),
      worked("b", { agreementSignedAt: ago(70) }, [{ mailed: 55, responded: 24, results: 2 }]),
      worked("c", { agreementSignedAt: ago(30) }),
    ];
    const m = businessMetrics(clients, team().members, "30d", NOW);
    expect(m.work).toMatchObject({ roundsMailed: 1, lettersMailed: 2, itemsDisputed: 3, itemsNoLongerReported: 3, daysToFirstRound: null, roundsOverdue: 1, inCycle: 2 });
    const all = businessMetrics(clients, team().members, "all", NOW);
    expect(all.work).toMatchObject({ roundsMailed: 3, lettersMailed: 6, daysToFirstRound: 12.5 });
    expect(behindCycle(clients[1]!, NOW)).toBe(true);
    expect(behindCycle(clients[0]!, NOW)).toBe(false);
  });

  it("counts only what a report showed: no removal without a recorded result", () => {
    // Responded rounds with no RoundResult on record count nothing, whatever else is true.
    const clients = [worked("a", {}, [{ mailed: 50, responded: 18 }])];
    expect(businessMetrics(clients, [], "all", NOW).work.itemsNoLongerReported).toBe(0);
    const source = readFileSync("src/lib/staff/metrics.ts", "utf8");
    expect(source).toMatch(/r\.outcome === "removed"/);
  });

  it("counts money from the billing records: charged, refunded, net, failed, recovered and what the system has scheduled", () => {
    const declined: BillingCharge = {
      id: "f-ch1", roundNumber: 1, amountCents: 8900, status: "failed", workDate: ago(4), createdAt: ago(3), attempts: 1,
      lastAttemptAt: ago(3), nextAttemptAt: new Date(NOW.getTime() + DAY).toISOString(), chargedAt: null, failureCode: "card_declined", refund: null,
    };
    const paid = worked("p", {}, [{ mailed: 50, responded: 18 }, { mailed: 10 }]);
    const refundedCharge: BillingCharge = { ...paid.billing.charges[1]!, status: "refunded", refund: { id: "r", amountCents: 8900, reason: "x", by: "carmen", at: ago(2), completedAt: ago(2) } };
    const recovered: BillingCharge = { ...paid.billing.charges[0]!, attempts: 2 };
    const clients = [
      { ...paid, billing: { ...paid.billing, charges: [recovered, refundedCharge] } },
      worked("f", { billing: { paymentMethod: sampleMethod(ago(10)), charges: [declined], pause: null } }, [{ mailed: 4 }]),
      // Mailed today: the system charges it tomorrow.
      worked("s", { billing: { paymentMethod: sampleMethod(ago(10)), charges: [], pause: null } }, [{ mailed: 0 }]),
    ];
    const m = businessMetrics(clients, [], "all", NOW).money;
    expect(m).toMatchObject({ chargedCents: 17800, refundedCents: 8900, netCents: 8900, failedCount: 1, failedCents: 8900, recoveredCount: 1, scheduledCount: 2, scheduledCents: 17800 });
    expect(m.revenuePerActiveCents).toBe(Math.round(8900 / 3));
    const month = businessMetrics(clients, [], "30d", NOW).money;
    expect(month).toMatchObject({ chargedCents: 8900, refundedCents: 8900, netCents: 0, recoveredCount: 0 });
  });

  it("per teammate: clients, rounds sent, replies and open notices; per salesperson: leads, signed, cancelled", () => {
    const clients = demo();
    const m = businessMetrics(clients, team().members, "all", NOW);
    const marta = m.team.find((r) => r.handle === "marta")!;
    expect(marta.assigned).toBe(clients.filter((c) => c.assignedTo === "marta" && !endedAt(c)).length);
    expect(marta.roundsSent).toBe(clients.flatMap((c) => c.rounds).filter((r) => r.mailedAt && r.sentBy === "marta").length);
    expect(marta.replies).toBe(2);
    expect(m.team.find((r) => r.handle === "carmen")!.replies).toBe(1);
    expect(m.team.map((r) => r.handle).sort()).toEqual(["ana", "carmen", "luis", "marta"]);
    const ana = m.sales.find((r) => r.handle === "ana")!;
    expect(ana.invites).toBe(clients.filter((c) => c.salesperson === "ana").length);
    expect(ana.cancelled).toBe(clients.filter((c) => c.salesperson === "ana" && c.agreementCancelledAt).length);
    expect(m.sales.reduce((n, r) => n + r.invites, 0)).toBe(clients.length);
  });

  it("the demo shows months of history with numbers worth reading", () => {
    const clients = demo();
    const all = businessMetrics(clients, team().members, "all", NOW);
    expect(all.work.roundsMailed).toBeGreaterThan(25);
    expect(all.work.itemsNoLongerReported).toBeGreaterThan(5);
    expect(all.money.chargedCents).toBeGreaterThan(all.money.refundedCents);
    expect(all.money.recoveredCount).toBeGreaterThan(0);
    expect(all.clients.cancelled).toBeGreaterThan(1);
    expect(all.work.roundsOverdue).toBeGreaterThan(0);
    const series = monthlySeries(clients, NOW, 6);
    expect(series.map((p) => p.key)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(series.filter((p) => p.roundsMailed > 0).length).toBeGreaterThanOrEqual(5);
    // The months add up to the period they cover.
    const sinceJuly = clients.flatMap((c) => c.rounds).filter((r) => r.mailedAt && r.mailedAt >= startOfTexasMonth(2026, 7).toISOString()).length;
    expect(series.reduce((n, p) => n + p.roundsMailed, 0)).toBe(sinceJuly);
    expect(formatPercent(0.666)).toBe("67%");
    expect(formatPercent(null)).toBe("—");
  });

  it("every number has a written definition, and none claims a result or a success rate", () => {
    for (const [key, info] of Object.entries(METRIC_INFOS.es)) {
      expect(info.label.length, key).toBeGreaterThan(3);
      expect(info.definition.length, key).toBeGreaterThan(30);
      for (const text of [info.label, info.definition]) {
        expect(checkClaimGuardrails(text), text).toEqual([]);
        expect(text, text).not.toMatch(/éxito|exito|success|puntaje|score|puntos ganados|eliminad|borrad|removed|tasa de/i);
      }
    }
    expect(METRIC_INFOS.es.itemsNoLongerReported.label).toBe("Puntos que ya no aparecen en el reporte");
    const page = readFileSync("src/app/equipo/negocio/page.tsx", "utf8");
    expect(page).not.toMatch(/éxito|success|puntaje|eliminad/i);
    expect(page).toMatch(/<Definition /);
  });
});

// ── The clients list ────────────────────────────────────────────────────

describe("team: the clients list", () => {
  const clients = demo();
  const t = team();
  const byId = (id: string) => clients.find((c) => c.id === id)!;

  it("reads each client's money as one state", () => {
    expect(billingState(byId("c20"), later)).toBe("current");
    expect(billingState(byId("c22"), later)).toBe("retrying");
    expect(billingState(byId("c15"), later)).toBe("past_due");
    expect(billingState(byId("c23"), later)).toBe("method_missing");
    expect(billingState(byId("c01"), later)).toBe("none");
    expect(billingState({ ...byId("c20"), billing: { ...byId("c20").billing, pause: { at: ago(1), by: "carmen", reason: "Motivo" } } }, later)).toBe("paused_by_team");
  });

  it("filters by stage, notice, who works it, who brought them, money, state and 'mine'", () => {
    const rows = clientRows(clients, ADMIN, later);
    const ids = (f: Parameters<typeof filterRows>[1]) => filterRows(rows, f, ADMIN).map((r) => r.client.id);
    expect(ids({ stage: "ready_to_send" })).toEqual(clients.filter((c) => clientStage(c, later) === "ready_to_send").map((c) => c.id));
    expect(ids({ assigned: "none" }).sort()).toEqual(["c01", "c02", "c03", "c04", "c31", "c32", "c35"]);
    expect(ids({ assigned: "carmen" }).every((id) => byId(id).assignedTo === "carmen")).toBe(true);
    expect(ids({ seller: "luis" }).every((id) => byId(id).salesperson === "luis")).toBe(true);
    expect(ids({ billing: "past_due" })).toEqual(["c15"]);
    expect(ids({ notice: "any" }).length).toBe(clients.filter((c) => clientExceptions(c, later).length > 0).length);
    expect(ids({ notice: "letter_returned" })).toEqual(["c11"]);
    expect(ids({ state: "TX" })).toHaveLength(clients.length);
    expect(ids({ state: "CA" })).toEqual([]);
    expect(ids({ query: "solis" })).toEqual(["c12"]);
    expect(ids({ query: "555-0124" })).toEqual(["c24"]);
    expect(ids({ mine: true }).every((id) => byId(id).assignedTo === "carmen" || byId(id).salesperson === "carmen")).toBe(true);
    expect(ids({ assigned: "marta", stage: "waiting_on_bureaus", billing: "current" }).length).toBeGreaterThan(3);
  });

  it("sales does not see notices about the work, or money in what comes next or in the history", () => {
    const rows = clientRows(visibleClients(SALES, clients), SALES, later);
    for (const row of rows) {
      for (const e of row.exceptions) expect(["agreement_unsigned", "documents_missing"]).toContain(e.kind);
      expect(row.step.text, row.client.id).not.toMatch(/cobr|pago/i);
    }
    // Joaquín's next step is a charge; sales reads the work's next step instead.
    const joaquin = byId("c21");
    expect(nextStepFor(joaquin, later, ADMIN).text).toMatch(/^Cobrar la ronda 1/);
    expect(nextStepFor(joaquin, later, SALES).text).toMatch(/^Re-importar el reporte/);
    expect(nextStepFor(byId("c15"), later, SALES)).toEqual({ actor: "staff", text: "El equipo lo está atendiendo", at: null });
    const history = historyFor(clientTimeline(byId("c20"), later), SALES).map((e) => e.text).join("\n");
    expect(history).not.toMatch(/cobr|\$|método de pago/i);
    expect(historyFor(clientTimeline(byId("c20"), later), ADMIN).some((e) => /Se cobró/.test(e.text))).toBe(true);
  });

  it("exports the visible columns with nothing sensitive, and never as a spreadsheet formula", () => {
    const rows = clientRows(clients.slice(0, 5), ADMIN, later);
    const csv = clientsCsv(rows, t.members);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
    expect(lines[1]).toMatch(/^"Mariana Robles","Texas","Prospecto",/);
    expect(csv).not.toMatch(/555|\+1|@|Calle|\$|Visa|ssn/i);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("Ana")).toBe(`"Ana"`);
  });

  it("the list sends ready rounds through the same send the home screen uses", () => {
    const page = readFileSync("src/app/equipo/clientes/page.tsx", "utf8");
    expect(page).toMatch(/await data\.markRoundsSent\(readyToSend\)/);
    expect(page).toMatch(/sendableRound\(r\.client, now\)/);
    expect(page).not.toMatch(/sent\[|mailedAt:/);
    // And the guarded data is what useStaff hands every page.
    expect(readFileSync("src/lib/staff/useStaff.ts", "utf8")).toMatch(/guardStaffData\(raw, viewer/);
    // c72: the letters a Credalti DIY client asked us to mail.
    expect(clients.filter((c) => sendableRound(c, later)).map((c) => c.id)).toEqual(["c07", "c08", "c14", "c72"]);
  });
});

// ── Wording ─────────────────────────────────────────────────────────────

describe("team: wording", () => {
  const files = [
    "src/lib/staff/permissions.ts",
    "src/lib/staff/team.ts",
    "src/lib/staff/activity.ts",
    "src/lib/staff/metrics.ts",
    "src/lib/staff/clientList.ts",
    "src/app/equipo/equipo/page.tsx",
    "src/app/equipo/negocio/page.tsx",
    "src/app/equipo/actividad/page.tsx",
    "src/app/equipo/clientes/page.tsx",
    "src/components/staff/AddClient.tsx",
    "src/components/staff/AssignmentCard.tsx",
    "src/components/staff/StaffShell.tsx",
  ];

  it("keeps the house rules: no old names, rounds are not attacks", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/CreditCapi|ataque/i);
    }
  });

  it("the role descriptions and labels promise nothing", () => {
    for (const text of [...Object.values(ROLE_SUMMARIES.es), ...Object.values(CAPABILITY_LABELS.es), ...Object.values(ROLE_LABELS.es)]) {
      expect(checkClaimGuardrails(text), text).toEqual([]);
    }
  });

  it("labels the role switcher as demo-only", () => {
    const shell = readFileSync("src/components/staff/StaffShell.tsx", "utf8");
    const text = readFileSync("src/lib/staff/i18n/ui/shell.ts", "utf8");
    expect(text).toMatch(/Solo en la demo · Ver como/);
    expect(text).toMatch(/Demo only · View as/);
    expect(shell).toMatch(/\{t\.viewAsLabel\}/);
    expect(shell).toMatch(/\{demo && viewer && \(/);
  });
});

describe("team: migration 0012", () => {
  const migration = readFileSync("supabase/migrations/0012_team.sql", "utf8");
  const sql = migration.replace(/--.*$/gm, "");

  it("gives staff read policies only, scoped by role, and nothing to clients", () => {
    const policies = sql.match(/create policy[^;]+;/g) ?? [];
    expect(policies.length).toBeGreaterThan(20);
    for (const policy of policies) {
      expect(policy).toMatch(/for select using/);
      expect(policy).not.toMatch(/for (all|insert|update|delete)|with check/);
    }
    // Every policy dropped is recreated under the same name, scoped.
    const dropped = [...sql.matchAll(/drop policy "([^"]+)" on (public\.\w+)/g)].map((m) => `${m[1]}|${m[2]}`);
    const created = [...sql.matchAll(/create policy "([^"]+)" on (public\.\w+)/g)].map((m) => `${m[1]}|${m[2]}`);
    expect(dropped.length).toBe(16);
    for (const d of dropped) expect(created).toContain(d);
    for (const table of ["profiles", "report_pulls", "item_flags", "letters", "chat_messages", "charges", "refunds", "service_agreements"]) {
      const policy = policies.find((p) => p.includes(`"staff read`) && p.includes(`on public.${table}\n`))!;
      expect(policy, table).toMatch(/staff_can_see_(client|case|billing)/);
    }
  });

  it("never deletes a member, keeps the deactivation date in step, and keeps an audit nobody can change", () => {
    expect(sql).toMatch(/create trigger staff_members_no_delete\s+before delete on public\.staff_members/);
    expect(sql).toMatch(/create trigger staff_members_track_active\s+before insert or update on public\.staff_members/);
    expect(sql).toMatch(/create trigger team_audit_append_only\s+before update or delete on public\.team_audit/);
    for (const table of ["staff_invitations", "client_assignments", "team_settings", "prospects", "team_audit"]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
    expect(sql).not.toMatch(/\b(ssn|date_of_birth|dob|birth)\b/i);
    expect(readFileSync("supabase/setup.sql", "utf8")).toContain("-- ===== 0012_team.sql =====");
  });
});
