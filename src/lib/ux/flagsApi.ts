import { z } from "zod";
import { DISPUTE_REASONS, type DisputeReasonCode } from "../letters/reasons";

// What /api/flags accepts when a customer saves an answer about an item.
// Kept apart from the route file so the rules can be tested without a database.
//
// The reason code is checked against the catalogue (letters/reasons.ts): a
// code that is not in it never reaches the database, and so never reaches a
// letter. A confirmed answer ("attested") must carry a reason, and "other"
// must carry the customer's own words, the same rule the review screens apply.
// Answers confirmed before reasons existed are rows already in the database;
// nothing here rewrites them.

const CODES = DISPUTE_REASONS.map((reason) => reason.code) as [DisputeReasonCode, ...DisputeReasonCode[]];

export const flagPutSchema = z
  .object({
    fingerprint: z.string().min(1),
    state: z.enum(["correct", "flagged", "attested"]).nullable(),
    reason: z.string().max(500).optional(),
    reasonCode: z.enum(CODES).optional(),
    locale: z.enum(["es", "en"]).default("es"),
  })
  .superRefine((value, ctx) => {
    if (value.state === "attested" && !value.reasonCode) {
      ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "A confirmed item needs a reason." });
    }
    if (value.reasonCode === "other" && !(value.reason ?? "").trim()) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "'Another reason' needs the customer's own words." });
    }
  });

export type FlagPut = z.infer<typeof flagPutSchema>;

/**
 * The reason code to store with an answer. Only an answer that says the item
 * is inaccurate keeps one; "looks correct" has no reason.
 */
export function storedReasonCode(put: Pick<FlagPut, "state" | "reasonCode">): DisputeReasonCode | null {
  return put.state === "flagged" || put.state === "attested" ? (put.reasonCode ?? null) : null;
}
