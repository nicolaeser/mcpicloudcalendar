import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";
import { attendeeSchema, attendeesInput } from "./helpers.js";

export const inviteAttendees = defineTool(
  "icloud_invite_attendees",
  "Invite attendees",
  "Add attendees to a calendar event. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    attendees: z
      .array(attendeeSchema)
      .min(1)
      .describe("Attendees to add (email, optional cn/role/partstat/rsvp).")
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_invite_attendees");
      return ctx.client.inviteAttendees(input.calendarHref, input.uid, attendeesInput(input.attendees));
    })
);
