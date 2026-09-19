import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, isoTimeField, listPayload } from "../../mcp/format.js";
import { conflictsQuery, optionalEventUidField } from "./helpers.js";

export const findConflicts = defineTool(
  "icloud_find_conflicts",
  "Find conflicts",
  "List VEVENTs in a calendar that overlap start/end. Pass uid to exclude that event.",
  z.object({
    calendarHref: calendarHrefField,
    start: isoTimeField,
    end: isoTimeField,
    uid: optionalEventUidField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      const query = conflictsQuery(input);
      const items = await ctx.client.findConflicts(query);
      return listPayload(items, {
        count: items.length,
        calendarHref: query.calendarHref,
        start: query.start,
        end: query.end,
        ...(query.uid === undefined ? {} : { uid: query.uid })
      });
    })
);
