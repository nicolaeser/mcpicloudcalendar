import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, isoTimeField, listPayload } from "../../mcp/format.js";
import { eventListFilter, limitField, offsetField } from "./helpers.js";

export const listEvents = defineTool(
  "icloud_list_events",
  "List events",
  "List VEVENTs on a calendar. When start and end are set, recurring series are expanded into that window (set expand:false for master events only).",
  z.object({
    calendarHref: calendarHrefField,
    start: isoTimeField.optional(),
    end: isoTimeField.optional(),
    expand: z
      .boolean()
      .optional()
      .describe("Default true when start and end are set. False returns master events with rrule."),
    limit: limitField,
    offset: offsetField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const filter = eventListFilter({
        start: input.start,
        end: input.end,
        expand: input.expand,
        limit: input.limit,
        offset: input.offset
      });
      const items = await ctx.client.listEvents(input.calendarHref, filter);
      return listPayload(items, {
        count: items.length,
        ...(filter.limit === undefined ? {} : { limit: filter.limit }),
        ...(filter.offset === undefined ? {} : { offset: filter.offset }),
        calendarHref: input.calendarHref,
        ...(filter.start === undefined ? {} : { start: filter.start }),
        ...(filter.end === undefined ? {} : { end: filter.end })
      });
    })
);
