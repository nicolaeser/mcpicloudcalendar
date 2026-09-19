import { extractUid, generateEvent, generateReminder, parseCalendar } from "./ics.js";
import {
  CalendarAccountError,
  type CalDavDriver,
  type CalDavVerifyResult,
  type CalendarCredentials,
  type CalendarEvent,
  type CalendarInfo,
  type CalendarObject,
  type CreateCalendarInput,
  type ObjectFilter,
  type PrincipalInfo,
  type Reminder,
  type SyncResult,
  type UpdateCalendarInput
} from "./types.js";

const HOME_HREF = "/calendars/home/";
const WORK_HREF = "/calendars/work/";
const REMINDERS_HREF = "/calendars/reminders/";
const PRINCIPAL_HREF = "/principals/user/";
const CALENDAR_HOME_HREF = "/calendars/";
const WEEKDAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

export class MemoryCalDavStore implements CalDavDriver {
  public verifyOk = true;
  public readonly credentials: CalendarCredentials;
  public readonly calendars = new Map<string, CalendarInfo>();
  public readonly objects = new Map<string, CalendarObject>();

  private seq = 0;
  private etagSeq = 0;
  private readonly snapshots = new Map<string, Map<string, Map<string, string>>>();

  public constructor(credentials: CalendarCredentials) {
    this.credentials = credentials;
    this.seed();
  }

  public async verify(): Promise<CalDavVerifyResult> {
    if (!this.verifyOk) {
      throw new CalendarAccountError("CalDAV authentication failed.", "auth");
    }
    return {
      ok: true,
      url: this.credentials.caldavUrl,
      principalHref: PRINCIPAL_HREF
    };
  }

  public async principal(): Promise<PrincipalInfo> {
    return {
      email: this.credentials.email,
      principalHref: PRINCIPAL_HREF,
      calendarHomeHref: CALENDAR_HOME_HREF,
      displayName: this.credentials.username
    };
  }

  public async listCalendars(): Promise<readonly CalendarInfo[]> {
    return [...this.calendars.values()];
  }

  public async getCalendar(href: string): Promise<CalendarInfo> {
    return this.requireCalendar(href);
  }

