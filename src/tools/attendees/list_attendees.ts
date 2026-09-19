import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, eventUidField, listPayload } from "../../mcp/format.js";

export const listAttendees = defineTool(
  "icloud_list_attendees",
  "List attendees",
  "List attendees on a calendar event.",
  z.object({
    calendarHref: calendarHrefField,
    uid: eventUidField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const items = await ctx.client.listAttendees(input.calendarHref, input.uid);
      return listPayload(items, { count: items.length });
    })
);
