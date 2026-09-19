import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { listPayload } from "../../mcp/format.js";

export const listCalendars = defineTool(
  "icloud_list_calendars",
  "List calendars",
  "List CalDAV calendars. components is usually VEVENT. iCloud event calendars reject VTODO (HTTP 403).",
  z.object({}),
  (ctx) =>
    runTool(ctx, async () => {
      const items = await ctx.client.listCalendars();
      return listPayload(items, { count: items.length });
    })
);
