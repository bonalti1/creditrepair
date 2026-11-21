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
