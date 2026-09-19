import { randomUUID } from "node:crypto";
import { HttpCalDavDriver } from "./driver.js";
import {
  eventFromCreate,
  generateEvent,
  generateEventSet,
  generateReminder,
  parseCalendar,
  parseEvent,
  parseReminder,
  reminderFromCreate,
  unfoldIcs
} from "./ics.js";
import { calendarObjectHref } from "./icloud.js";
import { expandRRule } from "./rrule.js";
import {
  CalendarAccountError,
  type Alarm,
  type Attendee,
  type CalendarCredentials,
  type CalendarEvent,
  type CalendarInfo,
  type CalendarObject,
  type CalDavDriver,
  type CalDavVerifyResult,
  type CreateCalendarInput,
  type CreateEventInput,
  type CreateReminderInput,
  type FreeBusyResult,
  type FreeBusySlot,
  type ObjectFilter,
  type Occurrence,
  type PrincipalInfo,
  type Reminder,
  type SyncResult,
  type UpdateCalendarInput,
  type UpdateEventInput
} from "./types.js";

const OCCURRENCE_CAP = 400;

export interface CalendarAccountOptions extends CalendarCredentials {
  readonly driver?: CalDavDriver;
}

export type CalendarClientFactory = (options: CalendarAccountOptions) => CalendarAccountClient;

export const defaultClientFactory: CalendarClientFactory = (options) =>
  new CalendarAccountClient(options);

export interface SearchEventsInput {
  readonly text?: string;
  readonly start?: string;
  readonly end?: string;
  readonly calendarHref?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AgendaInput {
  readonly start: string;
  readonly end: string;
  readonly calendarHref?: string;
}

export interface FreeBusyInput {
  readonly start: string;
  readonly end: string;
  readonly calendarHref?: string;
}

export interface FindConflictsInput {
  readonly calendarHref: string;
  readonly start: string;
  readonly end: string;
  readonly uid?: string;
}

export interface ListRemindersInput {
  readonly calendarHref?: string;
  readonly dueBefore?: string;
  readonly dueAfter?: string;
  readonly text?: string;
  readonly undated?: boolean;
  readonly status?: Reminder["status"];
}

export interface DuplicateEventOverrides {
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
  readonly description?: string;
  readonly location?: string;
}

export interface UpdateOccurrencePatch {
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
  readonly description?: string;
  readonly location?: string;
  readonly status?: CalendarEvent["status"];
}

export interface UpdateReminderPatch {
  readonly summary?: string;
  readonly description?: string;
  readonly due?: string;
  readonly priority?: number;
  readonly alarms?: readonly Alarm[];
  readonly status?: Reminder["status"];
  readonly percentComplete?: number;
  readonly completed?: string;
}

export class CalendarAccountClient {
  private readonly credentials: CalendarCredentials;
  private readonly driver: CalDavDriver;

  public constructor(options: CalendarAccountOptions) {
    const { driver, ...credentials } = options;
    this.credentials = credentials;
    this.driver = driver ?? new HttpCalDavDriver(credentials);
  }

  public whoami(): Omit<CalendarCredentials, "password"> {
    return {
      email: this.credentials.email,
      username: this.credentials.username,
      caldavUrl: this.credentials.caldavUrl
    };
  }

  public verify(): Promise<CalDavVerifyResult> {
    return this.driver.verify();
  }

  public getPrincipal(): Promise<PrincipalInfo> {
    return this.driver.principal();
  }

  public listCalendars(): Promise<readonly CalendarInfo[]> {
    return this.driver.listCalendars();
  }

  public getCalendar(href: string): Promise<CalendarInfo> {
    return this.driver.getCalendar(href);
  }

  public createCalendar(input: CreateCalendarInput): Promise<CalendarInfo> {
    return this.driver.createCalendar(input);
  }

  public updateCalendar(href: string, patch: UpdateCalendarInput): Promise<CalendarInfo> {
    return this.driver.updateCalendar(href, patch);
  }

  public deleteCalendar(href: string): Promise<{ readonly deleted: true; readonly href: string }> {
    return this.driver.deleteCalendar(href);
  }

  public async listEvents(
    calendarHref: string,
    filter: ObjectFilter = {}
  ): Promise<readonly CalendarEvent[]> {
    const expand = filter.expand !== false && filter.start !== undefined && filter.end !== undefined;
    if (expand) {
      const instances = this.collectExpanded(
        await this.queryQuiet(
          withSlash(calendarHref),
          makeFilter({
            component: "VEVENT",
            start: filter.start,
            end: filter.end,
            uid: filter.uid,
            text: filter.text
          })
        ),
        calendarHref,
        filter.start,
        filter.end,
        false
      );
      return paginate(instances, filter.offset, filter.limit);
    }
    const objects = await this.queryQuiet(
      withSlash(calendarHref),
      makeFilter({
        component: "VEVENT",
        start: filter.start,
        end: filter.end,
        uid: filter.uid,
        text: filter.text
      })
    );
    const events = objects
      .filter((object) => object.component === "VEVENT")
      .map((object) => this.hydrateEvent(object, calendarHref));
    return paginate(events, filter.offset, filter.limit);
  }

