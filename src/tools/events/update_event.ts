import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";
import {
  calendarHrefField,
  confirmField,
  eventUidField,
  isoTimeField,
  requireConfirm
} from "../../mcp/format.js";
import {
  alarmsField,
  allDayField,
  attendeesField,
  categoriesField,
  descriptionField,
  eventUpdateInput,
  locationField,
  rruleField,
  statusField,
  summaryField,
  timezoneField,
  transparencyField
} from "./helpers.js";

export const updateEvent = defineTool(
  "icloud_update_event",
  "Update event",
  "Update a VEVENT. Unspecified fields are left unchanged. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    uid: eventUidField,
    summary: summaryField.optional(),
    start: isoTimeField.optional(),
    end: isoTimeField.optional(),
    allDay: allDayField,
    timezone: timezoneField,
    description: descriptionField,
    location: locationField,
    status: statusField,
    transparency: transparencyField,
    rrule: rruleField,
    attendees: attendeesField,
    alarms: alarmsField,
    categories: categoriesField
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_update_event");
      return ctx.client.updateEvent(eventUpdateInput(input));
    })
);
