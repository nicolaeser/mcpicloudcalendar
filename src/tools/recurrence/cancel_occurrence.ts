import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import {
  calendarHrefField,
  confirmField,
  eventUidField,
  isoTimeField,
  requireConfirm
} from "../../mcp/format.js";

export const cancelOccurrence = defineTool(
  "icloud_cancel_occurrence",
  "Cancel occurrence",
  "Cancel a single occurrence of a recurring event (EXDATE or cancelled exception). Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    recurrenceId: isoTimeField.describe("RECURRENCE-ID of the occurrence.")
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_cancel_occurrence");
      return ctx.client.cancelOccurrence(input.calendarHref, input.uid, input.recurrenceId);
    })
);
