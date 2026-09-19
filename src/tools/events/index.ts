import { listEvents } from "./list_events.js";
import { getEvent } from "./get_event.js";
import { getEventIcs } from "./get_event_ics.js";
import { createEvent } from "./create_event.js";
import { updateEvent } from "./update_event.js";
import { deleteEvent } from "./delete_event.js";
import { moveEvent } from "./move_event.js";
import { duplicateEvent } from "./duplicate_event.js";

export const tools = [
  listEvents,
  getEvent,
  getEventIcs,
  createEvent,
  updateEvent,
  deleteEvent,
  moveEvent,
  duplicateEvent
];