  public async createCalendar(input: CreateCalendarInput): Promise<CalendarInfo> {
    const href = this.uniqueCalendarHref(input.displayName);
    const components: CalendarInfo["components"] =
      input.components === undefined || input.components.length === 0 ? ["VEVENT"] : input.components;
    const created: CalendarInfo = {
      href,
      displayName: input.displayName,
      components,
      readOnly: false,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.color === undefined ? {} : { color: input.color })
    };
    this.calendars.set(href, created);
    return this.touch(href);
  }

  public async updateCalendar(href: string, patch: UpdateCalendarInput): Promise<CalendarInfo> {
    const current = this.requireWritable(href);
    const description = patch.description ?? current.description;
    const color = patch.color ?? current.color;
    const next: CalendarInfo = {
      href: current.href,
      displayName: patch.displayName ?? current.displayName,
      components: current.components,
      readOnly: current.readOnly,
      ...(description === undefined ? {} : { description }),
      ...(color === undefined ? {} : { color })
    };
    this.calendars.set(next.href, next);
    return this.touch(next.href);
  }

  public async deleteCalendar(href: string): Promise<{ readonly deleted: true; readonly href: string }> {
    const calendar = this.requireWritable(href);
    for (const objectHref of [...this.objects.keys()]) {
      if (objectHref.startsWith(calendar.href)) this.objects.delete(objectHref);
    }
    this.calendars.delete(calendar.href);
    this.snapshots.delete(calendar.href);
    return { deleted: true, href: calendar.href };
  }

  public async queryObjects(calendarHref: string, filter: ObjectFilter): Promise<readonly CalendarObject[]> {
    const calendar = this.requireCalendar(calendarHref);
    const matched = this.objectsIn(calendar.href).filter((object) => matchesFilter(object, filter));
    const offset = Math.max(0, filter.offset ?? 0);
    const sliced = matched.slice(offset);
    if (filter.limit === undefined) return sliced;
    return sliced.slice(0, Math.max(0, filter.limit));
  }

  public async getObject(href: string): Promise<CalendarObject> {
    const object = this.objects.get(normalizeObjectHref(href));
    if (object === undefined) {
      throw new CalendarAccountError(`CalDAV resource not found (${href}).`, "not_found");
    }
    return object;
  }

  public async putObject(href: string, ics: string, etag?: string): Promise<CalendarObject> {
    return etag === undefined ? this.putObjectNow(href, ics) : this.putObjectNow(href, ics, etag);
  }

  public async moveObject(fromHref: string, toHref: string, etag?: string): Promise<CalendarObject> {
    const source = await this.getObject(fromHref);
    if (etag !== undefined && !etagsEqual(source.etag, etag)) {
      throw new CalendarAccountError("CalDAV precondition failed.", "precondition");
    }
    const copied = await this.putObjectNow(toHref, source.ics);
    this.objects.delete(normalizeObjectHref(fromHref));
    this.touch(parentCollectionHref(normalizeObjectHref(fromHref)));
    return copied;
  }

  public async deleteObject(
    href: string,
    etag?: string
  ): Promise<{ readonly deleted: true; readonly href: string }> {
    const objectHref = normalizeObjectHref(href);
    const existing = this.objects.get(objectHref);
    if (existing === undefined) {
      throw new CalendarAccountError(`CalDAV resource not found (${href}).`, "not_found");
    }
    if (etag !== undefined && !etagsEqual(existing.etag, etag)) {
      throw new CalendarAccountError("CalDAV precondition failed.", "precondition");
    }
    const calendarHref = parentCollectionHref(objectHref);
    this.requireWritable(calendarHref);
    this.objects.delete(objectHref);
    this.touch(calendarHref);
    return { deleted: true, href: objectHref };
  }

  public async sync(calendarHref: string, syncToken?: string): Promise<SyncResult> {
    const calendar = this.requireCalendar(calendarHref);
    const current = this.etagMap(calendar.href);
    const currentToken = calendar.syncToken ?? String(this.seq);
    const baseline =
      syncToken === undefined || syncToken.length === 0
        ? undefined
        : this.snapshots.get(calendar.href)?.get(syncToken);
    if (baseline === undefined) {
      return {
        href: calendar.href,
        syncToken: currentToken,
        created: this.objectsIn(calendar.href),
        updated: [],
        deleted: [],
        reset: true
      };
    }
    const created: CalendarObject[] = [];
    const updated: CalendarObject[] = [];
    const deleted: string[] = [];
    for (const [href, etag] of current) {
      const previous = baseline.get(href);
      const object = this.objects.get(href);
      if (object === undefined) continue;
      if (previous === undefined) created.push(object);
      else if (previous !== etag) updated.push(object);
    }
    for (const href of baseline.keys()) {
      if (!current.has(href)) deleted.push(href);
    }
    created.sort(compareHref);
    updated.sort(compareHref);
    deleted.sort();
    return {
      href: calendar.href,
      syncToken: currentToken,
      created,
      updated,
      deleted
    };
  }

  private seed(): void {
    const day = utcToday();
    this.insertCalendar({
      href: HOME_HREF,
      displayName: "Home",
      color: "#C9341C",
      components: ["VEVENT"]
    });
    const standup: CalendarEvent = {
      uid: "standup",
      href: `${HOME_HREF}standup.ics`,
      calendarHref: HOME_HREF,
      summary: "Standup",
      start: `${day}T09:00:00Z`,
      end: `${day}T09:30:00Z`,
      allDay: false,
      attendees: [],
      alarms: []
    };
    this.putObjectNow(standup.href, generateEvent(standup));
    const birthday: CalendarEvent = {
      uid: "birthday",
      href: `${HOME_HREF}birthday.ics`,
      calendarHref: HOME_HREF,
      summary: "Birthday",
      start: day,
      allDay: true,
      attendees: [],
      alarms: []
    };
    this.putObjectNow(birthday.href, generateEvent(birthday));

    this.insertCalendar({
      href: WORK_HREF,
      displayName: "Work",
      color: "#2563EB",
      components: ["VEVENT"]
    });
    const weekly: CalendarEvent = {
      uid: "weekly-sync",
      href: `${WORK_HREF}weekly-sync.ics`,
      calendarHref: WORK_HREF,
      summary: "Weekly sync",
      start: "2024-01-01T10:00:00Z",
      end: "2024-01-01T11:00:00Z",
      allDay: false,
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      attendees: [],
      alarms: []
    };
    this.putObjectNow(weekly.href, generateEvent(weekly));

    this.insertCalendar({
      href: REMINDERS_HREF,
      displayName: "Reminders",
      components: ["VTODO"]
    });
    const milk: Reminder = {
      uid: "buy-milk",
      href: `${REMINDERS_HREF}buy-milk.ics`,
      calendarHref: REMINDERS_HREF,
      summary: "Buy milk",
      status: "NEEDS-ACTION",
      alarms: []
    };
    this.putObjectNow(milk.href, generateReminder(milk));
    const someday: Reminder = {
      uid: "someday-idea",
      href: `${REMINDERS_HREF}someday-idea.ics`,
      calendarHref: REMINDERS_HREF,
      summary: "Someday idea",
      description: "Undated inbox item",
      status: "NEEDS-ACTION",
      alarms: []
    };
    this.putObjectNow(someday.href, generateReminder(someday));
  }

  private insertCalendar(input: {
    readonly href: string;
    readonly displayName: string;
    readonly components: readonly ("VEVENT" | "VTODO" | "VJOURNAL")[];
    readonly color?: string;
  }): CalendarInfo {
    const info: CalendarInfo = {
      href: input.href,
      displayName: input.displayName,
      components: input.components,
      readOnly: false,
      ...(input.color === undefined ? {} : { color: input.color })
    };
    this.calendars.set(info.href, info);
    return this.touch(info.href);
  }

  private putObjectNow(href: string, ics: string, etag?: string): CalendarObject {
    const objectHref = normalizeObjectHref(href);
    const calendarHref = parentCollectionHref(objectHref);
    this.requireWritable(calendarHref);
    const existing = this.objects.get(objectHref);
    if (etag !== undefined && (existing === undefined || !etagsEqual(existing.etag, etag))) {
      throw new CalendarAccountError("CalDAV precondition failed.", "precondition");
    }
    const object: CalendarObject = {
      href: objectHref,
      etag: this.nextEtag(),
      ics,
      uid: uidFromIcs(ics, objectHref),
      component: componentOfIcs(ics)
    };
    this.objects.set(objectHref, object);
    this.touch(calendarHref);
    return object;
  }

  private requireCalendar(href: string): CalendarInfo {
    const key = normalizeCollectionHref(href);
    const found = this.calendars.get(key);
    if (found === undefined) {
      throw new CalendarAccountError(`CalDAV resource not found (${key}).`, "not_found");
    }
    return found;
  }

  private requireWritable(href: string): CalendarInfo {
    const calendar = this.requireCalendar(href);
    if (calendar.readOnly) {
      throw new CalendarAccountError(`Calendar is read-only (${calendar.href}).`, "calendar_error");
    }
    return calendar;
  }

  private uniqueCalendarHref(displayName: string): string {
    const slug =
      displayName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "calendar";
    let href = `/calendars/${slug}/`;
    let n = 2;
    while (this.calendars.has(href)) {
      href = `/calendars/${slug}-${n}/`;
      n += 1;
    }
    return href;
  }

  private touch(calendarHref: string): CalendarInfo {
    const current = this.requireCalendar(calendarHref);
    this.seq += 1;
    const token = String(this.seq);
    const next: CalendarInfo = {
      href: current.href,
      displayName: current.displayName,
      components: current.components,
      readOnly: current.readOnly,
      ctag: `ctag-${this.seq}`,
      syncToken: token,
      ...(current.description === undefined ? {} : { description: current.description }),
      ...(current.color === undefined ? {} : { color: current.color })
    };
    this.calendars.set(next.href, next);
    this.recordSnapshot(next.href, token);
    return next;
  }

  private recordSnapshot(calendarHref: string, token: string): void {
    let tokens = this.snapshots.get(calendarHref);
    if (tokens === undefined) {
      tokens = new Map();
      this.snapshots.set(calendarHref, tokens);
    }
    tokens.set(token, this.etagMap(calendarHref));
  }

  private etagMap(calendarHref: string): Map<string, string> {
    const etags = new Map<string, string>();
    for (const object of this.objectsIn(calendarHref)) {
      if (object.etag !== undefined) etags.set(object.href, object.etag);
    }
    return etags;
  }

  private objectsIn(calendarHref: string): CalendarObject[] {
    const prefix = normalizeCollectionHref(calendarHref);
    const found: CalendarObject[] = [];
    for (const object of this.objects.values()) {
      if (object.href.startsWith(prefix)) found.push(object);
    }
    found.sort(compareHref);
    return found;
  }

  private nextEtag(): string {
    this.etagSeq += 1;
    return `"${this.etagSeq}"`;
  }
}

