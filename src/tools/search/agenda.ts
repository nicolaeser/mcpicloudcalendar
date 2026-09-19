import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { isoTimeField, listPayload } from "../../mcp/format.js";
import { optionalCalendarHrefField, timeWindowQuery } from "./helpers.js";

export const agenda = defineTool(
  "icloud_agenda",
  "Agenda",
  "Expand recurring VEVENTs into occurrences between start and end. Omit calendarHref to cover every calendar.",
  z.object({
    start: isoTimeField,
    end: isoTimeField,
    calendarHref: optionalCalendarHrefField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const query = timeWindowQuery(input);
      const items = await ctx.client.agenda(query);
      return listPayload(items, {
        count: items.length,
        start: query.start,
        end: query.end,
        ...(query.calendarHref === undefined ? {} : { calendarHref: query.calendarHref })
      });
    })
);
