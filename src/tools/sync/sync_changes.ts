import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField } from "../../mcp/format.js";

export const syncChanges = defineTool(
  "icloud_sync_changes",
  "Sync changes",
  "Incremental CalDAV sync-collection. Pass the previous syncToken to get created/updated/deleted hrefs. Omit token for a full baseline.",
  z.object({
    calendarHref: calendarHrefField,
    syncToken: z
      .string()
      .min(1)
      .optional()
      .describe("Previous CalDAV sync-token. Omit for a full baseline.")
  }),
  (ctx, input) =>
    runTool(ctx, async () =>
      input.syncToken === undefined
        ? ctx.client.syncChanges(input.calendarHref)
        : ctx.client.syncChanges(input.calendarHref, input.syncToken)
    )
);