function matchesFilter(object: CalendarObject, filter: ObjectFilter): boolean {
  if (filter.component !== undefined && object.component !== filter.component) return false;
  if (filter.uid !== undefined && object.uid !== filter.uid) return false;
  const parsed = parseCalendar(object.ics);
  if (filter.text !== undefined && filter.text.trim().length > 0) {
    const needle = filter.text.trim().toLowerCase();
    if (!objectText(object, parsed).toLowerCase().includes(needle)) return false;
  }
  const window = filterWindow(filter);
  if (window === undefined) return true;
  return objectOverlaps(object, parsed, window.start, window.end);
}

function objectText(
  object: CalendarObject,
  parsed: ReturnType<typeof parseCalendar>
): string {
  if (object.component === "VTODO") {
    const reminder = parsed.reminders[0];
    if (reminder === undefined) return object.ics;
    return [reminder.summary, reminder.description ?? "", reminder.uid].join("\n");
  }
  const event = parsed.events[0];
  if (event === undefined) return object.ics;
  return [event.summary, event.description ?? "", event.location ?? "", event.uid].join("\n");
}

function objectOverlaps(
  object: CalendarObject,
  parsed: ReturnType<typeof parseCalendar>,
  filterStart: number,
  filterEnd: number
): boolean {
  if (object.component === "VTODO") {
    const reminder = parsed.reminders[0];
    if (reminder === undefined) return false;
    const due = reminder.due === undefined ? undefined : Date.parse(reminder.due);
    const completed = reminder.completed === undefined ? undefined : Date.parse(reminder.completed);
    const point = due !== undefined && !Number.isNaN(due) ? due : completed;
    if (point === undefined || Number.isNaN(point)) return false;
    return intervalsOverlap(point, point + 1, filterStart, filterEnd);
  }
  const event = parsed.events[0];
  if (event === undefined) return false;
  const interval = eventInterval(event);
  if (interval === undefined) return false;
  if (event.rrule !== undefined && event.rrule.length > 0) {
    return recurrenceOverlaps(interval.start, interval.end, event.rrule, filterStart, filterEnd);
  }
  return intervalsOverlap(interval.start, interval.end, filterStart, filterEnd);
}

