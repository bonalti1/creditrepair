// Feature flags. ABA handoff (spec §5) is built but ships DARK: the flag stays
// off until the attorney blesses the flow and disclosure text (Phase 6 gate).

export const FEATURES = {
  abaHandoff: process.env.NEXT_PUBLIC_FEATURE_ABA_HANDOFF === "1",
} as const;
