import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, requireConfirm } from "../../mcp/format.js";
import { calendarPatch, colorField, descriptionField, displayNameField } from "./helpers.js";

export const updateCalendar = defineTool(
  "icloud_update_calendar",
  "Update calendar",
  "Update a CalDAV calendar display name, description, or color. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    href: calendarHrefField,
    displayName: displayNameField.optional(),
    description: descriptionField,
    color: colorField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_update_calendar");
      return ctx.client.updateCalendar(input.href, calendarPatch(input));
    })
);
