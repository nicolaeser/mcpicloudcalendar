import { listCalendars } from "./list_calendars.js";
import { getCalendar } from "./get_calendar.js";
import { createCalendar } from "./create_calendar.js";
import { updateCalendar } from "./update_calendar.js";
import { deleteCalendar } from "./delete_calendar.js";
import { getCtag } from "./get_ctag.js";

export const tools = [
  listCalendars,
  getCalendar,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  getCtag
];
