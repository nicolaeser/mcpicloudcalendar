import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import {
  calendarHrefField,
  confirmField,
  eventUidField,
  isoTimeField,
  requireConfirm
} from "../../mcp/format.js";
import { eventDuplicateOverrides, summaryField } from "./helpers.js";

export const duplicateEvent = defineTool(
  "icloud_duplicate_event",
  "Duplicate event",
  "Copy a VEVENT with a new UID. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    summary: summaryField.optional(),
    start: isoTimeField.optional(),
    end: isoTimeField.optional()
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_duplicate_event");
      return ctx.client.duplicateEvent(
        input.calendarHref,
        input.uid,
        eventDuplicateOverrides(input)
      );
    })
);
