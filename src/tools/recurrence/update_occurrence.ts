import { z } from "zod";
import type { UpdateOccurrencePatch } from "../../caldav/client.js";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import {
  calendarHrefField,
  confirmField,
  eventUidField,
  isoTimeField,
  requireConfirm
} from "../../mcp/format.js";
import { descriptionField, locationField, summaryField } from "../events/helpers.js";

export const updateOccurrence = defineTool(
  "icloud_update_occurrence",
  "Update occurrence",
  "Create or replace a single occurrence exception (RECURRENCE-ID). Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    recurrenceId: isoTimeField.describe(
      "Instance DTSTART as RECURRENCE-ID. ISO-8601 or compact ICS (20260927T080000Z). Must match the series instance, not the patched start."
    ),
    summary: summaryField.optional(),
    start: isoTimeField.optional(),
    end: isoTimeField.optional(),
    description: descriptionField,
    location: locationField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_update_occurrence");
      return ctx.client.updateOccurrence(
        input.calendarHref,
        input.uid,
        input.recurrenceId,
        occurrencePatch(input)
      );
    })
);

function occurrencePatch(input: {
  readonly summary?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly description?: string | undefined;
  readonly location?: string | undefined;
}): UpdateOccurrencePatch {
  return {
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.end === undefined ? {} : { end: input.end }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location })
  };
}
