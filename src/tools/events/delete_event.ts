import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";

export const deleteEvent = defineTool(
  "icloud_delete_event",
  "Delete event",
  "Delete a VEVENT by UID. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_delete_event");
      return ctx.client.deleteEvent(input.calendarHref, input.uid);
    })
);