  public async getEvent(calendarHref: string, uid: string): Promise<CalendarEvent> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    return this.hydrateEvent(object, calendarHref);
  }

  public async getEventIcs(
    calendarHref: string,
    uid: string
  ): Promise<{ readonly uid: string; readonly href: string; readonly ics: string; readonly etag?: string }> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const result: { uid: string; href: string; ics: string; etag?: string } = {
      uid: object.uid,
      href: object.href,
      ics: object.ics
    };
    if (object.etag !== undefined) result.etag = object.etag;
    return result;
  }

  public async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const uid = input.uid !== undefined && input.uid.length > 0 ? input.uid : randomUUID();
    const href = calendarObjectHref(input.calendarHref, uid);
    const event = eventFromCreate(input, uid, href);
    const stored = await this.driver.putObject(href, generateEvent(event));
    return this.hydrateEvent(stored, input.calendarHref);
  }

  public async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const object = await this.findObject(input.calendarHref, input.uid, "VEVENT");
    const current = this.hydrateEvent(object, input.calendarHref);
    const next = copyDefined(current, {
      summary: input.summary,
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      timezone: input.timezone,
      description: input.description,
      location: input.location,
      status: input.status,
      transparency: input.transparency,
      attendees: input.attendees,
      alarms: input.alarms,
      rrule: input.rrule,
      categories: input.categories
    });
    const stored = await this.writeMasterEvent(object, next);
    return this.hydrateEvent(stored, input.calendarHref);
  }

  public async deleteEvent(
    calendarHref: string,
    uid: string
  ): Promise<{ readonly deleted: true; readonly href: string; readonly uid: string }> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const deleted = await this.driver.deleteObject(object.href, object.etag);
    return { deleted: true, href: deleted.href, uid };
  }

  public async moveEvent(fromHref: string, uid: string, toHref: string): Promise<CalendarEvent> {
    const object = await this.findObject(fromHref, uid, "VEVENT");
    const destHref = calendarObjectHref(toHref, uid);
    const stored = await this.driver.moveObject(object.href, destHref, object.etag);
    return this.hydrateEvent(stored, toHref);
  }

  public async duplicateEvent(
    calendarHref: string,
    uid: string,
    overrides: DuplicateEventOverrides = {}
  ): Promise<CalendarEvent> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const current = this.hydrateEvent(object, calendarHref);
    const newUid = randomUUID();
    const href = calendarObjectHref(calendarHref, newUid);
    const copy = copyDefined(withoutEtag({ ...current, uid: newUid, href }), overrides);
    const stored = await this.driver.putObject(href, generateEvent(copy));
    return this.hydrateEvent(stored, calendarHref);
  }

  public async searchEvents(input: SearchEventsInput): Promise<readonly CalendarEvent[]> {
    const calendars = await this.calendarsFor(input.calendarHref, "VEVENT");
    const events: CalendarEvent[] = [];
    for (const calendar of calendars) {
      const objects = await this.driver.queryObjects(
        withSlash(calendar.href),
        makeFilter({
          component: "VEVENT",
          start: input.start,
          end: input.end,
          text: input.text
        })
      );
      for (const object of objects) {
        if (object.component !== "VEVENT") continue;
        const event = this.hydrateEvent(object, calendar.href);
        if (input.text !== undefined && input.text.length > 0 && !eventMatchesText(event, input.text)) {
          continue;
        }
        const recurring = event.rrule !== undefined && event.rrule.length > 0;
        if (
          !recurring &&
          !windowAllows(event.start, event.end ?? event.start, event.allDay, input.start, input.end)
        ) {
          continue;
        }
        events.push(event);
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return paginate(events, input.offset, input.limit);
  }

  public async agenda(input: AgendaInput): Promise<readonly CalendarEvent[]> {
    const calendars = await this.calendarsFor(input.calendarHref, "VEVENT");
    const instances: CalendarEvent[] = [];
    for (const calendar of calendars) {
      const objects = await this.queryQuiet(
        withSlash(calendar.href),
        makeFilter({ component: "VEVENT", start: input.start, end: input.end })
      );
      for (const object of objects) {
        if (object.component !== "VEVENT") continue;
        instances.push(...this.expandObjectToEvents(object, calendar.href, input.start, input.end, false));
      }
    }
    instances.sort((a, b) => a.start.localeCompare(b.start));
    return instances;
  }

  public async freebusy(input: FreeBusyInput): Promise<FreeBusyResult> {
    const instances = await this.agenda(input);
    const slots: FreeBusySlot[] = [];
    for (const event of instances) {
      if (event.transparency === "TRANSPARENT" || event.status === "CANCELLED") continue;
      const slot: FreeBusySlot = {
        start: event.start,
        end: event.end ?? event.start,
        busy: true,
        calendarHref: event.calendarHref,
        uid: event.uid
      };
      slots.push(slot);
    }
    slots.sort((a, b) => a.start.localeCompare(b.start));
    return { start: input.start, end: input.end, slots };
  }

  public async findConflicts(input: FindConflictsInput): Promise<readonly CalendarEvent[]> {
    const instances = await this.agenda({
      start: input.start,
      end: input.end,
      calendarHref: input.calendarHref
    });
    return instances.filter((event) => {
      if (input.uid !== undefined && event.uid === input.uid) return false;
      if (event.transparency === "TRANSPARENT" || event.status === "CANCELLED") return false;
      return overlapsRange(event.start, event.end ?? event.start, event.allDay, input.start, input.end);
    });
  }

  public async expandRecurrence(
    calendarHref: string,
    uid: string,
    start: string,
    end: string
  ): Promise<readonly Occurrence[]> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    return this.expandObjectToOccurrences(object, calendarHref, start, end, true);
  }

  public async updateOccurrence(
    calendarHref: string,
    uid: string,
    recurrenceId: string,
    patch: UpdateOccurrencePatch
  ): Promise<CalendarEvent> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const events = this.parseEventComponents(object, calendarHref);
    const master = masterEvent(events);
    if (master === undefined) {
      throw new CalendarAccountError(`Event ${uid} not found`, "not_found");
    }
    const rid = occurrenceKey(recurrenceId);
    const existing = events.find(
      (event) => event.recurrenceId !== undefined && occurrenceKey(event.recurrenceId) === rid
    );
    const occ = expandEventOccurrences(master, "1970-01-01", "2100-01-01").find(
      (item) => occurrenceKey(item.recurrenceId) === rid
    );
    if (existing === undefined && occ === undefined) {
      throw new CalendarAccountError(
        `No occurrence ${recurrenceId} in series ${uid}. Pass the instance DTSTART (ISO or compact ICS, with Z).`,
        "not_found"
      );
    }
    const base =
      existing ??
      instanceFromOccurrence(master, occ as Occurrence);
    const exception = copyDefined(withoutRecurrenceRule({ ...base, recurrenceId: occ?.recurrenceId ?? rid }), patch);
    const stored = await this.writeException(object, master, exception);
    return this.hydrateEvent(stored, calendarHref);
  }

  public async cancelOccurrence(
    calendarHref: string,
    uid: string,
    recurrenceId: string
  ): Promise<CalendarEvent> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const events = this.parseEventComponents(object, calendarHref);
    const master = masterEvent(events);
    if (master === undefined) {
      throw new CalendarAccountError(`Event ${uid} not found`, "not_found");
    }
    const exdates = uniqueDates([...(master.exdates ?? []), recurrenceId]);
    const nextMaster = copyDefined(master, { exdates });
    const remaining = events.filter(
      (event) => event.recurrenceId !== undefined && event.recurrenceId !== recurrenceId
    );
    const cancelled: CalendarEvent = {
      ...withoutRecurrenceRule({ ...master, recurrenceId }),
      status: "CANCELLED"
    };
    const stored = await this.putEventSet(object, nextMaster, [...remaining, cancelled]);
    return this.hydrateEvent(stored, calendarHref);
  }

  public async listAttendees(calendarHref: string, uid: string): Promise<readonly Attendee[]> {
    const event = await this.getEvent(calendarHref, uid);
    return event.attendees;
  }

  public async inviteAttendees(
    calendarHref: string,
    uid: string,
    attendees: readonly Attendee[]
  ): Promise<CalendarEvent> {
    if (attendees.length === 0) return this.getEvent(calendarHref, uid);
    return this.mutateEvent(calendarHref, uid, (event) => {
      const byEmail = new Map(event.attendees.map((attendee) => [attendee.email.toLowerCase(), attendee]));
      for (const attendee of attendees) {
        const key = attendee.email.toLowerCase();
        const existing = byEmail.get(key);
        byEmail.set(key, existing === undefined ? attendee : copyDefined(existing, attendee));
      }
      return { ...event, attendees: [...byEmail.values()] };
    });
  }

  public async removeAttendee(calendarHref: string, uid: string, email: string): Promise<CalendarEvent> {
    const needle = email.toLowerCase();
    return this.mutateEvent(calendarHref, uid, (event) => ({
      ...event,
      attendees: event.attendees.filter((attendee) => attendee.email.toLowerCase() !== needle)
    }));
  }

  public async rsvp(
    calendarHref: string,
    uid: string,
    email: string,
    partstat: NonNullable<Attendee["partstat"]>
  ): Promise<CalendarEvent> {
    const needle = email.toLowerCase();
    return this.mutateEvent(calendarHref, uid, (event) => {
      const attendees = event.attendees.map((attendee) =>
        attendee.email.toLowerCase() === needle ? { ...attendee, partstat } : attendee
      );
      if (!attendees.some((attendee) => attendee.email.toLowerCase() === needle)) {
        attendees.push({ email, partstat });
      }
      return { ...event, attendees };
    });
  }

  public async listAlarms(calendarHref: string, uid: string): Promise<readonly Alarm[]> {
    const event = await this.getEvent(calendarHref, uid);
    return event.alarms;
  }

  public async setAlarm(calendarHref: string, uid: string, alarm: Alarm): Promise<CalendarEvent> {
    return this.mutateEvent(calendarHref, uid, (event) => {
      const alarms = event.alarms.filter(
        (existing) => existing.trigger !== alarm.trigger || existing.action !== alarm.action
      );
      alarms.push(alarm);
      return { ...event, alarms };
    });
  }

  public async removeAlarm(
    calendarHref: string,
    uid: string,
    trigger: string,
    action?: Alarm["action"]
  ): Promise<CalendarEvent> {
    return this.mutateEvent(calendarHref, uid, (event) => ({
      ...event,
      alarms: event.alarms.filter((alarm) => {
        if (alarm.trigger !== trigger) return true;
        if (action === undefined) return false;
        return alarm.action !== action;
      })
    }));
  }

  public async listReminders(input: ListRemindersInput = {}): Promise<readonly Reminder[]> {
    const calendars = await this.calendarsFor(input.calendarHref, "VTODO");
    const reminders: Reminder[] = [];
    for (const calendar of calendars) {
      const objects = await this.queryQuiet(
        withSlash(calendar.href),
        makeFilter({ component: "VTODO" })
      );
      for (const object of objects) {
        if (object.component !== "VTODO") continue;
        const reminder = this.hydrateReminder(object, calendar.href);
        if (input.undated === true && reminder.due !== undefined) continue;
        if (input.status !== undefined && reminder.status !== input.status) continue;
        if (input.text !== undefined && input.text.length > 0 && !reminderMatchesText(reminder, input.text)) {
          continue;
        }
        if (!dueInRange(reminder.due, input.dueAfter, input.dueBefore)) continue;
        reminders.push(reminder);
      }
    }
    reminders.sort((a, b) => {
      if (a.due === undefined && b.due === undefined) return a.summary.localeCompare(b.summary);
      if (a.due === undefined) return 1;
      if (b.due === undefined) return -1;
      return a.due.localeCompare(b.due);
    });
    return reminders;
  }

  public async searchReminders(input: ListRemindersInput): Promise<readonly Reminder[]> {
    return this.listReminders(input);
  }

  public async undated(calendarHref?: string): Promise<readonly Reminder[]> {
    return this.listReminders({
      undated: true,
      ...(calendarHref === undefined ? {} : { calendarHref }),
      status: "NEEDS-ACTION"
    });
  }

  public async inbox(calendarHref?: string): Promise<readonly Reminder[]> {
    return this.listReminders({
      ...(calendarHref === undefined ? {} : { calendarHref }),
      status: "NEEDS-ACTION"
    });
  }

  public async today(calendarHref?: string): Promise<readonly Reminder[]> {
    const day = utcDateOnly(new Date());
    const next = utcDateOnly(new Date(Date.now() + 86_400_000));
    return this.listReminders({
      ...(calendarHref === undefined ? {} : { calendarHref }),
      dueAfter: `${day}T00:00:00Z`,
      dueBefore: `${next}T00:00:00Z`
    });
  }

  public async overdue(calendarHref?: string): Promise<readonly Reminder[]> {
    const day = utcDateOnly(new Date());
    const open = await this.listReminders({
      ...(calendarHref === undefined ? {} : { calendarHref }),
      dueBefore: `${day}T00:00:00Z`
    });
    return open.filter((reminder) => reminder.status !== "COMPLETED" && reminder.due !== undefined);
  }

  public async uncompleteReminder(calendarHref: string, uid: string): Promise<Reminder> {
    return this.mutateReminder(calendarHref, uid, (reminder) => {
      const next: Reminder = {
        uid: reminder.uid,
        href: reminder.href,
        calendarHref: reminder.calendarHref,
        summary: reminder.summary,
        alarms: reminder.alarms,
        status: "NEEDS-ACTION"
      };
      return copyDefined(next, {
        etag: reminder.etag,
        description: reminder.description,
        due: reminder.due,
        priority: reminder.priority
      });
    });
  }

  public async getReminder(calendarHref: string, uid: string): Promise<Reminder> {
    const object = await this.findObject(calendarHref, uid, "VTODO");
    return this.hydrateReminder(object, calendarHref);
  }

  public async createReminder(input: CreateReminderInput): Promise<Reminder> {
    const uid = input.uid !== undefined && input.uid.length > 0 ? input.uid : randomUUID();
    const href = calendarObjectHref(input.calendarHref, uid);
    const reminder = reminderFromCreate(input, uid, href);
    const stored = await this.driver.putObject(href, generateReminder(reminder));
    return this.hydrateReminder(stored, input.calendarHref);
  }

  public async updateReminder(
    calendarHref: string,
    uid: string,
    patch: UpdateReminderPatch
  ): Promise<Reminder> {
    return this.mutateReminder(calendarHref, uid, (reminder) => copyDefined(reminder, patch));
  }

  public async completeReminder(
    calendarHref: string,
    uid: string,
    completed?: string
  ): Promise<Reminder> {
    const completedAt = completed !== undefined && completed.length > 0 ? completed : utcNow();
    return this.mutateReminder(calendarHref, uid, (reminder) =>
      copyDefined(reminder, {
        status: "COMPLETED",
        percentComplete: 100,
        completed: completedAt
      })
    );
  }

  public async deleteReminder(
    calendarHref: string,
    uid: string
  ): Promise<{ readonly deleted: true; readonly href: string; readonly uid: string }> {
    const object = await this.findObject(calendarHref, uid, "VTODO");
    const deleted = await this.driver.deleteObject(object.href, object.etag);
    return { deleted: true, href: deleted.href, uid };
  }

  public syncChanges(calendarHref: string, syncToken?: string): Promise<SyncResult> {
    return this.driver.sync(calendarHref, syncToken);
  }

  public async getCtag(
    calendarHref: string
  ): Promise<{ readonly href: string; readonly ctag?: string; readonly syncToken?: string }> {
    const calendar = await this.driver.getCalendar(calendarHref);
    const result: { href: string; ctag?: string; syncToken?: string } = { href: calendar.href };
    if (calendar.ctag !== undefined) result.ctag = calendar.ctag;
    if (calendar.syncToken !== undefined) result.syncToken = calendar.syncToken;
    return result;
  }

  public secretValues(): readonly string[] {
    return this.credentials.password.length > 0 ? [this.credentials.password] : [];
  }

  public dispose(): void {
    this.driver.dispose?.();
  }

  private async calendarsFor(
    calendarHref: string | undefined,
    component: "VEVENT" | "VTODO"
  ): Promise<readonly { readonly href: string }[]> {
    if (calendarHref !== undefined && calendarHref.length > 0) {
      return [{ href: calendarHref }];
    }
    const calendars = await this.driver.listCalendars();
    return calendars.filter(
      (calendar) => calendar.components.length === 0 || calendar.components.includes(component)
    );
  }

  private async findObject(
    calendarHref: string,
    uid: string,
    component: "VEVENT" | "VTODO"
  ): Promise<CalendarObject> {
    const calendar = withSlash(calendarHref);
    const fromQuery = await this.queryByUid(calendar, uid, component);
    if (fromQuery !== undefined) return fromQuery;
    try {
      const direct = await this.driver.getObject(calendarObjectHref(calendar, uid));
      if (direct.component === component || icsHasComponent(direct.ics, component)) {
        return direct;
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    throw new CalendarAccountError(
      component === "VTODO" ? `Reminder ${uid} not found` : `Event ${uid} not found`,
      "not_found"
    );
  }

  private async queryByUid(
    calendarHref: string,
    uid: string,
    component: "VEVENT" | "VTODO"
  ): Promise<CalendarObject | undefined> {
    try {
      const filtered = await this.driver.queryObjects(calendarHref, makeFilter({ component, uid }));
      const match = filtered.find((object) => object.uid === uid && object.component === component);
      if (match !== undefined) return match;
    } catch (error) {
      if (isAuth(error)) throw error;
    }
    try {
      const listed = await this.driver.queryObjects(calendarHref, makeFilter({ component }));
      return listed.find((object) => object.uid === uid && object.component === component);
    } catch (error) {
      if (isAuth(error)) throw error;
      if (!isNotFound(error)) throw error;
      return undefined;
    }
  }

  private async mutateEvent(
    calendarHref: string,
    uid: string,
    mutate: (event: CalendarEvent) => CalendarEvent
  ): Promise<CalendarEvent> {
    const object = await this.findObject(calendarHref, uid, "VEVENT");
    const current = this.hydrateEvent(object, calendarHref);
    const stored = await this.writeMasterEvent(object, mutate(current));
    return this.hydrateEvent(stored, calendarHref);
  }

  private async mutateReminder(
    calendarHref: string,
    uid: string,
    mutate: (reminder: Reminder) => Reminder
  ): Promise<Reminder> {
    const object = await this.findObject(calendarHref, uid, "VTODO");
    const current = this.hydrateReminder(object, calendarHref);
    const stored = await this.driver.putObject(object.href, generateReminder(mutate(current)), object.etag);
    return this.hydrateReminder(stored, calendarHref);
  }

  private async writeMasterEvent(object: CalendarObject, master: CalendarEvent): Promise<CalendarObject> {
    const exceptions = this.parseEventComponents(object, master.calendarHref).filter(
      (event) => event.recurrenceId !== undefined
    );
    if (exceptions.length === 0) {
      return this.driver.putObject(object.href, generateEvent(master), object.etag);
    }
    return this.putEventSet(object, master, exceptions);
  }

  private async writeException(
    object: CalendarObject,
    master: CalendarEvent,
    exception: CalendarEvent
  ): Promise<CalendarObject> {
    const others = this.parseEventComponents(object, master.calendarHref).filter(
      (event) => event.recurrenceId !== undefined && event.recurrenceId !== exception.recurrenceId
    );
    return this.putEventSet(object, master, [...others, exception]);
  }

  private async putEventSet(
    object: CalendarObject,
    master: CalendarEvent,
    exceptions: readonly CalendarEvent[]
  ): Promise<CalendarObject> {
    if (exceptions.length === 0) {
      return this.driver.putObject(object.href, generateEvent(master), object.etag);
    }
    return this.driver.putObject(object.href, generateEventSet(master, exceptions), object.etag);
  }

  private async queryQuiet(calendarHref: string, filter: ObjectFilter): Promise<readonly CalendarObject[]> {
    try {
      return await this.driver.queryObjects(calendarHref, filter);
    } catch (error) {
      if (
        error instanceof CalendarAccountError &&
        (error.code === "forbidden" || error.code === "http" || error.code === "not_found")
      ) {
        return [];
      }
      throw error;
    }
  }

  private collectExpanded(
    objects: readonly CalendarObject[],
    calendarHref: string,
    start: string | undefined,
    end: string | undefined,
    includeCancelled: boolean
  ): CalendarEvent[] {
    if (start === undefined || end === undefined) {
      return objects
        .filter((object) => object.component === "VEVENT")
        .map((object) => this.hydrateEvent(object, calendarHref));
    }
    const instances: CalendarEvent[] = [];
    for (const object of objects) {
      if (object.component !== "VEVENT") continue;
      instances.push(...this.expandObjectToEvents(object, calendarHref, start, end, includeCancelled));
    }
    instances.sort((a, b) => a.start.localeCompare(b.start));
    return instances;
  }

  private hydrateEvent(object: CalendarObject, calendarHref: string, parsed?: CalendarEvent): CalendarEvent {
    const event = parsed ?? parseEvent(object.ics);
    const base: CalendarEvent = {
      uid: event.uid.length > 0 ? event.uid : object.uid,
      href: object.href,
      calendarHref: withSlash(calendarHref),
      summary: event.summary,
      start: event.start,
      allDay: event.allDay,
      attendees: event.attendees ?? [],
      alarms: event.alarms ?? []
    };
    return copyDefined(base, {
      etag: object.etag ?? event.etag,
      description: event.description,
      location: event.location,
      end: event.end,
      timezone: event.timezone,
      status: event.status,
      transparency: event.transparency,
      organizer: event.organizer,
      rrule: event.rrule,
      rdates: event.rdates,
      exdates: event.exdates,
      recurrenceId: event.recurrenceId,
      url: event.url,
      categories: event.categories,
      created: event.created,
      lastModified: event.lastModified
    });
  }

  private hydrateReminder(object: CalendarObject, calendarHref: string, parsed?: Reminder): Reminder {
    const reminder = parsed ?? parseReminder(object.ics);
    const base: Reminder = {
      uid: reminder.uid.length > 0 ? reminder.uid : object.uid,
      href: object.href,
      calendarHref: withSlash(calendarHref),
      summary: reminder.summary,
      alarms: reminder.alarms ?? []
    };
    return copyDefined(base, {
      etag: object.etag ?? reminder.etag,
      description: reminder.description,
      due: reminder.due,
      completed: reminder.completed,
      percentComplete: reminder.percentComplete,
      priority: reminder.priority,
      status: reminder.status
    });
  }

  private parseEventComponents(object: CalendarObject, calendarHref: string): CalendarEvent[] {
    const { events } = parseCalendar(object.ics);
    if (events.length === 0) return [this.hydrateEvent(object, calendarHref)];
    return events.map((event) => this.hydrateEvent(object, calendarHref, event));
  }

  private expandObjectToEvents(
    object: CalendarObject,
    calendarHref: string,
    start: string,
    end: string,
    includeCancelled: boolean
  ): CalendarEvent[] {
    const events = this.parseEventComponents(object, calendarHref);
    const master = masterEvent(events);
    if (master === undefined) return [];
    const exceptions = new Map(
      events
        .filter((event) => event.recurrenceId !== undefined)
        .map((event) => [occurrenceKey(event.recurrenceId ?? event.start), event])
    );
    const result: CalendarEvent[] = [];
    const seen = new Set<string>();
    for (const occ of expandEventOccurrences(master, start, end)) {
      const key = occurrenceKey(occ.recurrenceId);
      seen.add(key);
      const exception = exceptions.get(key);
      if (exception !== undefined) {
        if (!includeCancelled && exception.status === "CANCELLED") continue;
        result.push(
          copyDefined(exception, { recurrenceId: exception.recurrenceId ?? occ.recurrenceId })
        );
        continue;
      }
      result.push(instanceFromOccurrence(master, occ));
    }
    if (includeCancelled) {
      for (const exception of exceptions.values()) {
        if (exception.status !== "CANCELLED" || exception.recurrenceId === undefined) continue;
        const key = occurrenceKey(exception.recurrenceId);
        if (seen.has(key) || !inWindow(exception.start, start, end)) continue;
        seen.add(key);
        result.push(exception);
      }
      for (const exdate of master.exdates ?? []) {
        const key = occurrenceKey(exdate);
        if (seen.has(key) || !inWindow(exdate, start, end)) continue;
        seen.add(key);
        result.push(copyDefined(instanceFromOccurrence(master, {
          uid: master.uid,
          recurrenceId: exdate,
          start: exdate,
          summary: master.summary,
          cancelled: true
        }), { status: "CANCELLED" }));
      }
    }
    result.sort((a, b) => a.start.localeCompare(b.start));
    return result.slice(0, OCCURRENCE_CAP);
  }

  private expandObjectToOccurrences(
    object: CalendarObject,
    calendarHref: string,
    start: string,
    end: string,
    includeCancelled: boolean
  ): Occurrence[] {
    return this.expandObjectToEvents(object, calendarHref, start, end, includeCancelled).map((event) => {
      const recurrenceId = event.recurrenceId ?? event.start;
      const occurrence: Occurrence = {
        uid: event.uid,
        recurrenceId,
        start: event.start,
        summary: event.summary,
        cancelled: event.status === "CANCELLED"
      };
      return event.end === undefined ? occurrence : { ...occurrence, end: event.end };
    });
  }
}

function withoutEtag(event: CalendarEvent): CalendarEvent {
  const { etag: _etag, ...rest } = event;
  return rest;
}

function withoutRecurrenceRule(event: CalendarEvent): CalendarEvent {
  const { rrule: _rrule, rdates: _rdates, exdates: _exdates, ...rest } = event;
  return rest;
}

function masterEvent(events: readonly CalendarEvent[]): CalendarEvent | undefined {
  return events.find((event) => event.recurrenceId === undefined) ?? events[0];
}

function instanceFromOccurrence(master: CalendarEvent, occ: Occurrence): CalendarEvent {
  const { end: _end, ...rest } = withoutRecurrenceRule(master);
  const next: CalendarEvent = {
    ...rest,
    start: occ.start,
    recurrenceId: occ.recurrenceId,
    summary: occ.summary
  };
  if (occ.end !== undefined) return { ...next, end: occ.end };
  return next;
}

function expandEventOccurrences(event: CalendarEvent, start: string, end: string): Occurrence[] {
  try {
    return expandRRule(event, toDate(start), toRangeEnd(end), OCCURRENCE_CAP);
  } catch {
    return expandBasicRRule(event.rrule ?? "", event.start, start, end).map((occStart) => {
      const occurrence: Occurrence = {
        uid: event.uid,
        recurrenceId: occStart,
        start: occStart,
        summary: event.summary,
        cancelled: false
      };
      if (event.end === undefined) return occurrence;
      const duration = toMillis(event.end) - toMillis(event.start);
      if (Number.isNaN(duration)) return occurrence;
      return { ...occurrence, end: fromMillis(toMillis(occStart) + duration, event.end) };
    });
  }
}

function toDate(iso: string): Date {
  const ms = toMillis(iso);
  return new Date(Number.isNaN(ms) ? iso : ms);
}

function toRangeEnd(iso: string): Date {
  return new Date(rangeEndMs(iso));
}

function rangeEndMs(iso: string): number {
  const ms = toMillis(iso);
  if (Number.isNaN(ms)) return ms;
  return isDateOnly(icsDateToIso(iso)) ? ms + 86_400_000 - 1 : ms;
}

function expandBasicRRule(rrule: string, dtstart: string, rangeStart: string, rangeEnd: string): string[] {
  const parts = parseRRuleParts(rrule);
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY") return [];
  const interval = Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1);
  const count = parts.COUNT !== undefined ? Number.parseInt(parts.COUNT, 10) : undefined;
  const until = parts.UNTIL !== undefined ? toMillis(icsDateToIso(parts.UNTIL)) : undefined;
  const startMs = toMillis(dtstart);
  const windowStart = toMillis(rangeStart);
  const windowEnd = toMillis(rangeEnd);
  if (Number.isNaN(startMs) || Number.isNaN(windowStart) || Number.isNaN(windowEnd)) return [];
  const step = (freq === "DAILY" ? 86_400_000 : 604_800_000) * interval;
  const out: string[] = [];
  let n = 0;
  let current = startMs;
  while (n < OCCURRENCE_CAP) {
    if (until !== undefined && !Number.isNaN(until) && current > until) break;
    if (count !== undefined && !Number.isNaN(count) && n >= count) break;
    if (current > windowEnd) break;
    if (current >= windowStart) out.push(fromMillis(current, dtstart));
    n += 1;
    const next = current + step;
    if (next <= current) break;
    current = next;
  }
  return out;
}

