import { chargeFacts } from "../accounting/facts";
import { buildLedger } from "../accounting/ledger";
import type { ChargeMeta } from "../accounting/types";
import type { CommissionLine } from "../fulfillment/commissions";
import type { StaffClient } from "../staff/types";
import { packageOf, upgradesOf, type UpgradeEvent } from "./packages";
import { shortName } from "./register";
import type { ClientValueFacts } from "./scorecard";
import type { ClientPurchase, PurchaseKind } from "./types";

// Each signed client's value, from the records (read only):
//   collected    THE MONEY RULE (accounting/ledger.ts): buildLedger over the
//                client's charges; payments in, refunds / voids / lost
//                chargebacks out, test charges never; nothing typed in here;
//   commissions  the IdentityIQ commission lines recorded for the client
//                (/equipo/monitoreo), reversals counted, voided lines not;
//   purchases    later purchases marked by hand on the scorecard, with the
//                money they brought, when they brought any;
//   upgrades     DIY → Complete: the client's service_option_upgraded events
//                (packages.ts, service/server.ts listUpgrades), and the money
//                collected after the first one.

export function clientValueFacts(input: {
  clients: readonly StaffClient[];
  chargeMeta: Record<string, ChargeMeta>;
  commissions: readonly CommissionLine[];
  purchases: readonly ClientPurchase[];
  households?: ReadonlyMap<string, number>;
  loanOfficer?: ReadonlyMap<string, number>;
  /** The signed clients' DIY → Complete upgrade events. */
  upgrades?: readonly UpgradeEvent[];
}): Map<string, ClientValueFacts> {
  const ledger = buildLedger(chargeFacts(input.clients, input.chargeMeta), []);
  const out = new Map<string, ClientValueFacts>();
  for (const client of input.clients) {
    const upgrades = upgradesOf(client.id, input.upgrades ?? []);
    const firstUpgrade = upgrades.map((u) => u.at).sort()[0] ?? null;
    const mine = ledger.filter((e) => e.clientId === client.id);
    const collectedCents = mine.reduce((s, e) => s + e.amountCents, 0);
    const collectedAfterUpgradeCents = firstUpgrade ? mine.filter((e) => e.at >= firstUpgrade).reduce((s, e) => s + e.amountCents, 0) : 0;
    const commissionsCents = input.commissions.filter((c) => c.clientId === client.id && !c.voidedAt).reduce((s, c) => s + c.amountCents, 0);
    const bought = input.purchases.filter((p) => p.clientId === client.id && !p.voidedAt);
    const purchaseCounts: Partial<Record<PurchaseKind, number>> = {};
    for (const p of bought) purchaseCounts[p.kind] = (purchaseCounts[p.kind] ?? 0) + 1;
    out.set(client.id, {
      clientId: client.id,
      name: shortName(client.firstName, client.lastName),
      option: packageOf(client),
      collectedCents,
      collectedAfterUpgradeCents,
      commissionsCents,
      purchasesCents: bought.reduce((s, p) => s + (p.amountCents ?? 0), 0),
      purchaseCounts,
      upgrades: upgrades.length,
      households: input.households?.get(client.id) ?? 0,
      loanOfficer: input.loanOfficer?.get(client.id) ?? 0,
    });
  }
  return out;
}
