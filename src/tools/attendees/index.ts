import { listAttendees } from "./list_attendees.js";
import { inviteAttendees } from "./invite_attendees.js";
import { removeAttendee } from "./remove_attendee.js";
import { rsvp } from "./rsvp.js";

export const tools = [listAttendees, inviteAttendees, removeAttendee, rsvp];
