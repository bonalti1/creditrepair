import { z } from "zod";

// What the staff team routes accept (/api/staff/team, /api/staff/clients).
// Kept apart from the routes so the tests can check the rules without a
// server. Every body is strict: a field the route does not expect is refused,
// not ignored. There is no field for a Social Security number or a date of
// birth anywhere: staff never type them.

const handle = z.string().regex(/^[a-z0-9-]{2,30}$/);
const role = z.enum(["admin", "specialist", "sales"]);

/** POST /api/staff/team (administrators only). */
export const teamBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add_member"),
      name: z.string().min(2).max(80),
      email: z.string().max(254).optional().nullable(),
      phone: z.string().max(30).optional().nullable(),
      role,
    })
    .strict(),
  z.object({ action: z.literal("change_role"), handle, role }).strict(),
  z.object({ action: z.literal("set_active"), handle, active: z.boolean() }).strict(),
  z.object({ action: z.literal("set_auto_assign"), on: z.boolean() }).strict(),
]);

export type TeamBody = z.infer<typeof teamBodySchema>;

/** The most clients one request may assign. */
export const MAX_BULK_ASSIGN = 200;

/** POST /api/staff/clients. */
export const clientsBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add_prospect"),
      firstName: z.string().min(1).max(40),
      lastName: z.string().min(1).max(40),
      phone: z.string().min(7).max(30),
      email: z.string().max(254).optional().nullable(),
      state: z.string().length(2),
      goal: z.enum(["mortgage", "auto", "card", "general"]),
      /** Ignored for a salesperson: they always add for themselves. */
      salesperson: handle.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("assign"),
      clientIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_ASSIGN),
      /** A teammate's handle, or null to leave the clients without anyone. */
      to: handle.nullable(),
    })
    .strict(),
]);

export type ClientsBody = z.infer<typeof clientsBodySchema>;

// ── The case: notes, handled marks, replies, reports, rounds ────────────
//
// POST /api/staff/case, /api/staff/reports and /api/staff/rounds. The client
// id is only which client the member asks about: the route checks, through
// the member's own connection (the role-scoped read policies of migration
// 0012), that they may see that client, before writing anything with the
// service role. Nobody's role, name or handle is ever taken from the body.

const clientId = z.string().uuid();

/** POST /api/staff/case. */
export const caseBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("note"), clientId, text: z.string().trim().min(1).max(2000) }).strict(),
  z
    .object({
      action: z.literal("resolve"),
      clientId,
      // "documents_missing", "payment_past_due:<charge id>", "furnisher_address_missing:Capital One"…
      key: z.string().min(2).max(200).regex(/^[a-z_]{2,40}(:.{1,150})?$/),
    })
    .strict(),
  z.object({ action: z.literal("reply"), clientId, text: z.string().trim().min(1).max(4000) }).strict(),
]);

export type CaseBody = z.infer<typeof caseBodySchema>;

/** The largest report page accepted, as in reports/readers.ts (MAX_SOURCE_BYTES). */
export const MAX_REPORT_SOURCE_CHARS = 5 * 1024 * 1024;

/** POST /api/staff/reports: a report to read and save, or a page kept as a sample. */
export const reportsBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("import"),
      clientId,
      readerKey: z.string().regex(/^[a-z0-9_]{2,40}$/),
      // The text exactly as staff pasted or uploaded it: the server reads it again with the reader.
      source: z.string().min(2).max(MAX_REPORT_SOURCE_CHARS),
    })
    .strict(),
  z
    .object({
      action: z.literal("sample"),
      clientId,
      provider: z.string().regex(/^[a-z0-9_]{2,40}$/),
      text: z.string().min(1).max(MAX_REPORT_SOURCE_CHARS),
      fileName: z.string().max(200).nullable().optional(),
    })
    .strict(),
]);

export type ReportsBody = z.infer<typeof reportsBodySchema>;

/** The most rounds one send may hold. */
export const MAX_ROUNDS_PER_SEND = 50;

/** POST /api/staff/rounds. */
export const roundsBodySchema = z
  .object({
    rounds: z
      .array(z.object({ clientId, roundNumber: z.number().int().min(1).max(100) }).strict())
      .min(1)
      .max(MAX_ROUNDS_PER_SEND),
    /** "print": printed in the office and mailed by hand. */
    via: z.enum(["mail", "print"]),
    /** Letter id (as the console shows it) → class. */
    mailClasses: z.record(z.string().max(300), z.enum(["first_class", "certified", "certified_return_receipt"])).optional(),
  })
  .strict();

export type RoundsBody = z.infer<typeof roundsBodySchema>;
