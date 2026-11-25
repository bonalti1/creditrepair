import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { ALTI_RUNS_PER_DAY, ALTI_SYSTEM, altiUserMessage, askAlti, checkProposals, MAX_PROPOSALS, PROPOSALS_SCHEMA, type AltiCaller } from "../ideas/alti";
import { proposalWordsProblems, similarTitles, titleOverlap } from "../ideas/check";
import { SAMPLE_PROPOSALS, seedDemoIdeas } from "../ideas/demo";
import { actionRefusal, applyAction, capabilityFor, ideasBodySchema, isLearning, searchLearnings, testDaysLeft, testIsDue, TRANSITIONS } from "../ideas/rules";
import { basedOnFrom, collectSignals, IDEA_METRIC_LABELS, IDEA_METRICS, isIdeaMetric, OTHER_METRIC, SIGNAL_SOURCES, type SignalSource } from "../ideas/signals";
import { IDEAS_TEXT } from "../ideas/text";
import { IDEA_DEPARTMENTS, IDEA_STATUSES, type Idea } from "../ideas/types";
import { buildDemoLeads } from "../leads/demo";
import { buildDemoClients } from "../staff/demoClients";
import { altiJobs, searchPlaybook, ALTI_HELP_TEXT } from "../staff/altiHelp";
import { NAV_GROUPS, MORE_NAV } from "../staff/nav";
import { can, deniedReason, STAFF_ROLES, type Capability } from "../staff/permissions";
import { SCREEN_HELPS } from "../staff/playbook";

// Ideas and experiments (docs/IDEAS.md): who may do what to an idea, the
// order of its statuses, the numbers Alti reads, and the checks every one of
// Alti's proposals passes before anyone sees it.

const NOW = new Date("2026-11-25T15:00:00.000Z");
const idea = (status: Idea["status"], createdBy = "u-ana"): Idea => ({
  ...seedDemoIdeas(NOW).ideas[0]!,
  id: `i-${status}`,
  status,
  createdBy,
});

