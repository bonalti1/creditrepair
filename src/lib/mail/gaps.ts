import { latestRound } from "../staff/stage";
import { fullName, type StaffClient } from "../staff/types";
import { formatUsAddress, parseUsAddress } from "./address";
import { findFurnisher, nearFurnishers, normalizeCompanyName, type FurnisherEntry, type FurnisherGapRecord } from "./furnishers";
import { addressBookHref, missingFurnisherAddresses } from "./sendPlan";

// One shared directory of creditors' dispute addresses, and the companies it
// is still missing, for every client at once.
//
// The address book (furnishers.ts, table `furnishers`) has no client in it:
// it is already shared. A company is looked up by its normalized name and
// every alias across the whole book, whichever client's report named it. So
// a missing address is ONE problem per company, not one per client: the
// queue shows one item per company with every client waiting on it, and when
// a person adds the address once, every one of those rounds can go.
//
// To make that one item quick, the reports themselves are read for
// candidates: a credit report often prints an address for the creditor
// (ReportItem.furnisher.addressLines). Those are SUGGESTIONS only. A report's
// address is usually a payments or general address, not where disputes go,
// so nothing is ever mailed to one: a person opens the source, confirms it,
// and saves it with the source and the date (the address book's own rule).

export interface AddressSuggestion {
  /** As it would be saved (formatted). */
  addressLines: string[];
  /** How many report entries print it, and for how many clients. */
  reports: number;
  clients: number;
}

export interface FurnisherGap {
  company: string;
  normalizedName: string;
  /** The book's entry when there is one (without a usable address), for the edit link. */
  entryId: string | null;
  /** Everyone whose prepared round waits on this company. */
  waiting: Array<{ client: StaffClient; roundNumber: number; readyAt: string | null }>;
  /** When it was first seen missing: the shared record, else the oldest waiting round. */
  firstSeenAt: string | null;
  suggestions: AddressSuggestion[];
  /** Book entries with a similar name, in case it is the same company under another spelling. */
  nearMatches: Array<{ id: string; name: string }>;
  /** The address book form for it, with the first suggestion filled in (still to verify). */
  href: string;
}

/** Candidate addresses for a company, from every client's report. Most printed first. Never verified. */
export function addressSuggestions(clients: readonly StaffClient[], company: string, book: readonly FurnisherEntry[] = []): AddressSuggestion[] {
  const match = findFurnisher(book, company);
  const keys = new Set([normalizeCompanyName(company), ...(match.status === "found" ? [match.entry.name, ...match.entry.aliases].map(normalizeCompanyName) : [])]);
  const byAddress = new Map<string, { lines: string[]; reports: number; clients: Set<string> }>();
  for (const client of clients) {
    for (const item of client.report?.items ?? []) {
      const furnisher = item.furnisher;
      const name = furnisher?.name || item.name;
      if (!furnisher || !keys.has(normalizeCompanyName(name))) continue;
      const parsed = parseUsAddress(furnisher.addressLines);
      if (!parsed.ok) continue;
      const lines = formatUsAddress(parsed.address);
      const key = lines.join("|").toUpperCase();
      const entry = byAddress.get(key) ?? { lines, reports: 0, clients: new Set<string>() };
      entry.reports += 1;
      entry.clients.add(client.id);
      byAddress.set(key, entry);
    }
  }
  return [...byAddress.values()]
    .map((e) => ({ addressLines: e.lines, reports: e.reports, clients: e.clients.size }))
    .sort((a, b) => b.clients - a.clients || b.reports - a.reports);
}

/** The address book form for a company with a suggested address filled in: a person still adds the source and the date. */
export function addressBookSuggestHref(company: string, entryId: string | null, lines: readonly string[] | null): string {
  const base = addressBookHref(company, entryId);
  return lines && lines.length > 0 ? `${base}&direccion=${encodeURIComponent(lines.join("\n"))}` : base;
}

/**
 * Every company the prepared rounds are waiting on, once each, with the
 * clients waiting. Pure: from the clients this person sees and the book.
 */
export function furnisherGaps(
  clients: readonly StaffClient[],
  book: readonly FurnisherEntry[],
  recorded: readonly FurnisherGapRecord[] = [],
  allClients: readonly StaffClient[] = clients,
): FurnisherGap[] {
  const gaps = new Map<string, FurnisherGap>();
  for (const client of clients) {
    if (client.agreementCancelledAt) continue;
    const round = latestRound(client);
    if (!round || round.status !== "ready") continue;
    for (const gap of missingFurnisherAddresses(round, book)) {
      const normalizedName = normalizeCompanyName(gap.company);
      const current =
        gaps.get(normalizedName) ??
        ({
          company: gap.company,
          normalizedName,
          entryId: gap.entryId,
          waiting: [],
          firstSeenAt: null,
          suggestions: [],
          nearMatches: [],
          href: "",
        } satisfies FurnisherGap);
      current.waiting.push({ client, roundNumber: round.number, readyAt: round.readyAt ?? null });
      gaps.set(normalizedName, current);
    }
  }
  return [...gaps.values()].map((gap) => {
    const record = recorded.find((r) => r.normalizedName === gap.normalizedName && !r.resolvedAt);
    const oldest = gap.waiting.map((w) => w.readyAt).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
    const suggestions = addressSuggestions(allClients, gap.company, book);
    const nearMatches = nearFurnishers(book, gap.company).map((e) => ({ id: e.id, name: e.name }));
    gap.waiting.sort((a, b) => fullName(a.client).localeCompare(fullName(b.client), "es"));
    return {
      ...gap,
      firstSeenAt: record?.firstSeenAt ?? oldest,
      suggestions,
      nearMatches,
      href: addressBookSuggestHref(gap.company, gap.entryId, suggestions[0]?.addressLines ?? null),
    };
  });
}
