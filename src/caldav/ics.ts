import {
  CalendarAccountError,
  type Alarm,
  type Attendee,
  type CalendarEvent,
  type CreateEventInput,
  type CreateReminderInput,
  type Reminder
} from "./types.js";

const PRODID = "-//mcpicloudcalendar//EN";
const FOLD_OCTETS = 75;
const encoder = new TextEncoder();

const EVENT_STATUS = new Set<NonNullable<CalendarEvent["status"]>>([
  "TENTATIVE",
  "CONFIRMED",
  "CANCELLED"
]);
const TODO_STATUS = new Set<NonNullable<Reminder["status"]>>([
  "NEEDS-ACTION",
  "COMPLETED",
  "IN-PROCESS",
  "CANCELLED"
]);
const TRANSPARENCY = new Set<NonNullable<CalendarEvent["transparency"]>>(["OPAQUE", "TRANSPARENT"]);
const ALARM_ACTIONS = new Set<Alarm["action"]>(["DISPLAY", "AUDIO", "EMAIL"]);
const ATTENDEE_ROLES = new Set<NonNullable<Attendee["role"]>>([
  "REQ-PARTICIPANT",
  "OPT-PARTICIPANT",
  "NON-PARTICIPANT",
  "CHAIR"
]);
const PARTSTATS = new Set<NonNullable<Attendee["partstat"]>>([
  "NEEDS-ACTION",
  "ACCEPTED",
  "DECLINED",
  "TENTATIVE",
  "DELEGATED"
]);

interface ContentLine {
  readonly name: string;
  readonly params: Record<string, string>;
  readonly value: string;
}

interface Component {
  readonly name: string;
  readonly properties: ContentLine[];
  readonly components: Component[];
}

interface ParsedDate {
  readonly iso: string;
  readonly allDay: boolean;
  readonly timezone?: string;
}

export function unfoldIcs(raw: string): string {
  return raw.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n[ \t]/g, "");
}

export function foldIcsLine(line: string): string {
  const stripped = line.replaceAll("\r\n", "").replaceAll("\n", "").replaceAll("\r", "");
  const parts: string[] = [];
  let rest = stripped;
  let limit = FOLD_OCTETS;
  while (octetCount(rest) > limit) {
    const cut = cutAtOctetLimit(rest, limit);
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = FOLD_OCTETS - 1;
  }
  parts.push(rest);
  return `${parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n")}\r\n`;
}

export function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n");
}

export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== "\\" || i + 1 >= value.length) {
      out += ch ?? "";
      continue;
    }
    const next = value[i + 1] ?? "";
    if (next === "n" || next === "N") out += "\n";
    else out += next;
    i += 1;
  }
  return out;
}

export function parseCalendar(ics: string): {
  events: CalendarEvent[];
  reminders: Reminder[];
  raw: string;
} {
  const calendars = calendarsFromIcs(ics);
  const events: CalendarEvent[] = [];
  const reminders: Reminder[] = [];
  for (const calendar of calendars) {
    const fallbackTz = nonEmptyTrimmed(textProp(calendar, "X-WR-TIMEZONE"));
    for (const component of calendar.components) {
      if (component.name === "VEVENT") events.push(componentToEvent(component, fallbackTz));
      else if (component.name === "VTODO") reminders.push(componentToReminder(component));
    }
  }
  return { events, reminders, raw: ics };
}

export function parseEvent(ics: string): CalendarEvent {
  const { events } = parseCalendar(ics);
  const master = events.find((event) => event.recurrenceId === undefined) ?? events[0];
  if (master === undefined) {
    throw new CalendarAccountError("ICS does not contain a VEVENT", "ics");
  }
  return master;
}

export function parseReminder(ics: string): Reminder {
  const { reminders } = parseCalendar(ics);
  const reminder = reminders[0];
  if (reminder === undefined) {
    throw new CalendarAccountError("ICS does not contain a VTODO", "ics");
  }
  return reminder;
}