describe("who may do what", () => {
  it("everyone sees and adds ideas; only an administrator approves and decides", () => {
    for (const role of STAFF_ROLES) expect(can(role, "ideas.add"), role).toBe(true);
    expect(STAFF_ROLES.filter((r) => can(r, "ideas.approve"))).toEqual(["admin"]);
    expect(deniedReason("ideas.approve", "en")).toMatch(/^Only an administrator can approve ideas/);
    expect(capabilityFor("add")).toBe("ideas.add");
    expect(capabilityFor("edit")).toBe("ideas.add");
    for (const a of ["approve", "decline", "start", "keep", "drop", "ask_alti", "add_proposal", "dismiss_proposal"] as const) expect(capabilityFor(a)).toBe("ideas.approve");
  });

  it("the statuses go New → Approved → Testing → Kept or Dropped; Not now from New or Approved; final ones stay", () => {
    expect(TRANSITIONS).toEqual({
      approve: { from: ["new"], to: "approved" },
      decline: { from: ["new", "approved"], to: "declined" },
      start: { from: ["approved"], to: "testing" },
      keep: { from: ["testing"], to: "kept" },
      drop: { from: ["testing"], to: "dropped" },
    });
    const admin = { role: "admin" as const, userId: "u-carmen" };
    for (const status of IDEA_STATUSES) {
      for (const [action, rule] of Object.entries(TRANSITIONS)) {
        const refusal = actionRefusal(action as keyof typeof TRANSITIONS, idea(status), admin);
        expect(refusal, `${action} from ${status}`).toBe(rule.from.includes(status) ? null : "status");
      }
    }
  });

  it("a specialist or salesperson cannot approve, start or decide; they edit only their own new idea", () => {
    for (const role of ["specialist", "sales"] as const) {
      for (const action of ["approve", "decline", "start", "keep", "drop"] as const) {
        expect(actionRefusal(action, idea(action === "start" ? "approved" : action === "keep" || action === "drop" ? "testing" : "new"), { role, userId: "u-ana" })).toBe("role");
      }
      expect(actionRefusal("edit", idea("new", "u-ana"), { role, userId: "u-ana" })).toBeNull();
      expect(actionRefusal("edit", idea("new", "u-luis"), { role, userId: "u-ana" })).toBe("not_author");
      expect(actionRefusal("edit", idea("approved", "u-ana"), { role, userId: "u-ana" })).toBe("status");
    }
    expect(actionRefusal("edit", idea("new", "u-luis"), { role: "admin", userId: "u-carmen" })).toBeNull();
    expect(actionRefusal("approve", idea("new"), { role: null, userId: null })).toBe("role");
  });

  it("each action writes what it should, and a test's days count down", () => {
    const started = applyAction(idea("approved"), { action: "start", id: "x", testDays: 14 }, "Carmen Ruiz", NOW);
    expect(started).toMatchObject({ status: "testing", testDays: 14, testStartedAt: NOW.toISOString() });
    expect(testDaysLeft(started, NOW)).toBe(14);
    expect(testIsDue(started, new Date(NOW.getTime() + 15 * 86_400_000))).toBe(true);
    const kept = applyAction(started, { action: "keep", id: "x", learned: "Replies went faster and more leads answered." }, "Carmen Ruiz", NOW);
    expect(kept).toMatchObject({ status: "kept", decidedByName: "Carmen Ruiz", resultNote: "Replies went faster and more leads answered." });
    expect(isLearning(kept)).toBe(true);
    expect(applyAction(idea("new"), { action: "approve", id: "x" }, "Carmen Ruiz", NOW)).toMatchObject({ status: "approved", approvedByName: "Carmen Ruiz" });
    expect(applyAction(idea("new"), { action: "decline", id: "x", note: "Pressure tactic" }, "Carmen Ruiz", NOW)).toMatchObject({ status: "declined", resultNote: "Pressure tactic" });
  });

  it("the route's body is strict: a learning is required to decide, a test length is 7 to 90 days, a metric from the list", () => {
    const words = { title: "Faster replies", why: "Leads wait too long for the first reply.", department: "leads", metric: "lead_first_reply", expectedEffect: "Goes down", effort: "S" };
    expect(ideasBodySchema.safeParse({ action: "add", ...words }).success).toBe(true);
    expect(ideasBodySchema.safeParse({ action: "add", ...words, status: "kept" }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "add", ...words, metric: "made_up" }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "add", ...words, department: "georgia" }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "keep", id: "x", learned: "ok" }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "keep", id: "x", learned: "It worked well for two weeks." }).success).toBe(true);
    expect(ideasBodySchema.safeParse({ action: "start", id: "x", testDays: 3 }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "start", id: "x", testDays: 91 }).success).toBe(false);
    expect(ideasBodySchema.safeParse({ action: "start", id: "x", testDays: 30 }).success).toBe(true);
  });

  it("the departments are the migration's", () => {
    const sql = readFileSync("supabase/migrations/0040_ideas_launch.sql", "utf8");
    const list = IDEA_DEPARTMENTS.map((d) => `'${d}'`).join(", ");
    expect(sql).toContain(`department in (${list})`);
    for (const status of IDEA_STATUSES) expect(sql).toContain(`'${status}'`);
  });
});

