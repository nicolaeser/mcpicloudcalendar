import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";
import { attendeeEmailField, attendeePartstatField } from "./helpers.js";

export const rsvp = defineTool(
  "icloud_rsvp",
  "RSVP",
  "Set an attendee's PARTSTAT on a calendar event. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    email: attendeeEmailField,
    partstat: attendeePartstatField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_rsvp");
      return ctx.client.rsvp(input.calendarHref, input.uid, input.email, input.partstat);
    })
);
