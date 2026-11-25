import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaimGuardrails } from "../compliance/guardrails";
import { ALTI_HELP_TEXT, altiJobs, searchPlaybook } from "../staff/altiHelp";
import { SHELL_TEXT } from "../staff/i18n/ui/shell";
import { groupOfPath, MORE_NAV, NAV_GROUPS, phoneMainGroups, PRIMARY_NAV } from "../staff/nav";
import { can, STAFF_ROLES, type Capability } from "../staff/permissions";
import { PLAYBOOKS, SCREEN_HELPS } from "../staff/playbook";

// The console's frame on ALTO Control's model (docs/STAFF.md, «The console's
// design system»): ten numbered groups, the phone's tab bar, and «Ask Alti»,
// which points at what exists and never writes an answer of its own.

const destinations = [...PRIMARY_NAV, ...MORE_NAV].map((n) => n.href);

describe("the grouped menu", () => {
  it("numbers ten groups 0 to 9, in the order the business works", () => {
    expect(NAV_GROUPS.map((g) => g.number)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(["overview", "day", "content", "leads", "clients", "money", "library", "partners", "business", "settings"]);
  });

  it("holds every destination exactly once, and nothing that is not one", () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.hrefs);
    for (const href of destinations) expect(grouped.filter((h) => h === href), href).toHaveLength(1);
    // Calls are a destination only when turned on; the group keeps its place for them.
    for (const href of grouped) expect(destinations.includes(href) || href === "/equipo/llamadas", href).toBe(true);
  });

  it("finds the group of any console page, the longest match first", () => {
    expect(groupOfPath("/equipo").key).toBe("day");
    expect(groupOfPath("/equipo/control").key).toBe("overview");
    expect(groupOfPath("/equipo/clientes/c07").key).toBe("clients");
    expect(groupOfPath("/equipo/enviar").key).toBe("clients");
    expect(groupOfPath("/equipo/contenido/pieza/p1").key).toBe("content");
    expect(groupOfPath("/equipo/cobros/inv-1").key).toBe("money");
    expect(groupOfPath("/equipo/perfil").key).toBe("settings");
  });

  it("shows a group only with a page the role may open (the same capabilities as before)", () => {
    const groupsFor = (role: (typeof STAFF_ROLES)[number]) => {
      const allowed = new Set([...PRIMARY_NAV, ...MORE_NAV].filter((n) => !n.needs || can(role, n.needs)).map((n) => n.href));
      return { allowed, groups: NAV_GROUPS.filter((g) => g.hrefs.some((h) => allowed.has(h))) };
    };
    const sales = groupsFor("sales");
    expect(sales.groups.map((g) => g.key)).not.toContain("money");
    expect(sales.allowed.has("/equipo/contabilidad")).toBe(false);
    const specialist = groupsFor("specialist");
    expect(specialist.groups.map((g) => g.key)).not.toContain("leads");
    expect(groupsFor("admin").groups).toHaveLength(10);
    // Settings is always there: everyone has a profile.
    for (const role of STAFF_ROLES) expect(groupsFor(role).groups.map((g) => g.key)).toContain("settings");
  });

  it("puts four sections on the phone's bar, the everyday ones first", () => {
    for (const role of STAFF_ROLES) {
      const allowed = new Set([...PRIMARY_NAV, ...MORE_NAV].filter((n) => !n.needs || can(role, n.needs)).map((n) => n.href));
      const groups = NAV_GROUPS.filter((g) => g.hrefs.some((h) => allowed.has(h)));
      const main = phoneMainGroups(groups, allowed);
      expect(main).toHaveLength(4);
      expect(main[0]!.key).toBe("day");
      expect(main.map((g) => g.key)).toContain("overview");
    }
  });

  it("names every group, its short name and its line in both languages", () => {
    for (const locale of ["en", "es"] as const) {
      for (const g of NAV_GROUPS) {
        expect(SHELL_TEXT[locale].groups[g.key]).toBeTruthy();
        expect(SHELL_TEXT[locale].groupShort[g.key]).toBeTruthy();
        expect(SHELL_TEXT[locale].groupLines[g.key]).toBeTruthy();
      }
    }
  });
});

describe("Ask Alti", () => {
  const as = (role: (typeof STAFF_ROLES)[number]) => (c: Capability) => can(role, c);

  it("lists only the AI features the role may use", () => {
    expect(altiJobs("leads", as("specialist"))).toEqual([]);
    expect(altiJobs("leads", as("sales")).map((j) => j.id)).toEqual(["lead_suggest", "lead_autopilot"]);
    expect(altiJobs("clients", as("sales"))).toEqual([]);
    expect(altiJobs("clients", as("specialist")).map((j) => j.id)).toEqual(["client_draft", "saved_answers"]);
    expect(altiJobs("content", as("sales"))).toEqual([]);
    expect(altiJobs("money", as("admin"))).toEqual([]);
  });

  it("each job opens a console page the role may open", () => {
    const nav = [...PRIMARY_NAV, ...MORE_NAV];
    for (const role of STAFF_ROLES) {
      for (const g of NAV_GROUPS) {
        for (const job of altiJobs(g.key, as(role))) {
          const path = job.href.split("?")[0]!;
          const item = nav.find((n) => n.href === path);
          expect(item, job.href).toBeDefined();
          expect(!item!.needs || can(role, item!.needs), `${role} ${job.href}`).toBe(true);
        }
      }
    }
  });

  it("says what Alti does without a promise, in both languages", () => {
    for (const locale of ["en", "es"] as const) {
      const text = ALTI_HELP_TEXT[locale];
      for (const line of [text.intro, text.jobsIntro, text.noJobs, ...Object.values(text.gates), ...Object.values(text.jobs).flatMap((j) => [j.title, j.desc])]) {
        expect(checkClaimGuardrails(line), line).toEqual([]);
      }
    }
  });

  it("the playbook search only returns what the team wrote", () => {
    const written = new Set<string>([
      ...Object.values(PLAYBOOKS.en).map((c) => c.title),
      ...Object.values(SCREEN_HELPS.en).map((h) => h.title),
    ]);
    const hits = searchPlaybook("returned letter", "en");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) if (hit.kind !== "rule") expect(written.has(hit.title), hit.title).toBe(true);
    expect(searchPlaybook("", "en")).toEqual([]);
    expect(searchPlaybook("zzqx unicorn", "en")).toEqual([]);
    // Both languages, accents or not.
    expect(searchPlaybook("carta devuelta", "es").length).toBeGreaterThan(0);
  });

  it("is labelled as AI, never stands for a person, and the console shows no robot", () => {
    const panel = readFileSync("src/components/staff/AskAlti.tsx", "utf8");
    expect(panel).toMatch(/aiByline\(locale\)/);
    expect(panel).not.toMatch(/character="cameo"|altibot_/);
    const shell = readFileSync("src/components/staff/StaffShell.tsx", "utf8");
    expect(shell).toMatch(/aiByline\(locale\)/);
    expect(shell).not.toMatch(/character="cameo"|altibot_/);
    // Nothing in the panel sends or writes: no fetch, no draft call.
    expect(panel).not.toMatch(/fetch\(|\/api\//);
  });
});