describe("the numbers ideas name, and Alti reads", () => {
  const clients = buildDemoClients(NOW);
  const leads = buildDemoLeads(NOW);

  it("every metric has a name in both languages, and an idea may name only those (or «other»)", () => {
    for (const key of [...Object.keys(IDEA_METRICS), OTHER_METRIC]) {
      expect(IDEA_METRIC_LABELS.en[key], key).toBeTruthy();
      expect(IDEA_METRIC_LABELS.es[key], key).toBeTruthy();
      expect(isIdeaMetric(key)).toBe(true);
    }
    expect(isIdeaMetric("nope")).toBe(false);
  });

  it("are read from the same code as the dashboard, the lead inbox and the content summary; nothing read is no data, never a zero", () => {
    const signals = collectSignals({ clients, leads, content: null, now: NOW });
    expect(signals.length).toBe(Object.keys(IDEA_METRICS).length);
    expect(signals.find((s) => s.key === "active_clients")!.value).toBeGreaterThan(0);
    expect(signals.find((s) => s.key === "leads_week")!.value).not.toBeNull();
    for (const s of signals.filter((x) => x.source === "content")) expect(s.value, s.key).toBeNull();
    const none = collectSignals({ clients: null, leads: null, content: null, now: NOW });
    expect(none.every((s) => s.value === null && s.display === "no data")).toBe(true);
  });

  it("is extensible: a later department adds a source; a source that throws gives no data, not an error", () => {
    const ads: SignalSource = { id: "ads", metrics: { ad_spend: { unit: "cents", window: "30d", better: "down" } }, labels: { en: { ad_spend: "Ad spend" }, es: { ad_spend: "Gasto en anuncios" } }, collect: ({ extra }) => ({ ad_spend: (extra?.ads as { spend: number } | undefined)?.spend ?? null }) };
    const broken: SignalSource = { ...ads, id: "broken", metrics: { broken_metric: { unit: "count", window: "now", better: "up" } }, collect: () => { throw new Error("nope"); } };
    const signals = collectSignals({ clients: null, leads: null, content: null, now: NOW, extra: { ads: { spend: 125_000 } } }, [...SIGNAL_SOURCES, ads, broken]);
    expect(signals.find((s) => s.key === "ad_spend")).toMatchObject({ value: 125_000, display: "$1,250" });
    expect(signals.find((s) => s.key === "broken_metric")!.value).toBeNull();
  });

  it("what Alti is sent is aggregates only: no client's or teammate's name, phone or email", () => {
    const message = altiUserMessage(collectSignals({ clients, leads, content: null, now: NOW }), ["Faster replies"]);
    for (const c of clients.slice(0, 20)) {
      expect(message).not.toContain(`${c.firstName} ${c.lastName}`);
      if (c.phone) expect(message).not.toContain(c.phone);
    }
    for (const l of leads.slice(0, 10)) expect(message).not.toContain(l.phone);
    expect(message).not.toMatch(/@/);
  });
});

