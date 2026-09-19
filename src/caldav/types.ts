export interface CalendarCredentials {
  readonly email: string; // lowercased full address
  readonly password: string;
  readonly caldavUrl: string; // default https://caldav.icloud.com
  readonly username: string; // same as email
}

export interface CalDavVerifyResult {
  readonly ok: boolean;
  readonly url: string;
  readonly principalHref?: string;
}

export interface PrincipalInfo {
  readonly email: string;
  readonly principalHref: string;
  readonly calendarHomeHref: string;
  readonly displayName?: string;
}

export interface CalendarInfo {
  readonly href: string;
  readonly displayName: string;
  readonly description?: string;
  readonly color?: string; // #RRGGBB
  readonly ctag?: string;
  readonly syncToken?: string;
  readonly components: readonly ("VEVENT" | "VTODO" | "VJOURNAL")[];
  readonly readOnly: boolean;
}

export interface CreateCalendarInput {
  readonly displayName: string;
  readonly description?: string;
  readonly color?: string;
  readonly components?: readonly ("VEVENT" | "VTODO")[];
}

export interface UpdateCalendarInput {
  readonly displayName?: string;
  readonly description?: string;
  readonly color?: string;
}

export interface CalendarObject {
  readonly href: string;
  readonly etag?: string;
  readonly ics: string;
  readonly uid: string;
  readonly component: "VEVENT" | "VTODO" | "VJOURNAL";
}

export interface ObjectFilter {
  readonly component?: "VEVENT" | "VTODO";
  readonly start?: string; // ISO 8601
  readonly end?: string;
  readonly uid?: string;
  readonly text?: string;
  readonly limit?: number;
  readonly offset?: number;
  /** When start+end are set, expand RRULE into that window (list_events default). */
  readonly expand?: boolean;
}

export interface Attendee {
  readonly email: string;
  readonly cn?: string;
  readonly role?: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "NON-PARTICIPANT" | "CHAIR";
  readonly partstat?: "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE" | "DELEGATED";
  readonly rsvp?: boolean;
}

export interface Alarm {
  readonly action: "DISPLAY" | "AUDIO" | "EMAIL";
  readonly trigger: string; // e.g. -PT15M or ISO datetime
  readonly description?: string;
}

export interface CalendarEvent {
  readonly uid: string;
  readonly href: string;
  readonly etag?: string;
  readonly calendarHref: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: string; // ISO 8601 (date or date-time)
  readonly end?: string;
  readonly allDay: boolean;
  readonly timezone?: string; // IANA
  readonly status?: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  readonly transparency?: "OPAQUE" | "TRANSPARENT";
  readonly organizer?: Attendee;
  readonly attendees: readonly Attendee[];
  readonly alarms: readonly Alarm[];
  readonly rrule?: string; // raw RRULE value (without "RRULE:")
  readonly rdates?: readonly string[];
  readonly exdates?: readonly string[];
  readonly recurrenceId?: string;
  readonly url?: string;
  readonly categories?: readonly string[];
  readonly created?: string;
  readonly lastModified?: string;
}

export interface CreateEventInput {
  readonly calendarHref: string;
  readonly summary: string;
  readonly start: string;
  readonly end?: string;
  readonly allDay?: boolean;
  readonly timezone?: string;
  readonly description?: string;
  readonly location?: string;
  readonly status?: CalendarEvent["status"];
  readonly transparency?: CalendarEvent["transparency"];
  readonly attendees?: readonly Attendee[];
  readonly alarms?: readonly Alarm[];
  readonly rrule?: string;
  readonly categories?: readonly string[];
  readonly uid?: string;
}

export interface UpdateEventInput extends Partial<Omit<CreateEventInput, "calendarHref" | "uid">> {
  readonly calendarHref: string;
  readonly uid: string;
}

export interface Reminder {
  readonly uid: string;
  readonly href: string;
  readonly etag?: string;
  readonly calendarHref: string;
  readonly summary: string;
  readonly description?: string;
  readonly due?: string;
  readonly completed?: string;
  readonly percentComplete?: number;
  readonly priority?: number; // 0-9
  readonly status?: "NEEDS-ACTION" | "COMPLETED" | "IN-PROCESS" | "CANCELLED";
  readonly alarms: readonly Alarm[];
}

export interface CreateReminderInput {
  readonly calendarHref: string;
  readonly summary: string;
  readonly description?: string;
  readonly due?: string;
  readonly priority?: number;
  readonly alarms?: readonly Alarm[];
  readonly uid?: string;
}

export interface Occurrence {
  readonly uid: string;
  readonly recurrenceId: string;
  readonly start: string;
  readonly end?: string;
  readonly summary: string;
  readonly cancelled: boolean;
}

export interface FreeBusySlot {
  readonly start: string;
  readonly end: string;
  readonly busy: boolean;
  readonly calendarHref?: string;
  readonly uid?: string;
}

export interface FreeBusyResult {
  readonly start: string;
  readonly end: string;
  readonly slots: readonly FreeBusySlot[];
}

export interface SyncResult {
  readonly href: string;
  readonly syncToken: string;
  readonly created: readonly CalendarObject[];
  readonly updated: readonly CalendarObject[];
  readonly deleted: readonly string[]; // hrefs
  readonly reset?: boolean;
}

export interface CalDavDriver {
  verify(): Promise<CalDavVerifyResult>;
  principal(): Promise<PrincipalInfo>;
  listCalendars(): Promise<readonly CalendarInfo[]>;
  getCalendar(href: string): Promise<CalendarInfo>;
  createCalendar(input: CreateCalendarInput): Promise<CalendarInfo>;
  updateCalendar(href: string, patch: UpdateCalendarInput): Promise<CalendarInfo>;
  deleteCalendar(href: string): Promise<{ readonly deleted: true; readonly href: string }>;
  queryObjects(calendarHref: string, filter: ObjectFilter): Promise<readonly CalendarObject[]>;
  getObject(href: string): Promise<CalendarObject>;
  putObject(href: string, ics: string, etag?: string): Promise<CalendarObject>;
  moveObject(fromHref: string, toHref: string, etag?: string): Promise<CalendarObject>;
  deleteObject(href: string, etag?: string): Promise<{ readonly deleted: true; readonly href: string }>;
  sync(calendarHref: string, syncToken?: string): Promise<SyncResult>;
  dispose?(): void;
}

export class CalendarAccountError extends Error {
  public readonly code: string;
  public constructor(message: string, code = "calendar_error") {
    super(message);
    this.name = "CalendarAccountError";
    this.code = code;
  }
}
