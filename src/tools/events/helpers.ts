import { z } from "zod";
import type {
  Alarm,
  Attendee,
  CalendarEvent,
  CreateEventInput,
  ObjectFilter,
  UpdateEventInput
} from "../../caldav/types.js";

export const summaryField = z.string().min(1).describe("Event summary.");

export const descriptionField = z.string().optional().describe("Event description.");

export const locationField = z.string().optional().describe("Event location.");

export const allDayField = z
  .boolean()
  .optional()
  .describe("When true, DTSTART/DTEND use VALUE=DATE.");

export const timezoneField = z.string().min(1).optional().describe("IANA time zone.");

export const statusField = z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED"]).optional();

export const transparencyField = z.enum(["OPAQUE", "TRANSPARENT"]).optional();

export const rruleField = z
  .string()
  .min(1)
  .optional()
  .describe("Raw RRULE value without the RRULE: prefix.");

export const categoriesField = z.array(z.string().min(1)).optional().describe("Event categories.");

export const limitField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Maximum number of events to return.");

export const offsetField = z.number().int().min(0).optional().describe("Number of events to skip.");

export const attendeeSchema = z.object({
  email: z.string().min(1).describe("Attendee email address."),
  cn: z.string().min(1).optional().describe("Common name."),
  role: z
    .enum(["REQ-PARTICIPANT", "OPT-PARTICIPANT", "NON-PARTICIPANT", "CHAIR"])
    .optional()
    .describe("iCalendar ROLE."),
  partstat: z
    .enum(["NEEDS-ACTION", "ACCEPTED", "DECLINED", "TENTATIVE", "DELEGATED"])
    .optional()
    .describe("iCalendar PARTSTAT."),
  rsvp: z.boolean().optional().describe("Whether a reply is requested.")
});

export const alarmSchema = z.object({
  action: z.enum(["DISPLAY", "AUDIO", "EMAIL"]).describe("VALARM ACTION."),
  trigger: z.string().min(1).describe("VALARM TRIGGER, e.g. -PT15M or an ISO datetime."),
  description: z.string().optional().describe("DISPLAY or EMAIL alarm description.")
});

export const attendeesField = z.array(attendeeSchema).optional();

export const alarmsField = z.array(alarmSchema).optional();

type EventAttendeeInput = {
  readonly email: string;
  readonly cn?: string | undefined;
  readonly role?: Attendee["role"] | undefined;
  readonly partstat?: Attendee["partstat"] | undefined;
  readonly rsvp?: boolean | undefined;
};

type EventAlarmInput = {
  readonly action: Alarm["action"];
  readonly trigger: string;
  readonly description?: string | undefined;
};

type EventWriteFields = {
  readonly summary?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly allDay?: boolean | undefined;
  readonly timezone?: string | undefined;
  readonly description?: string | undefined;
  readonly location?: string | undefined;
  readonly status?: CalendarEvent["status"] | undefined;
  readonly transparency?: CalendarEvent["transparency"] | undefined;
  readonly rrule?: string | undefined;
  readonly attendees?: readonly EventAttendeeInput[] | undefined;
  readonly alarms?: readonly EventAlarmInput[] | undefined;
  readonly categories?: readonly string[] | undefined;
};

export function attendeeInput(input: EventAttendeeInput): Attendee {
  return {
    email: input.email,
    ...(input.cn === undefined ? {} : { cn: input.cn }),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.partstat === undefined ? {} : { partstat: input.partstat }),
    ...(input.rsvp === undefined ? {} : { rsvp: input.rsvp })
  };
}

export function alarmInput(input: EventAlarmInput): Alarm {
  return {
    action: input.action,
    trigger: input.trigger,
    ...(input.description === undefined ? {} : { description: input.description })
  };
}

export function eventListFilter(input: {
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly expand?: boolean | undefined;
}): ObjectFilter {
  return {
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.end === undefined ? {} : { end: input.end }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.expand === undefined ? {} : { expand: input.expand })
  };
}

export function eventWritePatch(
  input: EventWriteFields
): Partial<Omit<CreateEventInput, "calendarHref" | "uid">> {
  return {
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.end === undefined ? {} : { end: input.end }),
    ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.transparency === undefined ? {} : { transparency: input.transparency }),
    ...(input.rrule === undefined ? {} : { rrule: input.rrule }),
    ...(input.attendees === undefined ? {} : { attendees: input.attendees.map(attendeeInput) }),
    ...(input.alarms === undefined ? {} : { alarms: input.alarms.map(alarmInput) }),
    ...(input.categories === undefined ? {} : { categories: input.categories })
  };
}

export function eventCreateInput(
  input: EventWriteFields & {
    readonly calendarHref: string;
    readonly summary: string;
    readonly start: string;
    readonly uid?: string | undefined;
  }
): CreateEventInput {
  return {
    calendarHref: input.calendarHref,
    summary: input.summary,
    start: input.start,
    ...eventWritePatch(input),
    ...(input.uid === undefined ? {} : { uid: input.uid })
  };
}

export function eventUpdateInput(
  input: EventWriteFields & {
    readonly calendarHref: string;
    readonly uid: string;
  }
): UpdateEventInput {
  return {
    calendarHref: input.calendarHref,
    uid: input.uid,
    ...eventWritePatch(input)
  };
}

export function eventDuplicateOverrides(input: {
  readonly summary?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
}): {
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
} {
  return {
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.end === undefined ? {} : { end: input.end })
  };
}

export function eventIcsPayload(
  uid: string,
  result: {
    readonly uid: string;
    readonly href: string;
    readonly ics: string;
    readonly etag?: string;
  }
): Record<string, unknown> {
  return {
    uid: result.uid,
    href: result.href,
    ...(result.etag === undefined ? {} : { etag: result.etag }),
    filename: `${uid}.ics`,
    mimeType: "text/calendar",
    base64Encoded: false,
    byteLength: result.ics.length,
    content: result.ics
  };
}
