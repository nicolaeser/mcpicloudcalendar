import { searchEvents } from "./search_events.js";
import { agenda } from "./agenda.js";
import { freebusy } from "./freebusy.js";
import { findConflicts } from "./find_conflicts.js";

export const tools = [searchEvents, agenda, freebusy, findConflicts];