export function generateEvent(event: CalendarEvent): string {
  const chunks: string[] = [calendarBegin()];
  chunks.push(emit("BEGIN", "VEVENT"));
  chunks.push(emit("UID", escapeText(event.uid)));
  chunks.push(emit("DTSTAMP", formatUtcIcs(new Date())));
  if (event.start.length > 0) {
    chunks.push(emitDateProperty("DTSTART", event.start, event.allDay, event.timezone));
  }
  if (event.end !== undefined && event.end.length > 0) {
    chunks.push(emitDateProperty("DTEND", event.end, event.allDay, event.timezone));
  }
  chunks.push(emit("SUMMARY", escapeText(event.summary)));
  pushText(chunks, "DESCRIPTION", event.description);
  pushText(chunks, "LOCATION", event.location);
  if (event.status !== undefined) chunks.push(emit("STATUS", event.status));
  if (event.transparency !== undefined) chunks.push(emit("TRANSP", event.transparency));
  if (event.organizer !== undefined) chunks.push(emitCalAddress("ORGANIZER", event.organizer));
  for (const attendee of event.attendees) {
    chunks.push(emitCalAddress("ATTENDEE", attendee));
  }
  if (event.rrule !== undefined && event.rrule.length > 0) {
    chunks.push(emit("RRULE", event.rrule.replace(/^RRULE:/i, "")));
  }
  pushDateList(chunks, "RDATE", event.rdates, event.allDay, event.timezone);
  pushDateList(chunks, "EXDATE", event.exdates, event.allDay, event.timezone);
  if (event.recurrenceId !== undefined && event.recurrenceId.length > 0) {
    chunks.push(
      emitDateProperty("RECURRENCE-ID", event.recurrenceId, isIsoDateOnly(event.recurrenceId) || event.allDay, event.timezone)
    );
  }
  if (event.url !== undefined && event.url.length > 0) chunks.push(emit("URL", event.url));
  if (event.categories !== undefined && event.categories.length > 0) {
    chunks.push(emit("CATEGORIES", event.categories.map(escapeText).join(",")));
  }
  if (event.created !== undefined) chunks.push(emit("CREATED", isoToUtcIcs(event.created)));
  if (event.lastModified !== undefined) {
    chunks.push(emit("LAST-MODIFIED", isoToUtcIcs(event.lastModified)));
  }
  for (const alarm of event.alarms) chunks.push(emitAlarm(alarm));
  chunks.push(emit("END", "VEVENT"));
  chunks.push(calendarEnd());
  return chunks.join("");
}

/** One VCALENDAR with the master VEVENT plus exception VEVENTs (same UID, RECURRENCE-ID). */
export function generateEventSet(master: CalendarEvent, exceptions: readonly CalendarEvent[]): string {
  const vevents = [veventBlock(generateEvent(master)), ...exceptions.map((event) => veventBlock(generateEvent(event)))].filter(
    (block) => block.length > 0
  );
  return `${calendarBegin()}${vevents.join("")}${calendarEnd()}`;
}

function veventBlock(ics: string): string {
  const unfolded = unfoldIcs(ics).replaceAll("\n", "\r\n");
  const start = unfolded.indexOf("BEGIN:VEVENT");
  const end = unfolded.indexOf("END:VEVENT");
  if (start < 0 || end < 0) return "";
  const block = unfolded.slice(start, end + "END:VEVENT".length);
  return block.endsWith("\r\n") ? block : `${block}\r\n`;
}

