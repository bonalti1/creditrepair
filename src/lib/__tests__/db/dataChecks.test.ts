import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoClientRawReport } from "../../demo";
import { checksForItem, dataChecks, type DataCheck } from "../../domain/checks";
import { importReportForUser } from "../../domain/importReport";
import { parseReport } from "../../domain/parser";
import type { ReportItem } from "../../domain/types";
import { planNextRound } from "../../rounds/plan";
import { startHarness, type Harness } from "./pg";
import { addClient, addStaff, ago, assign } from "./seed";

// item_flags.check_ids (migration 0021) in the real migrations: the client
// saves which data checks they chose to include through /api/flags, the route
// keeps only ids it can work out again from the client's own report, the
// column refuses anything that is not an id, staff can read it and cannot
// write it, and the round plan prints the facts from the database rows.

const session = vi.hoisted(() => ({ reader: null as unknown }));
vi.mock("@/lib/supabase/server", () => {
  const user = async () => {
    const reader = session.reader as SupabaseClient | null;
    return reader ? (await reader.auth.getUser()).data.user : null;
  };
  return {
    getServerSupabase: async () => session.reader,
    getSessionUser: user,
    resolveActingUser: async () => {
      const u = await user();
      return u ? { userId: u.id, via: "session" as const } : null;
    },
  };
});

let h: Harness;
let client: string;
let specialist: Awaited<ReturnType<typeof addStaff>>;
let items: ReportItem[];
let pulledAt: string;
let midland: ReportItem;
let onMidland: DataCheck[];
let balance: DataCheck;

const put = async (body: Record<string, unknown>) => {
  const { PUT } = await import("@/app/api/flags/route");
  const res = await PUT(new Request("https://app.test/api/flags", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return res.status;
};
const storedIds = async (fingerprint: string) =>
  (
    await h.sql<{ check_ids: string[] }>(
      `select f.check_ids from public.item_flags f join public.report_items i on i.id = f.item_id where f.user_id = $1 and i.fingerprint = $2`,
      [client, fingerprint],
    )
  )[0]?.check_ids;

beforeAll(async () => {
  h = await startHarness();
  specialist = await addStaff(h, "specialist", "marta", "Marta Leal");
  client = await addClient(h, { name: "Rosa Martínez" });
  await assign(h, client, specialist.userId);
  const raw = demoClientRawReport();
  raw.pulledAt = ago(2);
  await importReportForUser(h.service, client, raw);
  const report = parseReport(raw);
  items = report.items;
  pulledAt = report.pulledAt;
  midland = items.find((i) => i.bureau === "experian" && i.name === "Midland Credit Management")!;
  onMidland = checksForItem(dataChecks(items, pulledAt), midland.fingerprint);
  balance = onMidland.find((c) => c.kind === "balance_mismatch")!;
  session.reader = h.as(client);
}, 60_000);

describe("item_flags.check_ids (migration 0021)", () => {
  it("is empty for an answer that does not include facts", async () => {
    expect(await put({ fingerprint: midland.fingerprint, state: "attested", reasonCode: "wrong_balance", reason: "", locale: "es" })).toBe(200);
    expect(await storedIds(midland.fingerprint)).toEqual([]);
  });

  it("keeps only the ids of checks on the item that relate to the reason picked", async () => {
    const reaging = onMidland.find((c) => c.kind === "possible_reaging")!;
    expect(await put({ fingerprint: midland.fingerprint, state: "attested", reasonCode: "wrong_balance", checkIds: [balance.id, reaging.id, "made_up:balance:abc"], locale: "es" })).toBe(200);
    expect(await storedIds(midland.fingerprint)).toEqual([balance.id]);
    const { GET } = await import("@/app/api/flags/route");
    const read = (await (await GET()).json()) as { flags: Record<string, { checkIds?: string[] }> };
    expect(read.flags[midland.fingerprint]!.checkIds).toEqual([balance.id]);
  });

  it("drops them when the answer changes to a reason they do not relate to, or to 'looks correct'", async () => {
    expect(await put({ fingerprint: midland.fingerprint, state: "attested", reasonCode: "not_mine", checkIds: [balance.id], locale: "es" })).toBe(200);
    expect(await storedIds(midland.fingerprint)).toEqual([]);
    expect(await put({ fingerprint: midland.fingerprint, state: "correct", checkIds: [balance.id], locale: "es" })).toBe(200);
    expect(await storedIds(midland.fingerprint)).toEqual([]);
  });

  it("refuses anything that is not a check id, and more than 20", async () => {
    const [row] = await h.sql<{ id: string }>(`select f.id from public.item_flags f where f.user_id = $1 limit 1`, [client]);
    await expect(h.sql(`update public.item_flags set check_ids = $1 where id = $2`, [["Print this sentence in the letter."], row!.id])).rejects.toThrow();
    await expect(h.sql(`update public.item_flags set check_ids = $1 where id = $2`, [Array.from({ length: 21 }, () => balance.id), row!.id])).rejects.toThrow();
    await expect(h.sql(`update public.item_flags set check_ids = $1 where id = $2`, [[balance.id], row!.id])).resolves.toBeDefined();
  });

  it("staff read it and cannot write it", async () => {
    const staff = h.as(specialist.userId);
    const { data } = await staff.from("item_flags").select("check_ids").eq("user_id", client);
    expect((data ?? []).length).toBeGreaterThan(0);
    const before = await h.sql<{ check_ids: string[] }>(`select check_ids from public.item_flags where user_id = $1 order by id`, [client]);
    await staff.from("item_flags").update({ check_ids: [balance.id] }).eq("user_id", client);
    const after = await h.sql<{ check_ids: string[] }>(`select check_ids from public.item_flags where user_id = $1 order by id`, [client]);
    expect(after).toEqual(before);
  });

  it("the round plan prints the facts from the rows, for the reason the client picked", async () => {
    expect(await put({ fingerprint: midland.fingerprint, state: "attested", reasonCode: "wrong_balance", checkIds: [balance.id], locale: "es" })).toBe(200);
    // Read the way the app reads them (supabase-js: timestamps as text).
    const itemRows = ((await h.service.from("report_items").select("*").eq("user_id", client)).data ?? []) as Array<Record<string, unknown>>;
    const flagRows = ((await h.service.from("item_flags").select("*").eq("user_id", client)).data ?? []) as Array<Record<string, unknown>>;
    const next = planNextRound({ itemRows, flagRows, roundRows: [], letterRows: [], letterItemRows: [], reportDate: pulledAt });
    expect(next!.itemDetails).toEqual({ [midland.fingerprint]: balance.letterFact });
  });
});