function eventInterval(event: CalendarEvent): { start: number; end: number } | undefined {
  const start = Date.parse(event.allDay ? `${event.start.slice(0, 10)}T00:00:00Z` : event.start);
  if (Number.isNaN(start)) return undefined;
  if (event.end !== undefined && event.end.length > 0) {
    const end = Date.parse(event.allDay ? `${event.end.slice(0, 10)}T00:00:00Z` : event.end);
    if (!Number.isNaN(end)) return { start, end: Math.max(end, start + 1) };
  }
  const span = event.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return { start, end: start + span };
}

function recurrenceOverlaps(
  start: number,
  end: number,
  rrule: string,
  filterStart: number,
  filterEnd: number
): boolean {
  if (intervalsOverlap(start, end, filterStart, filterEnd)) return true;
  const freq = /FREQ=([A-Z]+)/i.exec(rrule)?.[1]?.toUpperCase();
  if (freq === undefined) return false;
  const interval = Math.max(1, Number(/INTERVAL=(\d+)/i.exec(rrule)?.[1] ?? 1));
  const until = parseUntil(rrule);
  const countRaw = /COUNT=(\d+)/i.exec(rrule)?.[1];
  const count = countRaw === undefined ? undefined : Math.max(0, Number(countRaw));
  const byDays = parseByDay(/BYDAY=([^;]+)/i.exec(rrule)?.[1]);
  const duration = Math.max(1, end - start);
  const cursor = new Date(start);
  if (count === undefined) {
    // Skip toward the window so distant FREQ=WEEKLY masters still match (400-occurrence cap).
    jumpToward(cursor, start, freq, interval, Math.max(start, filterStart - duration));
  }
  let seen = 0;
  for (let i = 0; i < 400; i += 1) {
    const occStart = cursor.getTime();
    if (until !== undefined && occStart > until) return false;
    if (occStart >= filterEnd) return false;
    if (count !== undefined && seen >= count) return false;
    const weekdayOk = occStart === start || byDays.length === 0 || byDays.includes(cursor.getUTCDay());
    if (weekdayOk) {
      seen += 1;
      if (intervalsOverlap(occStart, occStart + duration, filterStart, filterEnd)) return true;
    }
    if (!advanceOccurrence(cursor, start, freq, interval, byDays)) return false;
  }
  return false;
}