export function generateReminder(reminder: Reminder): string {
  const chunks: string[] = [calendarBegin()];
  chunks.push(emit("BEGIN", "VTODO"));
  chunks.push(emit("UID", escapeText(reminder.uid)));
  chunks.push(emit("DTSTAMP", formatUtcIcs(new Date())));
  chunks.push(emit("SUMMARY", escapeText(reminder.summary)));
  pushText(chunks, "DESCRIPTION", reminder.description);
  if (reminder.due !== undefined && reminder.due.length > 0) {
    chunks.push(emitDateProperty("DUE", reminder.due, isIsoDateOnly(reminder.due), undefined));
  }
  if (reminder.completed !== undefined && reminder.completed.length > 0) {
    chunks.push(emit("COMPLETED", isoToUtcIcs(reminder.completed)));
  }
  if (reminder.percentComplete !== undefined) {
    chunks.push(emit("PERCENT-COMPLETE", String(reminder.percentComplete)));
  }
  if (reminder.priority !== undefined) chunks.push(emit("PRIORITY", String(reminder.priority)));
  if (reminder.status !== undefined) chunks.push(emit("STATUS", reminder.status));
  for (const alarm of reminder.alarms) chunks.push(emitAlarm(alarm));
  chunks.push(emit("END", "VTODO"));
  chunks.push(calendarEnd());
  return chunks.join("");
}

export function eventFromCreate(input: CreateEventInput, uid: string, href: string): CalendarEvent {
  const allDay = input.allDay ?? isIsoDateOnly(input.start);
  return {
    uid,
    href,
    calendarHref: input.calendarHref,
    summary: input.summary,
    start: input.start,
    allDay,
    attendees: input.attendees ?? [],
    alarms: input.alarms ?? [],
    ...(input.end !== undefined ? { end: input.end } : {}),
    ...(input.timezone !== undefined && input.timezone.length > 0 && !allDay
      ? { timezone: input.timezone }
      : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.transparency !== undefined ? { transparency: input.transparency } : {}),
    ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
    ...(input.categories !== undefined ? { categories: input.categories } : {})
  };
}

export function reminderFromCreate(input: CreateReminderInput, uid: string, href: string): Reminder {
  return {
    uid,
    href,
    calendarHref: input.calendarHref,
    summary: input.summary,
    alarms: input.alarms ?? [],
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.due !== undefined ? { due: input.due } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {})
  };
}

export function mergeEvent(
  existing: CalendarEvent,
  patch: { readonly [K in keyof CalendarEvent]?: CalendarEvent[K] }
): CalendarEvent {
  const etag = patch.etag ?? existing.etag;
  const description = patch.description ?? existing.description;
  const location = patch.location ?? existing.location;
  const end = patch.end ?? existing.end;
  const timezone = patch.timezone ?? existing.timezone;
  const status = patch.status ?? existing.status;
  const transparency = patch.transparency ?? existing.transparency;
  const organizer = patch.organizer ?? existing.organizer;
  const rrule = patch.rrule ?? existing.rrule;
  const rdates = patch.rdates ?? existing.rdates;
  const exdates = patch.exdates ?? existing.exdates;
  const recurrenceId = patch.recurrenceId ?? existing.recurrenceId;
  const url = patch.url ?? existing.url;
  const categories = patch.categories ?? existing.categories;
  const created = patch.created ?? existing.created;
  const lastModified = patch.lastModified ?? existing.lastModified;
  return {
    uid: patch.uid ?? existing.uid,
    href: patch.href ?? existing.href,
    calendarHref: patch.calendarHref ?? existing.calendarHref,
    summary: patch.summary ?? existing.summary,
    start: patch.start ?? existing.start,
    allDay: patch.allDay ?? existing.allDay,
    attendees: patch.attendees ?? existing.attendees,
    alarms: patch.alarms ?? existing.alarms,
    ...(etag !== undefined ? { etag } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(transparency !== undefined ? { transparency } : {}),
    ...(organizer !== undefined ? { organizer } : {}),
    ...(rrule !== undefined ? { rrule } : {}),
    ...(rdates !== undefined ? { rdates } : {}),
    ...(exdates !== undefined ? { exdates } : {}),
    ...(recurrenceId !== undefined ? { recurrenceId } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(categories !== undefined ? { categories } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(lastModified !== undefined ? { lastModified } : {})
  };
}

export function extractUid(ics: string): string | undefined {
  for (const rawLine of contentLines(ics)) {
    const line = parseContentLine(rawLine);
    if (line === undefined || line.name !== "UID") continue;
    const uid = unescapeText(line.value).trim();
    if (uid.length > 0) return uid;
  }
  return undefined;
}

function octetCount(value: string): number {
  return encoder.encode(value).length;
}

function cutAtOctetLimit(value: string, limit: number): number {
  let octets = 0;
  let cut = 0;
  for (const char of value) {
    const size = octetCount(char);
    if (octets + size > limit) break;
    octets += size;
    cut += char.length;
  }
  if (cut === 0) {
    const first = [...value][0];
    return first === undefined ? value.length : first.length;
  }
  return cut;
}

function contentLines(ics: string): string[] {
  const unfolded = unfoldIcs(ics.startsWith("\uFEFF") ? ics.slice(1) : ics);
  return unfolded.split("\n").filter((line) => line.trim().length > 0);
}

function parseContentLine(line: string): ContentLine | undefined {
  const trimmed = line.replace(/^\uFEFF/, "").trimEnd();
  if (trimmed.length === 0) return undefined;
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return undefined;
  const left = trimmed.slice(0, colon);
  const value = trimmed.slice(colon + 1);
  const semi = left.indexOf(";");
  const rawName = (semi === -1 ? left : left.slice(0, semi)).trim();
  const dotted = rawName.lastIndexOf(".");
  const name = (dotted === -1 ? rawName : rawName.slice(dotted + 1)).toUpperCase();
  if (name.length === 0) return undefined;
  const params = semi === -1 ? {} : parseParams(left.slice(semi + 1));
  return { name, params, value };
}

function parseParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of splitUnquoted(raw, ";")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      params[part.trim().toUpperCase()] = "";
      continue;
    }
    const key = part.slice(0, eq).trim().toUpperCase();
    if (key.length === 0) continue;
    params[key] = unquoteParam(part.slice(eq + 1).trim());
  }
  return params;
}

