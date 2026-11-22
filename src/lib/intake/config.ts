// AI intake: the settings in one place (docs/INTAKE.md).
//
// Three slow human jobs are reading documents: the client's 3-bureau credit
// report, their photo ID and proof of address, and the paper answers the
// bureaus mail back. Claude reads them; deterministic code checks every
// answer before anyone sees it; a person looks only at what is doubtful.
//
// Without ANTHROPIC_API_KEY nothing is sent anywhere: every flow returns a
// clearly labelled simulated result (the demo), and with a database behind it
// a simulated result never counts as a check (everything goes to a person).

/** The model every intake call uses. INTAKE_MODEL overrides it (for example to try a cheaper one). */
export const DEFAULT_INTAKE_MODEL = "claude-opus-5-5";

export function intakeModel(): string {
  const configured = process.env.INTAKE_MODEL?.trim();
  return configured && /^[a-z0-9.-]{3,60}$/.test(configured) ? configured : DEFAULT_INTAKE_MODEL;
}

/** True when the server can call Claude. Server only: the key is never sent to a browser. */
export function intakeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Prices per million tokens for DEFAULT_INTAKE_MODEL (Claude Opus 5.5, Claude
 * API first-party rates as of 2026-11). Used only to ESTIMATE the cost of a
 * document for the log and the owner's numbers; the invoice is the source of
 * truth. Cache writes (5-minute) bill at 1.25x input, cache reads at $0.20.
 */
export const PRICE_PER_MTOK = {
  input: 4,
  output: 20,
  cacheWrite: 5,
  cacheRead: 0.2,
} as const;

/** How hard the model thinks, per document kind. A report is long and every line matters. */
export const INTAKE_EFFORT = {
  credit_report: "high",
  identity: "medium",
  bureau_letter: "medium",
} as const;

/** Output ceilings. Streaming is used, so a long report is not cut off by an HTTP timeout. */
export const MAX_OUTPUT_TOKENS = {
  credit_report: 64_000,
  identity: 8_000,
  bureau_letter: 16_000,
} as const;

// ── Files ───────────────────────────────────────────────────────────────

/** A 3-bureau report PDF from a monitoring service is usually 1–10 MB. The API takes up to 32 MB per request. */
export const MAX_REPORT_FILE_BYTES = 20 * 1024 * 1024;
/** A phone photo of an ID, a utility bill or a bureau letter. */
export const MAX_PHOTO_FILE_BYTES = 10 * 1024 * 1024;
/** A bureau letter may be a scanned PDF of a few pages. */
export const MAX_LETTER_FILE_BYTES = 15 * 1024 * 1024;
/** Saved report pages (HTML) are text; larger than this is not one report. */
export const MAX_HTML_BYTES = 8 * 1024 * 1024;
/** After stripping the page down to its text, what is sent at most (characters). */
export const MAX_REPORT_TEXT_CHARS = 600_000;

// ── Rules ───────────────────────────────────────────────────────────────

/**
 * A proof of address counts when it is dated within this many days. Bureaus
 * ask for a "recent" bill or statement; most guidance says 60 to 90 days.
 */
export const PROOF_OF_ADDRESS_MAX_AGE_DAYS = 90;

/** Rate limits per person, per window, for the routes that spend model tokens. */
export const INTAKE_RATE_LIMIT = {
  staffReport: { limit: 10, windowMs: 10 * 60_000 },
  clientDocument: { limit: 8, windowMs: 10 * 60_000 },
  bureauLetter: { limit: 8, windowMs: 10 * 60_000 },
} as const;

/** The private bucket for report PDFs and bureau letters (migration 0016). ID photos stay in 'identity-docs'. */
export const INTAKE_BUCKET = "intake-files";
export const IDENTITY_BUCKET = "identity-docs";
