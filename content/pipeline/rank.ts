import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The rulebook for reading ad results. An ads manager (a person, or the ads
// agent in ALTO Control) exports one row per ad; this says which to scale, which
// to stop and which have not run long enough to judge. Plain rules on purpose:
// the same numbers always give the same verdict, and anyone can check why.
//
//   npm run content:rank results.json
//
// results.json: [{ "ad": "mecanico-h03", "spend": 42.5, "impressions": 6100,
//                  "views3s": 2300, "leads": 9 }, ...]
// A "lead" is whatever the campaign optimises for: here, a WhatsApp
// conversation started.

export interface AdResult {
  ad: string;
  spend: number;
  impressions: number;
  /** 3-second video views. */
  views3s: number;
  leads: number;
}

export type Verdict = "scale" | "keep" | "stop" | "wait";

export interface RankedAd extends AdResult {
  /** Share of impressions that watched 3 seconds: how well the opening works. */
  hookRate: number;
  /** Null when there are no leads yet. */
  costPerLead: number | null;
  verdict: Verdict;
  reason: string;
}

// An ad is not judged until it has had a fair run.
export const MIN_IMPRESSIONS = 2000;
export const MIN_SPEND = 20;
// Cost per lead is only trusted once there are a few leads behind it.
export const MIN_LEADS_FOR_CPL = 5;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function rankAds(results: AdResult[]): RankedAd[] {
  const rows = results.map((r) => ({
    ...r,
    hookRate: r.impressions > 0 ? r.views3s / r.impressions : 0,
    costPerLead: r.leads > 0 ? r.spend / r.leads : null,
  }));

  const judged = rows.filter((r) => r.impressions >= MIN_IMPRESSIONS && r.spend >= MIN_SPEND);
  const withCpl = judged.filter((r) => r.leads >= MIN_LEADS_FOR_CPL && r.costPerLead !== null);
  const bestCpl = withCpl.length ? Math.min(...withCpl.map((r) => r.costPerLead!)) : null;
  const medianCpl = withCpl.length ? median(withCpl.map((r) => r.costPerLead!)) : null;
  const medianHook = judged.length ? median(judged.map((r) => r.hookRate)) : null;
  const money = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  const ranked: RankedAd[] = rows.map((r) => {
    if (r.impressions < MIN_IMPRESSIONS || r.spend < MIN_SPEND) {
      return { ...r, verdict: "wait", reason: `Not enough data yet (needs ${MIN_IMPRESSIONS} impressions and ${money(MIN_SPEND)} spent).` };
    }
    // Spent well past what a lead costs elsewhere and produced none.
    if (r.leads === 0 && medianCpl !== null && r.spend >= 2 * medianCpl) {
      return { ...r, verdict: "stop", reason: `${money(r.spend)} spent with no leads; the typical lead costs ${money(medianCpl)}.` };
    }
    if (r.leads >= MIN_LEADS_FOR_CPL && r.costPerLead !== null && bestCpl !== null && medianCpl !== null) {
      if (r.costPerLead <= bestCpl * 1.2) {
        return { ...r, verdict: "scale", reason: `${money(r.costPerLead)} per lead, within 20% of the best (${money(bestCpl)}).` };
      }
      if (withCpl.length >= 3 && r.costPerLead >= medianCpl * 1.5) {
        return { ...r, verdict: "stop", reason: `${money(r.costPerLead)} per lead, 50% or more above the typical ${money(medianCpl)}.` };
      }
      return { ...r, verdict: "keep", reason: `${money(r.costPerLead)} per lead; neither a leader nor a clear loser.` };
    }
    // Too few leads to trust cost per lead: fall back to the opening.
    if (medianHook !== null && judged.length >= 3 && r.hookRate < medianHook * 0.6) {
      return { ...r, verdict: "stop", reason: `Only ${pct(r.hookRate)} watch 3 seconds; the typical ad holds ${pct(medianHook)}.` };
    }
    return { ...r, verdict: "keep", reason: `Fewer than ${MIN_LEADS_FOR_CPL} leads so far; holds ${pct(r.hookRate)} past 3 seconds.` };
  });

  const order: Record<Verdict, number> = { scale: 0, keep: 1, wait: 2, stop: 3 };
  return ranked.sort(
    (a, b) =>
      order[a.verdict] - order[b.verdict] ||
      (a.costPerLead ?? Infinity) - (b.costPerLead ?? Infinity) ||
      b.hookRate - a.hookRate,
  );
}

/** What to make next: more ads like the leaders, built on their openings. */
export function nextBatch(ranked: RankedAd[]): string[] {
  const leaders = ranked.filter((r) => r.verdict === "scale").map((r) => r.ad);
  const waiting = ranked.filter((r) => r.verdict === "wait").length;
  if (leaders.length === 0) {
    return waiting > 0
      ? ["No leader yet. Let the ads still waiting reach the minimum before changing anything."]
      : ["No leader. Write a new set of opening hooks; the current ones are not separating."];
  }
  return [
    `Scale: ${leaders.join(", ")}.`,
    `Write 5 new opening hooks in the style of ${leaders.slice(0, 2).join(" and ")} and cut them from the same footage (no credits).`,
    "When one opening has led for two rounds, spend credits on a new base video built around it.",
  ];
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run content:rank <results.json>");
    process.exit(2);
  }
  const ranked = rankAds(JSON.parse(readFileSync(file, "utf8")) as AdResult[]);
  for (const r of ranked) {
    const cpl = r.costPerLead === null ? "no leads" : `$${r.costPerLead.toFixed(2)}/lead`;
    console.log(`${r.verdict.toUpperCase().padEnd(5)} ${r.ad.padEnd(16)} ${cpl.padEnd(13)} ${(r.hookRate * 100).toFixed(0)}% hook  ${r.reason}`);
  }
  console.log("\nNext:");
  for (const line of nextBatch(ranked)) console.log(`- ${line}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