function splitUnquoted(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === separator && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function unquoteParam(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  const first = splitUnquoted(value, ",")[0];
  return first === undefined ? value : first;
}

function parseRootComponents(ics: string): Component[] {
  const roots: Component[] = [];
  const stack: Component[] = [];
  for (const rawLine of contentLines(ics)) {
    const line = parseContentLine(rawLine);
    if (line === undefined) continue;
    if (line.name === "BEGIN") {
      stack.push({ name: line.value.trim().toUpperCase(), properties: [], components: [] });
      continue;
    }
    if (line.name === "END") {
      const done = stack.pop();
      if (done === undefined) continue;
      attachComponent(roots, stack, done);
      continue;
    }
    const current = stack[stack.length - 1];
    if (current !== undefined) current.properties.push(line);
  }
  while (stack.length > 0) {
    const done = stack.pop();
    if (done === undefined) break;
    attachComponent(roots, stack, done);
  }
  return roots;
}

function attachComponent(roots: Component[], stack: Component[], done: Component): void {
  const parent = stack[stack.length - 1];
  if (parent === undefined) roots.push(done);
  else parent.components.push(done);
}

function calendarsFromIcs(ics: string): Component[] {
  const roots = parseRootComponents(ics);
  const calendars = roots.filter((root) => root.name === "VCALENDAR");
  if (calendars.length > 0) return calendars;
  if (roots.length === 0) return [];
  return [{ name: "VCALENDAR", properties: [], components: roots }];
}

function prop(component: Component, name: string): ContentLine | undefined {
  return component.properties.find((line) => line.name === name);
}

function props(component: Component, name: string): ContentLine[] {
  return component.properties.filter((line) => line.name === name);
}

function textProp(component: Component, name: string): string | undefined {
  const line = prop(component, name);
  if (line === undefined) return undefined;
  return unescapeText(line.value);
}

function componentToEvent(component: Component, fallbackTz: string | undefined): CalendarEvent {
  const dtstart = prop(component, "DTSTART");
  const startParsed = dtstart === undefined ? undefined : parseIcsDate(dtstart.value, dtstart.params);
  const allDay = startParsed?.allDay ?? false;
  const start = startParsed?.iso ?? "";
  const timezone = eventTimezone(startParsed, allDay, fallbackTz);
  const dtend = prop(component, "DTEND");
  const duration = prop(component, "DURATION");
  let end: string | undefined;
  if (dtend !== undefined) end = parseIcsDate(dtend.value, dtend.params).iso;
  else if (duration !== undefined && start.length > 0) {
    const added = addDurationToIso(start, duration.value.trim());
    if (added !== undefined) end = added;
  }
  const summary = textProp(component, "SUMMARY") ?? "";
  const description = nonEmpty(textProp(component, "DESCRIPTION"));
  const location = nonEmpty(textProp(component, "LOCATION"));
  const url = nonEmptyTrimmed(prop(component, "URL")?.value);
  const rrule = nonEmptyTrimmed(prop(component, "RRULE")?.value.replace(/^RRULE:/i, ""));
  const recurrenceIdLine = prop(component, "RECURRENCE-ID");
  const recurrenceId =
    recurrenceIdLine === undefined ? undefined : parseIcsDate(recurrenceIdLine.value, recurrenceIdLine.params).iso;
  const created = utcStamp(component, "CREATED");
  const lastModified = utcStamp(component, "LAST-MODIFIED");
  const statusRaw = textProp(component, "STATUS")?.trim().toUpperCase();
  const status = isEventStatus(statusRaw) ? statusRaw : undefined;
  const transpRaw = textProp(component, "TRANSP")?.trim().toUpperCase();
  const transparency = isTransparency(transpRaw) ? transpRaw : undefined;
  const organizerLine = prop(component, "ORGANIZER");
  const organizer = organizerLine === undefined ? undefined : parseAttendee(organizerLine);
  const attendees = props(component, "ATTENDEE")
    .map(parseAttendee)
    .filter((person): person is Attendee => person !== undefined);
  const alarms = component.components.filter((child) => child.name === "VALARM").flatMap(parseAlarm);
  const rdates = parseDateList(component, "RDATE");
  const exdates = parseDateList(component, "EXDATE");
  const categories = parseCategories(component);
  const uid = unescapeText(prop(component, "UID")?.value ?? "").trim();
  return {
    uid,
    href: "",
    calendarHref: "",
    summary,
    start,
    allDay,
    attendees,
    alarms,
    ...(end !== undefined ? { end } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(transparency !== undefined ? { transparency } : {}),
    ...(organizer !== undefined ? { organizer } : {}),
    ...(rrule !== undefined ? { rrule } : {}),
    ...(rdates.length > 0 ? { rdates } : {}),
    ...(exdates.length > 0 ? { exdates } : {}),
    ...(recurrenceId !== undefined ? { recurrenceId } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(created !== undefined ? { created } : {}),
    ...(lastModified !== undefined ? { lastModified } : {})
  };
}

function componentToReminder(component: Component): Reminder {
  const dueLine = prop(component, "DUE");
  const due = dueLine === undefined ? undefined : parseIcsDate(dueLine.value, dueLine.params).iso;
  const completed = utcStamp(component, "COMPLETED");
  const description = nonEmpty(textProp(component, "DESCRIPTION"));
  const statusRaw = textProp(component, "STATUS")?.trim().toUpperCase();
  const status = isTodoStatus(statusRaw) ? statusRaw : undefined;
  const percentComplete = parseBoundedInt(prop(component, "PERCENT-COMPLETE")?.value, 0, 100);
  const priority = parseBoundedInt(prop(component, "PRIORITY")?.value, 0, 9);
  const alarms = component.components.filter((child) => child.name === "VALARM").flatMap(parseAlarm);
  return {
    uid: unescapeText(prop(component, "UID")?.value ?? "").trim(),
    href: "",
    calendarHref: "",
    summary: textProp(component, "SUMMARY") ?? "",
    alarms,
    ...(description !== undefined ? { description } : {}),
    ...(due !== undefined ? { due } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(percentComplete !== undefined ? { percentComplete } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(status !== undefined ? { status } : {})
  };
}

function eventTimezone(
  startParsed: ParsedDate | undefined,
  allDay: boolean,
  fallbackTz: string | undefined
): string | undefined {
  if (allDay || startParsed === undefined) return undefined;
  if (isInstant(startParsed.iso)) return undefined;
  return nonEmptyTrimmed(startParsed.timezone) ?? nonEmptyTrimmed(fallbackTz);
}

function utcStamp(component: Component, name: string): string | undefined {
  const line = prop(component, name);
  if (line === undefined) return undefined;
  const parsed = parseIcsDate(line.value, line.params);
  if (parsed.allDay) return parsed.iso;
  if (isInstant(parsed.iso)) {
    const date = new Date(parsed.iso);
    return Number.isNaN(date.getTime()) ? parsed.iso : formatUtcIso(date);
  }
  const date = new Date(`${parsed.iso}Z`);
  return Number.isNaN(date.getTime()) ? `${parsed.iso}Z` : formatUtcIso(date);
}

function parseAttendee(line: ContentLine): Attendee | undefined {
  const email = parseCalAddress(line.value);
  if (email.length === 0) return undefined;
  const cn = nonEmptyTrimmed(line.params.CN);
  const roleRaw = line.params.ROLE?.trim().toUpperCase();
  const partstatRaw = line.params.PARTSTAT?.trim().toUpperCase();
  const role = isAttendeeRole(roleRaw) ? roleRaw : undefined;
  const partstat = isPartstat(partstatRaw) ? partstatRaw : undefined;
  const rsvp = parseBool(line.params.RSVP);
  return {
    email,
    ...(cn !== undefined ? { cn } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(partstat !== undefined ? { partstat } : {}),
    ...(rsvp !== undefined ? { rsvp } : {})
  };
}

function parseAlarm(component: Component): Alarm[] {
  const actionRaw = textProp(component, "ACTION")?.trim().toUpperCase();
  if (!isAlarmAction(actionRaw)) return [];
  const triggerLine = prop(component, "TRIGGER");
  if (triggerLine === undefined) return [];
  const description = nonEmpty(textProp(component, "DESCRIPTION"));
  return [
    {
      action: actionRaw,
      trigger: parseTrigger(triggerLine),
      ...(description !== undefined ? { description } : {})
    }
  ];
}

function parseTrigger(line: ContentLine): string {
  const value = line.value.trim();
  const valueType = (line.params.VALUE ?? "").toUpperCase();
  if (valueType === "DURATION" || isDurationTrigger(value)) return value;
  return parseIcsDate(value, line.params).iso;
}

function parseCategories(component: Component): string[] {
  const out: string[] = [];
  for (const line of props(component, "CATEGORIES")) {
    for (const part of splitTextList(line.value)) {
      if (part.length > 0) out.push(part);
    }
  }
  return out;
}

function splitTextList(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      current += ch + (raw[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === ",") {
      parts.push(unescapeText(current));
      current = "";
      continue;
    }
    current += ch ?? "";
  }
  parts.push(unescapeText(current));
  return parts;
}

function parseDateList(component: Component, name: string): string[] {
  const out: string[] = [];
  for (const line of props(component, name)) {
    for (const part of line.value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;
      out.push(parseIcsDate(trimmed, line.params).iso);
    }
  }
  return out;
}

function parseIcsDate(value: string, params: Record<string, string> = {}): ParsedDate {
  const trimmed = value.trim();
  const valueType = (params.VALUE ?? "").toUpperCase();
  const tzid = nonEmptyTrimmed(params.TZID);
  if (valueType === "DATE" || (!trimmed.includes("T") && /^\d{4}-?\d{2}-?\d{2}$/.test(trimmed))) {
    const digits = trimmed.replaceAll("-", "");
    return { iso: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`, allDay: true };
  }
  const match =
    /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(trimmed);
  if (match === null) {
    return { iso: trimmed, allDay: false, ...(tzid !== undefined ? { timezone: tzid } : {}) };
  }
  const year = match[1] ?? "1970";
  const month = match[2] ?? "01";
  const day = match[3] ?? "01";
  const hour = match[4] ?? "00";
  const minute = match[5] ?? "00";
  const second = match[6] ?? "00";
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const suffix = match[7];
  if (suffix === undefined) {
    return { iso: local, allDay: false, ...(tzid !== undefined ? { timezone: tzid } : {}) };
  }
  if (/^Z$/i.test(suffix)) return { iso: `${local}Z`, allDay: false };
  const colonOffset = suffix.length === 5 ? `${suffix.slice(0, 3)}:${suffix.slice(3)}` : suffix;
  const date = new Date(`${local}${colonOffset}`);
  return {
    iso: Number.isNaN(date.getTime()) ? `${local}${colonOffset}` : formatUtcIso(date),
    allDay: false
  };
}

function parseCalAddress(value: string): string {
  const trimmed = value.trim().replace(/^mailto:/i, "");
  const query = trimmed.indexOf("?");
  return (query === -1 ? trimmed : trimmed.slice(0, query)).trim();
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return undefined;
}

function parseBoundedInt(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isInstant(iso: string): boolean {
  return /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
}

function isDurationTrigger(trigger: string): boolean {
  return /^[+-]?P/i.test(trigger.trim());
}

function isEventStatus(value: string | undefined): value is NonNullable<CalendarEvent["status"]> {
  return value !== undefined && EVENT_STATUS.has(value as NonNullable<CalendarEvent["status"]>);
}

function isTodoStatus(value: string | undefined): value is NonNullable<Reminder["status"]> {
  return value !== undefined && TODO_STATUS.has(value as NonNullable<Reminder["status"]>);
}

function isTransparency(
  value: string | undefined
): value is NonNullable<CalendarEvent["transparency"]> {
  return value !== undefined && TRANSPARENCY.has(value as NonNullable<CalendarEvent["transparency"]>);
}

function isAlarmAction(value: string | undefined): value is Alarm["action"] {
  return value !== undefined && ALARM_ACTIONS.has(value as Alarm["action"]);
}

function isAttendeeRole(value: string | undefined): value is NonNullable<Attendee["role"]> {
  return value !== undefined && ATTENDEE_ROLES.has(value as NonNullable<Attendee["role"]>);
}

function isPartstat(value: string | undefined): value is NonNullable<Attendee["partstat"]> {
  return value !== undefined && PARTSTATS.has(value as NonNullable<Attendee["partstat"]>);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatUtcIcs(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function formatUtcIso(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

function stripMillis(iso: string): string {
  return iso.replace(/(\.\d+)(?=Z$|[+-]\d{2}:?\d{2}$|$)/, "");
}

function isoToUtcIcs(iso: string): string {
  const date = isoToDate(iso);
  if (date === undefined) {
    const compact = isoToIcsValue(iso, false);
    return compact.endsWith("Z") ? compact : `${compact}Z`;
  }
  return formatUtcIcs(date);
}

function isoToIcsValue(iso: string, allDay: boolean): string {
  if (allDay) return datePart(iso);
  const normalized = stripMillis(iso);
  if (isInstant(normalized)) {
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return formatUtcIcs(date);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(normalized);
  if (match === null) {
    if (isIsoDateOnly(iso)) return `${iso.replaceAll("-", "")}T000000Z`;
    return normalized.replaceAll(/[-:]/g, "");
  }
  const hour = match[4] ?? "00";
  const minute = match[5] ?? "00";
  const second = match[6] ?? "00";
  return `${match[1]}${match[2]}${match[3]}T${hour}${minute}${second}`;
}

function datePart(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match !== null) return `${match[1]}${match[2]}${match[3]}`;
  const digits = iso.replaceAll(/[^\d]/g, "");
  return digits.slice(0, 8);
}

function emitDateProperty(
  name: string,
  iso: string,
  allDay: boolean,
  timezone: string | undefined
): string {
  const value = isoToIcsValue(iso, allDay);
  const params: Record<string, string> = {};
  // DATE vs DATE-TIME: all-day uses VALUE=DATE; timed uses UTC Z or TZID.
  if (allDay) params.VALUE = "DATE";
  else if (timezone !== undefined && timezone.length > 0 && !isInstant(iso)) params.TZID = timezone;
  return emit(name, value, Object.keys(params).length > 0 ? params : undefined);
}

function emitAlarm(alarm: Alarm): string {
  const chunks = [emit("BEGIN", "VALARM"), emit("ACTION", alarm.action)];
  if (isDurationTrigger(alarm.trigger)) chunks.push(emit("TRIGGER", alarm.trigger.trim()));
  else {
    chunks.push(emit("TRIGGER", isoToIcsValue(alarm.trigger, false), { VALUE: "DATE-TIME" }));
  }
  if (alarm.description !== undefined && alarm.description.length > 0) {
    chunks.push(emit("DESCRIPTION", escapeText(alarm.description)));
  }
  chunks.push(emit("END", "VALARM"));
  return chunks.join("");
}

function emitCalAddress(name: "ATTENDEE" | "ORGANIZER", person: Attendee): string {
  const params: Record<string, string> = {};
  if (person.cn !== undefined && person.cn.length > 0) params.CN = person.cn;
  if (person.role !== undefined) params.ROLE = person.role;
  if (person.partstat !== undefined) params.PARTSTAT = person.partstat;
  if (person.rsvp !== undefined) params.RSVP = person.rsvp ? "TRUE" : "FALSE";
  return emit(
    name,
    `mailto:${person.email.replace(/^mailto:/i, "")}`,
    Object.keys(params).length > 0 ? params : undefined
  );
}

function emit(name: string, value: string, params?: Record<string, string>): string {
  let left = name;
  if (params !== undefined) {
    for (const [key, paramValue] of Object.entries(params)) {
      left += `;${key}=${quoteParam(paramValue)}`;
    }
  }
  return foldIcsLine(`${left}:${value}`);
}

function quoteParam(value: string): string {
  if (/[:;,"]/.test(value)) return `"${value.replaceAll('"', "")}"`;
  return value;
}

function pushText(chunks: string[], name: string, value: string | undefined): void {
  if (value === undefined || value.length === 0) return;
  chunks.push(emit(name, escapeText(value)));
}

function pushDateList(
  chunks: string[],
  name: string,
  values: readonly string[] | undefined,
  allDay: boolean,
  timezone: string | undefined
): void {
  if (values === undefined) return;
  for (const value of values) {
    if (value.length === 0) continue;
    chunks.push(emitDateProperty(name, value, allDay || isIsoDateOnly(value), timezone));
  }
}

function calendarBegin(): string {
  return (
    emit("BEGIN", "VCALENDAR") +
    emit("VERSION", "2.0") +
    emit("PRODID", PRODID) +
    emit("CALSCALE", "GREGORIAN")
  );
}

function calendarEnd(): string {
  return emit("END", "VCALENDAR");
}

function addDurationToIso(iso: string, duration: string): string | undefined {
  const ms = durationToMs(duration);
  if (ms === undefined) return undefined;
  const allDay = isIsoDateOnly(iso);
  const date = isoToDate(iso);
  if (date === undefined) return undefined;
  const next = new Date(date.getTime() + ms);
  if (allDay) {
    return `${next.getUTCFullYear().toString().padStart(4, "0")}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
  }
  if (isInstant(iso)) return formatUtcIso(next);
  return `${next.getUTCFullYear().toString().padStart(4, "0")}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}T${pad2(next.getUTCHours())}:${pad2(next.getUTCMinutes())}:${pad2(next.getUTCSeconds())}`;
}

function isoToDate(iso: string): Date | undefined {
  if (isIsoDateOnly(iso)) {
    const date = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (isInstant(iso)) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(`${stripMillis(iso)}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function durationToMs(duration: string): number | undefined {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
    duration.trim()
  );
  if (match === null) return undefined;
  const sign = match[1] === "-" ? -1 : 1;
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  return sign * ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}