function jumpToward(cursor: Date, start: number, freq: string, interval: number, target: number): void {
  if (target <= start) return;
  if (freq === "DAILY") {
    const days = Math.floor((target - start) / 86_400_000);
    cursor.setUTCDate(cursor.getUTCDate() + Math.floor(days / interval) * interval);
    return;
  }
  if (freq === "WEEKLY") {
    const weeks = Math.floor((target - start) / (7 * 86_400_000));
    cursor.setUTCDate(cursor.getUTCDate() + Math.floor(weeks / interval) * interval * 7);
    return;
  }
  if (freq === "MONTHLY") {
    const origin = new Date(start);
    const goal = new Date(target);
    const months = (goal.getUTCFullYear() - origin.getUTCFullYear()) * 12 + (goal.getUTCMonth() - origin.getUTCMonth());
    cursor.setUTCMonth(cursor.getUTCMonth() + Math.max(0, Math.floor(months / interval) * interval));
    return;
  }
  if (freq === "YEARLY") {
    const years = new Date(target).getUTCFullYear() - new Date(start).getUTCFullYear();
    cursor.setUTCFullYear(cursor.getUTCFullYear() + Math.max(0, Math.floor(years / interval) * interval));
  }
}

function advanceOccurrence(
  cursor: Date,
  start: number,
  freq: string,
  interval: number,
  byDays: readonly number[]
): boolean {
  if (freq === "DAILY") {
    cursor.setUTCDate(cursor.getUTCDate() + interval);
    return true;
  }
  if (freq === "WEEKLY") {
    if (byDays.length === 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
      return true;
    }
    const originDay = Math.floor(start / 86_400_000);
    for (let step = 0; step < 8 * interval; step += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (!byDays.includes(cursor.getUTCDay())) continue;
      const weekDiff = Math.floor((Math.floor(cursor.getTime() / 86_400_000) - originDay) / 7);
      if (weekDiff % interval === 0) return true;
    }
    return false;
  }
  if (freq === "MONTHLY") {
    cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    return true;
  }
  if (freq === "YEARLY") {
    cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
    return true;
  }
  return false;
}

