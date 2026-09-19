import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { listPayload } from "../../mcp/format.js";
import {
  limitField,
  offsetField,
  optionalCalendarHrefField,
  optionalIsoTimeField,
  searchEventsQuery,
  textField
} from "./helpers.js";

export const searchEvents = defineTool(
  "icloud_search_events",
  "Search events",
  "Search VEVENTs by text and optional time window. Omit calendarHref to search every calendar.",
  z.object({
    text: textField,
    start: optionalIsoTimeField,
    end: optionalIsoTimeField,
    calendarHref: optionalCalendarHrefField,
    limit: limitField,
    offset: offsetField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const query = searchEventsQuery(input);
      const items = await ctx.client.searchEvents(query);
      return listPayload(items, {
        count: items.length,
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.start === undefined ? {} : { start: query.start }),
        ...(query.end === undefined ? {} : { end: query.end }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
        ...(query.calendarHref === undefined ? {} : { calendarHref: query.calendarHref })
      });
    })
);
