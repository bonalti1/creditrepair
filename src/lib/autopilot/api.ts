import { z } from "zod";
import { FOLLOWUP_KINDS } from "./types";

// POST /api/staff/autopilot. Nobody's name or role comes from the body: the
// route reads them from the caller's own staff row.
//
//   settings  the team's switches (autopilot.manage: an administrator)
//   hold      stop the automatic sending and reminders for one client, with a reason (rounds.send)
//   release   lift that hold (rounds.send)
//   opt_out   the client told a person they want no automatic messages (clients.followup)
//   opt_in    the client asked for them back, to a person (clients.followup)

const clientId = z.string().uuid();
const hour = z.number().int().min(0).max(23);

export const autopilotBodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("settings"),
      roundsEnabled: z.boolean().optional(),
      reviewWindowHours: z.number().int().min(1).max(168).optional(),
      followupsEnabled: z.boolean().optional(),
      followups: z.partialRecord(z.enum(FOLLOWUP_KINDS), z.boolean()).optional(),
      statusEnabled: z.boolean().optional(),
      quietStartHour: hour.optional(),
      quietEndHour: hour.optional(),
      dailyCap: z.number().int().min(1).max(5).optional(),
    })
    .strict(),
  z.object({ action: z.literal("hold"), clientId, reason: z.string().trim().min(3).max(500) }).strict(),
  z.object({ action: z.literal("release"), clientId }).strict(),
  z.object({ action: z.literal("opt_out"), clientId }).strict(),
  z.object({ action: z.literal("opt_in"), clientId }).strict(),
]);

export type AutopilotBody = z.infer<typeof autopilotBodySchema>;
