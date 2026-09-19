import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, eventUidField, isoTimeField, listPayload } from "../../mcp/format.js";

export const expandRecurrence = defineTool(
  "icloud_expand_recurrence",
  "Expand recurrence",
  "Expand a recurring VEVENT into concrete occurrences between start and end.",
  z.object({
    calendarHref: calendarHrefField,
    uid: eventUidField,
    start: isoTimeField,
    end: isoTimeField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const items = await ctx.client.expandRecurrence(
        input.calendarHref,
        input.uid,
        input.start,
        input.end
      );
      return listPayload(items, {
        count: items.length,
        calendarHref: input.calendarHref,
        uid: input.uid,
        start: input.start,
        end: input.end
      });
    })
);
