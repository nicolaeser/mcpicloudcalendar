import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";

export const moveEvent = defineTool(
  "icloud_move_event",
  "Move event",
  "Move a VEVENT to another calendar collection. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    destinationHref: calendarHrefField.describe("Destination calendar collection href.")
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_move_event");
      return ctx.client.moveEvent(input.calendarHref, input.uid, input.destinationHref);
    })
);