describe("Alti's proposals", () => {
  const signals = collectSignals({ clients: buildDemoClients(NOW), leads: buildDemoLeads(NOW), content: null, now: NOW });
  const good = {
    title: "Reply to every waiting lead before the end of the day",
    why: "Many leads wait hours for a person's first reply. A second person on the inbox in the afternoon may help.",
    department: "leads",
    metric: "lead_first_reply",
    expectedEffect: "The median first reply goes down",
    effort: "S",
    testDays: 14,
    basedOn: ["lead_first_reply", "leads_week", "not_a_metric"],
  };

  it("keeps a good proposal, with its numbers filled in from the console's snapshot, not from the model", () => {
    const { proposals, dropped } = checkProposals({ proposals: [good] }, signals, []);
    expect(dropped).toBe(0);
    expect(proposals).toHaveLength(1);
    const leadsWeek = signals.find((s) => s.key === "leads_week")!;
    expect(proposals[0]!.basedOn.find((b) => b.key === "leads_week")).toEqual({ key: "leads_week", value: leadsWeek.value, unit: "count", display: leadsWeek.display });
    expect(proposals[0]!.basedOn.map((b) => b.key)).not.toContain("not_a_metric");
  });

  it("drops a proposal that types a number, promises a result, says free, pushes, uses SMS, or sells outside Texas", () => {
    const bad = [
      { ...good, title: "Reply within 15 minutes" },
      { ...good, title: "Guarantee removal of negative items for clients" },
      { ...good, why: "Offer a free consultation to every lead who writes in." },
      { ...good, why: "Add a countdown so leads act now before the offer ends." },
      { ...good, why: "Send leads an SMS reminder the next morning." },
      { ...good, title: "Open the business in Georgia and Florida" },
      { ...good, why: "We remove negative items faster than anyone else does." },
    ];
    const { proposals, dropped } = checkProposals({ proposals: bad }, signals, []);
    expect(proposals).toEqual([]);
    expect(dropped).toBe(bad.length);
  });

  it("drops an unknown metric, no cited number, a test length out of range, a repeat; keeps at most five", () => {
    expect(checkProposals({ proposals: [{ ...good, metric: "happiness" }] }, signals, []).proposals).toEqual([]);
    expect(checkProposals({ proposals: [{ ...good, basedOn: ["content_failed"] }] }, signals, []).proposals).toEqual([]);
    expect(checkProposals({ proposals: [{ ...good, testDays: 3 }] }, signals, []).proposals).toEqual([]);
    expect(checkProposals({ proposals: [{ ...good, testDays: 120 }] }, signals, []).proposals).toEqual([]);
    expect(checkProposals({ proposals: [good] }, signals, ["Reply to every waiting lead before the day ends"]).proposals).toEqual([]);
    const many = ["leads", "clients", "money", "content", "support", "partners", "tech"].map((d, i) => ({ ...good, department: d, title: ["Shorter inbox shifts", "Document checklist message", "Bank debit first", "Weekly answer video", "Halfway status note", "Partner welcome kit", "Faster import screen"][i]! }));
    const out = checkProposals({ proposals: many }, signals, []);
    expect(out.proposals).toHaveLength(MAX_PROPOSALS);
    expect(out.dropped).toBe(2);
    expect(checkProposals("not json", signals, [])).toEqual({ proposals: [], dropped: 0 });
  });

  it("without a key, Alti is not asked; with one, nothing is acted on: proposals come back to be decided", async () => {
    expect(await askAlti(null, signals, [])).toEqual({ ok: false, problem: "not_connected", dropped: 0, model: null });
    let sent: { system: string; user: string } | null = null;
    const caller: AltiCaller = async (input) => {
      sent = input;
      return { output: { proposals: [good] }, problem: null, model: "claude-opus-5-5" };
    };
    const result = await askAlti(caller, signals, []);
    expect(result).toMatchObject({ ok: true, model: "claude-opus-5-5" });
    expect(sent!.system).toBe(ALTI_SYSTEM);
    const refused: AltiCaller = async () => ({ output: null, problem: "refusal" });
    expect(await askAlti(refused, signals, [])).toMatchObject({ ok: false, problem: "refusal" });
    const allBad: AltiCaller = async () => ({ output: { proposals: [{ ...good, title: "Reply within 15 minutes" }] }, problem: null });
    expect(await askAlti(allBad, signals, [])).toMatchObject({ ok: false, problem: "no_valid_proposals", dropped: 1 });
    expect(ALTI_RUNS_PER_DAY).toBeGreaterThan(0);
  });

  it("the structured output allows only the departments and efforts there are", () => {
    const item = PROPOSALS_SCHEMA.properties.proposals.items;
    expect(item.properties.department.enum).toEqual([...IDEA_DEPARTMENTS]);
    expect(item.additionalProperties).toBe(false);
  });

  it("the demo's sample proposals pass every check, and cite only known metrics", () => {
    for (const p of SAMPLE_PROPOSALS) {
      expect(proposalWordsProblems([p.title, p.why, p.expectedEffect].join("\n")), p.title).toEqual([]);
      expect(Object.hasOwn(IDEA_METRICS, p.metric)).toBe(true);
      for (const b of p.basedOn) expect(Object.hasOwn(IDEA_METRICS, b.key), b.key).toBe(true);
    }
    expect(basedOnFrom(["x"], [])).toEqual([]);
  });

  it("the model call is server-only, structured, with the refusal fallback, and logs no key", () => {
    const source = readFileSync("src/lib/ideas/altiModel.ts", "utf8");
    expect(source).toMatch(/json_schema/);
    expect(source).toMatch(/fallbacks: "default"/);
    expect(source).toMatch(/claude-opus-5-5/);
    expect(source).not.toMatch(/console\./);
  });
});

