import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, eventUidField } from "../../mcp/format.js";

export const getEvent = defineTool(
  "icloud_get_event",
  "Get event",
  "Return a VEVENT by calendar href and UID.",
  z.object({
    calendarHref: calendarHrefField,
    uid: eventUidField
  }),
  (ctx, input) => runTool(ctx, async () => ctx.client.getEvent(input.calendarHref, input.uid))
);
