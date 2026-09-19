import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField } from "../../mcp/format.js";

export const getCtag = defineTool(
  "icloud_get_ctag",
  "Get ctag",
  "Return the CalDAV getctag for a calendar collection.",
  z.object({ href: calendarHrefField }),
  (ctx, input) => runTool(ctx, async () => ctx.client.getCtag(input.href))
);
