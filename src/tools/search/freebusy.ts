import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { isoTimeField, listPayload } from "../../mcp/format.js";
import { optionalCalendarHrefField, timeWindowQuery } from "./helpers.js";

export const freebusy = defineTool(
  "icloud_freebusy",
  "Free/busy",
  "Return busy slots between start and end. Omit calendarHref to consider every calendar.",
  z.object({
    start: isoTimeField,
    end: isoTimeField,
    calendarHref: optionalCalendarHrefField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const query = timeWindowQuery(input);
      const result = await ctx.client.freebusy(query);
      return listPayload(result.slots, {
        start: result.start,
        end: result.end,
        count: result.slots.length,
        ...(query.calendarHref === undefined ? {} : { calendarHref: query.calendarHref })
      });
    })
);
