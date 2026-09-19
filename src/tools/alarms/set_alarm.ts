import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import { calendarHrefField, confirmField, eventUidField, requireConfirm } from "../../mcp/format.js";

export const setAlarm = defineTool(
  "icloud_set_alarm",
  "Set alarm",
  "Add or replace a VALARM on a calendar event, matched by trigger and action. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    action: z.enum(["DISPLAY", "AUDIO", "EMAIL"]).describe("VALARM ACTION."),
    trigger: z.string().min(1).describe("VALARM TRIGGER, e.g. -PT15M or an ISO datetime."),
    description: z.string().optional().describe("DISPLAY or EMAIL alarm description.")
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_set_alarm");
      return ctx.client.setAlarm(input.calendarHref, input.uid, {
        action: input.action,
        trigger: input.trigger,
        ...(input.description === undefined ? {} : { description: input.description })
      });
    })
);
