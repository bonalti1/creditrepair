import type { BankLine } from "./csv";

// Bank feeds, for later. Today a bank statement comes in as a CSV with a
// mapping step. A provider (for example Plaid) could bring the same lines in
// by itself; this is the shape it would have to fill. OFF by default: the
// only provider that exists is "none", and the Plaid entry is a placeholder
// that refuses to run. Nothing here makes a network call.
//
// Turning one on later needs: the provider's agreement and keys (server
// only), a read-only scope, the owner linking the account in the provider's
// own window, and the lines going through planBankImport (csv.ts) exactly
// like a CSV, so duplicates and closed months are handled the same way.

export type BankFeedId = "none" | "plaid";

export interface BankFeedProvider {
  id: BankFeedId;
  label: string;
  /** False until the owner sets it up. */
  enabled: boolean;
  /** Transactions between two calendar days, as bank lines. */
  listTransactions(from: string, to: string): Promise<BankLine[]>;
}

export class BankFeedOff extends Error {
  constructor(id: BankFeedId) {
    super(id === "none" ? "No bank feed is connected. Import the bank statement as a CSV." : `The ${id} bank feed is not set up. Import the bank statement as a CSV.`);
    this.name = "BankFeedOff";
  }
}

const NONE: BankFeedProvider = {
  id: "none",
  label: "None (CSV import)",
  enabled: false,
  listTransactions: async () => {
    throw new BankFeedOff("none");
  },
};

/** Placeholder only: no client library, no keys read, no request made. */
const PLAID_PLACEHOLDER: BankFeedProvider = {
  id: "plaid",
  label: "Plaid (not set up)",
  enabled: false,
  listTransactions: async () => {
    throw new BankFeedOff("plaid");
  },
};

/** The provider the settings name. Always disabled in this version. */
export function bankFeedProvider(id: string | null | undefined): BankFeedProvider {
  return id === "plaid" ? PLAID_PLACEHOLDER : NONE;
}
