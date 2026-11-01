// Per-state availability registry. Expansion is a LEGAL decision executed as
// a config change: counsel clears a state → flip its status to "open".
// Notes are internal guidance, not legal conclusions — every one needs counsel
// confirmation before a flip (attorney brief question #11).
//
// Default for any state not listed: "waitlist".

export type StateStatus = "open" | "waitlist" | "blocked";

export interface StateRule {
  status: StateStatus;
  /** Internal note for the expansion tier review. Never shown to consumers. */
  note?: string;
}

export const STATE_RULES: Record<string, StateRule> = {
  TX: { status: "open", note: "Launch state. CSO registration + $10k bond filed per Phase 0." },

  // Priority expansion targets (large Spanish-first markets) — each requires
  // counsel clearance and likely its own registration/bond:
  CA: { status: "waitlist", note: "Credit Services Act — registration + large bond likely if covered. Counsel." },
  FL: { status: "waitlist", note: "Credit Service Organizations Act — registration/bond regime. Counsel." },
  AZ: { status: "waitlist", note: "Credit services statute — verify applicability to DIY software. Counsel." },
  NM: { status: "waitlist", note: "Verify credit services coverage. Counsel." },
  NV: { status: "waitlist", note: "Credit services registration regime. Counsel." },
  IL: { status: "waitlist", note: "Credit Services Organizations Act. Counsel." },
  NY: { status: "waitlist", note: "GBL credit services provisions. Counsel." },

  // Elevated-risk — do not open without specific counsel sign-off:
  GA: { status: "blocked", note: "Statute carries criminal exposure for non-exempt credit repair. Counsel required before ANY marketing here." },
};

export const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
] as const;

export function stateStatus(code: string): StateStatus {
  return STATE_RULES[code.toUpperCase()]?.status ?? "waitlist";
}

export function openStates(): string[] {
  return ALL_STATES.filter((s) => stateStatus(s) === "open");
}