function parseRRuleParts(rrule: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    parts[trimmed.slice(0, eq).toUpperCase()] = trimmed.slice(eq + 1);
  }
  return parts;
}

function makeFilter(parts: {
  readonly component?: ObjectFilter["component"] | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly uid?: string | undefined;
  readonly text?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}): ObjectFilter {
  return {
    ...(parts.component !== undefined ? { component: parts.component } : {}),
    ...(parts.start !== undefined ? { start: parts.start } : {}),
    ...(parts.end !== undefined ? { end: parts.end } : {}),
    ...(parts.uid !== undefined ? { uid: parts.uid } : {}),
    ...(parts.text !== undefined ? { text: parts.text } : {}),
    ...(parts.limit !== undefined ? { limit: parts.limit } : {}),
    ...(parts.offset !== undefined ? { offset: parts.offset } : {})
  };
}

function paginate<T>(items: readonly T[], offset?: number, limit?: number): T[] {
  const start = offset ?? 0;
  if (limit === undefined) return items.slice(start);
  return items.slice(start, start + limit);
}

function eventMatchesText(event: CalendarEvent, text: string): boolean {
  const query = text.toLowerCase();
  const fields = [event.summary, event.description, event.location, event.uid, ...(event.categories ?? [])];
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(query));
}

