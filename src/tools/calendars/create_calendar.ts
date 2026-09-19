import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { confirmField, requireConfirm } from "../../mcp/format.js";
import {
  calendarCreateInput,
  colorField,
  componentsField,
  descriptionField,
  displayNameField
} from "./helpers.js";

export const createCalendar = defineTool(
  "icloud_create_calendar",
  "Create calendar",
  "Create a CalDAV calendar. iCloud event calendars are VEVENT-only. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    displayName: displayNameField,
    description: descriptionField,
    color: colorField,
    components: componentsField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_create_calendar");
      const requested = input.components ?? ["VEVENT"];
      const calendar = await ctx.client.createCalendar(calendarCreateInput(input));
      const missingVtodo = requested.includes("VTODO") && !calendar.components.includes("VTODO");
      return {
        ...calendar,
        requestedComponents: requested,
        ...(missingVtodo
          ? {
              note: "iCloud did not enable VTODO on this collection. Event calendars stay VEVENT-only."
            }
          : {})
      };
    })
);
