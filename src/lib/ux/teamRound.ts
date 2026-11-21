// Full service: where the client's round of letters stands, as the client app
// shows it. The team prepares and mails the letters, so the client has no
// approve step; the letters and rounds pages show one of these four states.
//
// Demo: the state is read from what this browser has saved, nothing more. A
// finished review with something confirmed means the team is preparing the
// letters. The round counts as mailed only when the saved state already says
// so (letters approved in self-serve mode); the client app never marks a round
// as mailed, and never invents a mailing date, on the team's behalf.

export type TeamRoundStatus =
  /** Items on the report still wait for the client's answer. */
  | "reviewing"
  /** Everything reviewed, nothing confirmed as inaccurate: no letters. */
  | "nothing_to_send"
  /** Review finished: the team is preparing the letters. */
  | "preparing"
  /** The letters went out; the bureaus' response window is running. */
  | "mailed";

export interface TeamRoundInput {
  totalItems: number;
  /** Items the client has answered, either way. */
  reviewedCount: number;
  /** Letters built from the confirmed answers. */
  letterCount: number;
  /** True only when the saved state says this round's letters were sent. */
  mailed: boolean;
}

export function teamRoundStatus({ totalItems, reviewedCount, letterCount, mailed }: TeamRoundInput): TeamRoundStatus {
  // Letters already out stay out, even if the client reopens an item afterwards.
  if (mailed && letterCount > 0) return "mailed";
  if (reviewedCount < totalItems) return "reviewing";
  return letterCount > 0 ? "preparing" : "nothing_to_send";
}

/**
 * When the round was mailed, for the dates on screen. The saved date when
 * there is one; otherwise today, which is how the demo has always counted a
 * round approved before dates were kept. Null when nothing was mailed.
 */
export function roundMailedDate(mailed: boolean, savedAt: string | null, now: Date = new Date()): Date | null {
  if (!mailed) return null;
  const saved = savedAt ? new Date(savedAt) : null;
  return saved && !Number.isNaN(saved.getTime()) ? saved : now;
}
