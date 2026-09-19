import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";
import { attendeeEmailField } from "./helpers.js";

export const removeAttendee = defineTool(
  "icloud_remove_attendee",
  "Remove attendee",
  "Remove an attendee from a calendar event by email. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    email: attendeeEmailField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_remove_attendee");
      return ctx.client.removeAttendee(input.calendarHref, input.uid, input.email);
    })
);
