import { z } from "zod";
import type { Attendee } from "../../caldav/types.js";

export const attendeeEmailField = z.string().min(1).describe("Attendee email address.");

export const attendeeRoleField = z
  .enum(["REQ-PARTICIPANT", "OPT-PARTICIPANT", "NON-PARTICIPANT", "CHAIR"])
  .describe("iCalendar ROLE.");

export const attendeePartstatField = z
  .enum(["NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"])
  .describe("iCalendar PARTSTAT.");

export const attendeeSchema = z.object({
  email: attendeeEmailField,
  cn: z.string().min(1).optional().describe("Common name."),
  role: attendeeRoleField.optional(),
  partstat: attendeePartstatField.optional(),
  rsvp: z.boolean().optional().describe("Whether a reply is requested.")
});

export function attendeeInput(input: z.infer<typeof attendeeSchema>): Attendee {
  return {
    email: input.email,
    ...(input.cn === undefined ? {} : { cn: input.cn }),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.partstat === undefined ? {} : { partstat: input.partstat }),
    ...(input.rsvp === undefined ? {} : { rsvp: input.rsvp })
  };
}

export function attendeesInput(attendees: ReadonlyArray<z.infer<typeof attendeeSchema>>): Attendee[] {
  return attendees.map(attendeeInput);
}