function windowAllows(
  start: string,
  end: string,
  allDay: boolean,
  windowStart?: string,
  windowEnd?: string
): boolean {
  if (windowStart === undefined && windowEnd === undefined) return true;
  return overlapsRange(start, end, allDay, windowStart ?? start, windowEnd ?? end);
}

function overlapsRange(start: string, end: string, allDay: boolean, windowStart: string, windowEnd: string): boolean {
  const aStart = toMillis(start);
  const aEnd = toMillis(end) + (allDay && end === start ? 86_400_000 : 0);
  const bStart = toMillis(windowStart);
  const bEnd = rangeEndMs(windowEnd);
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return true;
  return aStart < bEnd && bStart < aEnd;
}

function inWindow(value: string, start: string, end: string): boolean {
  const ms = toMillis(value);
  const from = toMillis(start);
  const to = rangeEndMs(end);
  if ([ms, from, to].some(Number.isNaN)) return true;
  return ms >= from && ms <= to;
}

function reminderMatchesText(reminder: Reminder, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  return `${reminder.summary}\n${reminder.description ?? ""}`.toLowerCase().includes(needle);
}

function utcDateOnly(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function dueInRange(due: string | undefined, after?: string, before?: string): boolean {
  if (due === undefined) return after === undefined && before === undefined;
  const ms = toMillis(due);
  if (Number.isNaN(ms)) return true;
  if (after !== undefined && ms < toMillis(after)) return false;
  if (before !== undefined && ms > toMillis(before)) return false;
  return true;
}

function isNotFound(error: unknown): boolean {
  return error instanceof CalendarAccountError && error.code === "not_found";
}

function isAuth(error: unknown): boolean {
  return error instanceof CalendarAccountError && error.code === "auth";
}

function withSlash(href: string): string {
  return href.endsWith("/") ? href : `${href}/`;
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uniqueDates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = occurrenceKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function occurrenceKey(value: string): string {
  const iso = icsDateToIso(value);
  if (isDateOnly(iso)) return iso.slice(0, 10);
  const ms = toMillis(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{8}$/.test(value);
}

function icsDateToIso(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const compact = /^(\d{8})T(\d{6})(Z)?$/i.exec(value);
  if (compact?.[1] !== undefined && compact[2] !== undefined) {
    const day = compact[1];
    const time = compact[2];
    const zulu = compact[3] !== undefined ? "Z" : "";
    return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}${zulu}`;
  }
  return value;
}

function toMillis(value: string): number {
  const iso = icsDateToIso(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Date.parse(`${iso}T00:00:00Z`);
  return Date.parse(iso);
}

function fromMillis(ms: number, template: string): string {
  const date = new Date(ms);
  if (isDateOnly(template)) return date.toISOString().slice(0, 10);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function copyDefined<T extends object>(base: T, patch: { readonly [K in keyof T]?: T[K] | undefined }): T {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) extra[key] = value;
  }
  return { ...base, ...extra };
}

function icsHasComponent(ics: string, name: string): boolean {
  return unfoldIcs(ics).includes(`BEGIN:${name}`);
}
