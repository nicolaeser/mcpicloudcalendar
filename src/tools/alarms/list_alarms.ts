import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, eventUidField, listPayload } from "../../mcp/format.js";

export const listAlarms = defineTool(
  "icloud_list_alarms",
  "List alarms",
  "List VALARM entries on a calendar event.",
  z.object({
    calendarHref: calendarHrefField,
    uid: eventUidField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const items = await ctx.client.listAlarms(input.calendarHref, input.uid);
      return listPayload(items, { count: items.length });
    })
);
