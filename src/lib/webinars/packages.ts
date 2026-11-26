import { effectiveOption, parseServiceOption, type ServiceOption as ClientOption } from "../service/options";
import type { PackageUpgrade, ServiceOption } from "./types";

// Which package a client is on, and their DIY → Complete upgrades, as the
// campaign scorecard reads them (docs/WEBINARS.md, «Packages»), from the
// service options module (docs/SERVICE-OPTIONS.md, migration 0042):
//
//   - packageOf(client): the client's recorded option, `serviceOption` on the
//     console's client record (src/lib/staff/fromRows.ts: the signed agreement
//     in force, else the option they chose). "diy" is Credalti DIY,
//     "full_service" Credalti Complete. A client with NO recorded option
//     (signed before options existed) is Credalti Complete: the same rule
//     billing and the console apply (effectiveOption);
//   - upgradesOf(clientId, events): the client's `service_option_upgraded`
//     events (written when a Complete agreement supersedes a DIY one,
//     api/agreement/sign), read on the server by listUpgrades
//     (src/lib/service/server.ts, beside countUpgrades).
//
// The scorecard's words are "complete" and "diy"; the client record's are
// "full_service" and "diy".

export function toPackage(option: ClientOption): ServiceOption {
  return option === "diy" ? "diy" : "complete";
}

export function packageOf(client: { serviceOption?: unknown }): ServiceOption {
  return toPackage(effectiveOption({ chosenOption: parseServiceOption(client.serviceOption) }));
}

/** An upgrade event as service/server.ts listUpgrades returns it. */
export interface UpgradeEvent {
  userId: string;
  at: string;
}

export function upgradesOf(clientId: string, events: readonly UpgradeEvent[]): PackageUpgrade[] {
  return events
    .filter((e) => e.userId === clientId && !Number.isNaN(Date.parse(e.at)))
    .map((e) => ({ clientId, at: e.at, from: "diy" as const, to: "complete" as const }))
    .sort((a, b) => a.at.localeCompare(b.at));
}