describe("the board, the learnings and Ask Alti", () => {
  const demo = seedDemoIdeas(NOW);

  it("the demo has ideas in every status, by the demo team", () => {
    expect(new Set(demo.ideas.map((i) => i.status))).toEqual(new Set(IDEA_STATUSES));
    expect(demo.ideas.filter(isLearning).every((i) => (i.resultNote ?? "").length >= 10)).toBe(true);
  });

  it("the learnings library is the finished tests, searched by words in either language's metric name", () => {
    expect(searchLearnings(demo.ideas, "").map((i) => i.status).every((s) => s === "kept" || s === "dropped")).toBe(true);
    expect(searchLearnings(demo.ideas, "payment reminder").map((i) => i.id)).toEqual(["i-07"]);
    expect(searchLearnings(demo.ideas, "pagos fallidos", (m) => IDEA_METRIC_LABELS.es[m] ?? m).map((i) => i.id)).toEqual(["i-07"]);
    expect(searchLearnings(demo.ideas, "nothing like this")).toEqual([]);
  });

  it("a repeat is spotted before it is added", () => {
    expect(similarTitles("Payment reminder email before a charge", demo.ideas).map((i) => i.id)).toContain("i-07");
    expect(titleOverlap("a", "b")).toBe(0);
  });

  it("Ask Alti's playbook search finds a learning when it is passed in, and still only what the team wrote", () => {
    const learnings = searchLearnings(demo.ideas, "").map((i) => ({ id: i.id, title: i.title, lines: [i.resultNote ?? ""] }));
    const hits = searchPlaybook("partner newsletter", "en", 6, learnings);
    expect(hits.find((h) => h.kind === "learning")?.title).toBe("Partner newsletter every Monday");
    expect(searchPlaybook("partner newsletter", "en").some((h) => h.kind === "learning")).toBe(false);
  });

  it("Alti's job in Ideas is an administrator's proposal; the screens have their help in both languages", () => {
    const as = (role: (typeof STAFF_ROLES)[number]) => (c: Capability) => can(role, c);
    expect(altiJobs("business", as("admin")).map((j) => j.id)).toEqual(["ideas_proposals"]);
    expect(altiJobs("business", as("sales"))).toEqual([]);
    for (const locale of ["en", "es"] as const) {
      const job = ALTI_HELP_TEXT[locale].jobs.ideas_proposals;
      expect(checkClaimGuardrails(`${job.title} ${job.desc}`)).toEqual([]);
      expect(SCREEN_HELPS[locale]["/equipo/ideas"]).toBeTruthy();
      expect(SCREEN_HELPS[locale]["/equipo/lanzamiento"]).toBeTruthy();
    }
  });

  it("Ideas sit in «Ideas & numbers» after the dashboard; Launch readiness first in «Team & Settings»", () => {
    expect(NAV_GROUPS.find((g) => g.key === "business")!.hrefs).toEqual(["/equipo/negocio", "/equipo/ideas"]);
    expect(NAV_GROUPS.find((g) => g.key === "settings")!.hrefs[0]).toBe("/equipo/lanzamiento");
    expect(MORE_NAV.find((n) => n.href === "/equipo/ideas")!.needs).toBe("ideas.add");
    expect(MORE_NAV.find((n) => n.href === "/equipo/lanzamiento")!.needs).toBe("launch");
  });

  it("the screen's words never promise a result", () => {
    for (const locale of ["en", "es"] as const) {
      const t = IDEAS_TEXT[locale];
      for (const line of [t.subtitle, t.alti.intro, t.alti.rules, t.learnings.intro, t.empty.results]) expect(checkClaimGuardrails(line), line).toEqual([]);
    }
  });
});
