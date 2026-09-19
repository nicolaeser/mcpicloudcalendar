import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, eventUidField } from "../../mcp/format.js";
import { eventIcsPayload } from "./helpers.js";

export const getEventIcs = defineTool(
  "icloud_get_event_ics",
  "Get event ICS",
  "Return the raw iCalendar (ICS) body for a VEVENT.",
  z.object({
    calendarHref: calendarHrefField,
    uid: eventUidField
  }),
  (ctx, input) =>
    runTool(ctx, async () =>
      eventIcsPayload(input.uid, await ctx.client.getEventIcs(input.calendarHref, input.uid))
    )
);
