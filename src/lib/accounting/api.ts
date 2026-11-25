import { z } from "zod";
import { CATEGORY_KEYS, PAYMENT_METHODS } from "./categories";
import { MAX_IMPORT_LINES } from "./csv";
import { MAX_AMOUNT_CENTS } from "./money";
import { COLLECTION_ACTION_KINDS } from "./types";

// What POST /api/staff/accounting accepts. Strict: a field the route does not
// expect is refused. Amounts are integer cents, days "YYYY-MM-DD". There is
// no field for a card or account number, a Social Security number or a tax
// id anywhere, and no SMS reminder (COLLECTION_ACTION_KINDS has none).

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const id = z.string().uuid().or(z.string().regex(/^[a-z0-9-]{2,64}$/));
const cents = z.number().int().min(1).max(MAX_AMOUNT_CENTS);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const fileName = z.string().min(1).max(200);

const expenseFields = {
  spentOn: day,
  amountCents: cents,
  category: z.enum(CATEGORY_KEYS),
  vendor: z.string().max(120),
  description: z.string().max(500),
  paymentMethod: z.enum(PAYMENT_METHODS),
};

export const accountingBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_expense"), ...expenseFields }).strict(),
  z.object({ action: z.literal("update_expense"), id, ...expenseFields }).strict(),
  z.object({ action: z.literal("void_expense"), id, reason: z.string().trim().min(5).max(500) }).strict(),
  z.object({ action: z.literal("add_adjustment"), ...expenseFields, amountCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS).refine((n) => n !== 0) }).strict(),
  z
    .object({
      action: z.literal("add_recurring"),
      vendor: z.string().max(120),
      description: z.string().max(500),
      category: z.enum(CATEGORY_KEYS),
      amountCents: cents,
      dayOfMonth: z.number().int().min(1).max(31),
      paymentMethod: z.enum(PAYMENT_METHODS),
      startsOn: day,
      endsOn: day.nullable(),
    })
    .strict(),
  z.object({ action: z.literal("set_recurring_active"), id, active: z.boolean() }).strict(),
  z.object({ action: z.literal("post_recurring") }).strict(),
  z
    .object({
      action: z.literal("import_bank"),
      fileName,
      fileSha256: sha,
      lines: z
        .array(
          z
            .object({
              line: z.number().int().min(1).max(100_000),
              day,
              description: z.string().min(1).max(200),
              vendor: z.string().max(120),
              // Money out, as the bank wrote it: negative.
              amountCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(-1),
              category: z.enum(CATEGORY_KEYS),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_IMPORT_LINES),
      skipped: z.number().int().min(0).max(100_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_income"),
      kind: z.enum(["monitoring_commission", "other"]),
      source: z.string().max(120),
      receivedOn: day,
      amountCents: cents,
      note: z.string().max(500),
    })
    .strict(),
  z.object({ action: z.literal("void_income"), id, reason: z.string().trim().min(5).max(500) }).strict(),
  z
    .object({
      action: z.literal("import_settlement"),
      gateway: z.enum(["nmi", "authorize_net"]),
      fileName,
      fileSha256: sha,
      rows: z
        .array(
          z
            .object({
              transactionId: z.string().min(1).max(120),
              orderId: z.string().max(120).nullable(),
              kind: z.enum(["sale", "refund", "void", "chargeback", "return", "fee", "other"]),
              status: z.enum(["settled", "declined", "voided", "pending", "other"]),
              amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
              feeCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
              settledOn: day,
              batchId: z.string().max(80).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_IMPORT_LINES),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide_match"),
      settlementRowId: z.string().uuid().or(z.string().regex(/^[a-z0-9-]{2,64}$/)).nullable(),
      chargeId: z.string().max(80).nullable(),
      decision: z.enum(["manual_match", "explained"]),
      note: z.string().trim().min(5).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("collection"),
      chargeId: z.string().min(2).max(80),
      kind: z.enum(COLLECTION_ACTION_KINDS),
      note: z.string().max(1000),
    })
    .strict(),
  z.object({ action: z.literal("close_month"), month, note: z.string().max(500) }).strict(),
  z.object({ action: z.literal("set_tax_rate"), bps: z.number().int().min(0).max(6000) }).strict(),
  z
    .object({
      action: z.literal("partner_tax"),
      partnerId: z.string().min(2).max(80),
      legalName: z.string().max(120),
      w9ReceivedOn: day.nullable(),
      exempt: z.boolean(),
    })
    .strict(),
]);

export type AccountingAction = z.infer<typeof accountingBodySchema>;

/** The largest request body: a full import. */
export const MAX_ACCOUNTING_BODY_BYTES = 1_500_000;
