import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, requireConfirm } from "../../mcp/format.js";

export const deleteCalendar = defineTool(
  "icloud_delete_calendar",
  "Delete calendar",
  "Delete a CalDAV calendar collection. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    href: calendarHrefField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_delete_calendar");
      return ctx.client.deleteCalendar(input.href);
    })
);