function parseByDay(raw: string | undefined): number[] {
  if (raw === undefined || raw.length === 0) return [];
  const days: number[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim().slice(-2).toUpperCase();
    const index = WEEKDAY_INDEX[key];
    if (index !== undefined) days.push(index);
  }
  return days;
}

function parseUntil(rrule: string): number | undefined {
  const raw = /UNTIL=([^;]+)/i.exec(rrule)?.[1];
  if (raw === undefined) return undefined;
  return parseIcsDateTime(raw);
}

function filterWindow(filter: ObjectFilter): { start: number; end: number } | undefined {
  if (filter.start === undefined && filter.end === undefined) return undefined;
  const start = filter.start === undefined ? Number.NEGATIVE_INFINITY : Date.parse(filter.start);
  const end = filter.end === undefined ? Number.POSITIVE_INFINITY : Date.parse(filter.end);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY };
  }
  return { start, end };
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

function componentOfIcs(ics: string): "VEVENT" | "VTODO" | "VJOURNAL" {
  const parsed = parseCalendar(ics);
  if (parsed.reminders.length > 0 && parsed.events.length === 0) return "VTODO";
  if (parsed.events.length > 0) return "VEVENT";
  const upper = ics.toUpperCase();
  if (upper.includes("BEGIN:VTODO")) return "VTODO";
  if (upper.includes("BEGIN:VEVENT")) return "VEVENT";
  if (upper.includes("BEGIN:VJOURNAL")) return "VJOURNAL";
  throw new CalendarAccountError("Calendar object is missing VEVENT, VTODO, or VJOURNAL.", "calendar_error");
}

function uidFromIcs(ics: string, href: string): string {
  const uid = extractUid(ics);
  if (uid !== undefined && uid.length > 0) return uid;
  const leaf = href.split("/").filter((part) => part.length > 0).at(-1) ?? "object";
  return leaf.replace(/\.ics$/i, "");
}

function parseIcsDateTime(raw: string): number | undefined {
  const value = raw.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly?.[1] !== undefined && dateOnly[2] !== undefined && dateOnly[3] !== undefined) {
    return Date.parse(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00Z`);
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(value);
  if (
    dateTime?.[1] !== undefined &&
    dateTime[2] !== undefined &&
    dateTime[3] !== undefined &&
    dateTime[4] !== undefined &&
    dateTime[5] !== undefined &&
    dateTime[6] !== undefined
  ) {
    return Date.parse(
      `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}Z`
    );
  }
  const iso = Date.parse(value);
  return Number.isNaN(iso) ? undefined : iso;
}

function etagsEqual(stored: string | undefined, provided: string): boolean {
  if (stored === undefined) return false;
  if (stored === provided) return true;
  return unwrapEtag(stored) === unwrapEtag(provided);
}

function unwrapEtag(etag: string): string {
  return etag.replace(/^W\//i, "").replaceAll('"', "");
}

function normalizeCollectionHref(href: string): string {
  const trimmed = href.trim() || "/";
  const withLead = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

function normalizeObjectHref(href: string): string {
  const trimmed = href.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parentCollectionHref(objectHref: string): string {
  const path = normalizeObjectHref(objectHref);
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index + 1);
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function compareHref(a: CalendarObject, b: CalendarObject): number {
  if (a.href < b.href) return -1;
  if (a.href > b.href) return 1;
  return 0;
}
