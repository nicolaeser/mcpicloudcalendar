import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";

export const removeAlarm = defineTool(
  "icloud_remove_alarm",
  "Remove alarm",
  "Remove a VALARM from a calendar event, matched by trigger and optional action. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    trigger: z.string().min(1).describe("VALARM TRIGGER, e.g. -PT15M or an ISO datetime."),
    action: z.enum(["DISPLAY", "AUDIO", "EMAIL"]).optional().describe("VALARM ACTION. Omit to match any action.")
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_remove_alarm");
      return input.action === undefined
        ? ctx.client.removeAlarm(input.calendarHref, input.uid, input.trigger)
        : ctx.client.removeAlarm(input.calendarHref, input.uid, input.trigger, input.action);
    })
);
