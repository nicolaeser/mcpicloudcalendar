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
  eventCreateInput,
  locationField,
  rruleField,
  statusField,
  summaryField,
  timezoneField,
  transparencyField
} from "./helpers.js";

export const createEvent = defineTool(
  "icloud_create_event",
  "Create event",
  "Create a VEVENT on a calendar. Requires confirm: true.",
  z.object({
    confirm: confirmField,
    calendarHref: calendarHrefField,
    summary: summaryField,
    start: isoTimeField,
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
    categories: categoriesField,
    uid: eventUidField.optional()
  }),
  (ctx, input) =>
    runTool(ctx, async () => {
      requireConfirm(input.confirm, "icloud_create_event");
      return ctx.client.createEvent(eventCreateInput(input));
    })
);
