import type { PackageUpgrade, ServiceOption } from "./types";

// Which package a client is on, and their DIY → Complete upgrades
// (owner's decision, 2026-11-25: "Credalti Complete" and "Credalti DIY").
// Another helper builds the packages themselves: a per-client `option`
// field and the upgrade events, with a small function to read them. Until
// that lands, this is the interface the scorecard reads through:
//
//   - packageOf(client): the client's `option` (also accepted: `package`,
//     `servicePackage`), any of diy, do_it_yourself, self_serve,
//     credalti_diy → DIY; anything else, or nothing → Complete (every
//     client before the packages was full service);
//   - upgradesOf(client): the client's `packageEvents` / `upgrades`, entries
//     with `at`, `from` and `to`, kept when from is DIY and to is Complete.
//
// When the packages module exists, it calls `registerPackageReader` once
// (import it from src/lib/webinars/server.ts) and its own reading wins.

export interface PackageReader {
  optionOf(client: unknown): ServiceOption;
  upgradesOf(client: unknown): PackageUpgrade[];
}

const DIY = /^(diy|do_it_yourself|do-it-yourself|self_serve|self-serve|credalti_diy|guided)$/i;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function normalizeOption(value: unknown): ServiceOption {
  return typeof value === "string" && DIY.test(value.trim()) ? "diy" : "complete";
}

const GENERIC: PackageReader = {
  optionOf(client) {
    const c = asRecord(client);
    return normalizeOption(c.option ?? c.package ?? c.servicePackage);
  },
  upgradesOf(client) {
    const c = asRecord(client);
    const id = typeof c.id === "string" ? c.id : "";
    const list = Array.isArray(c.packageEvents) ? c.packageEvents : Array.isArray(c.upgrades) ? c.upgrades : [];
    return list.flatMap((raw): PackageUpgrade[] => {
      const e = asRecord(raw);
      const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? e.at : null;
      if (!at || normalizeOption(e.from) !== "diy" || normalizeOption(e.to) !== "complete") return [];
      return [{ clientId: id, at, from: "diy", to: "complete" }];
    });
  },
};

let reader: PackageReader = GENERIC;

export function registerPackageReader(next: PackageReader): void {
  reader = next;
}

export function packageOf(client: unknown): ServiceOption {
  return reader.optionOf(client);
}

export function upgradesOf(client: unknown): PackageUpgrade[] {
  return reader.upgradesOf(client);
}

export const PACKAGE_NAMES: Record<ServiceOption, string> = { complete: "Credalti Complete", diy: "Credalti DIY" };
