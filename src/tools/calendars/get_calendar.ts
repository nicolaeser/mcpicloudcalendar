import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField } from "../../mcp/format.js";

export const getCalendar = defineTool(
  "icloud_get_calendar",
  "Get calendar",
  "Return a CalDAV calendar collection by href.",
  z.object({ href: calendarHrefField }),
  (ctx, input) => runTool(ctx, async () => ctx.client.getCalendar(input.href))
);
