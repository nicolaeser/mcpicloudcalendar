import type { CalendarEvent, Occurrence } from "./types.js";

const DEFAULT_CAP = 400;
const MAX_PERIODS = 100_000;

const WEEKDAY: Readonly<Record<string, number>> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface Civil {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly hh: number;
  readonly mm: number;
  readonly ss: number;
  readonly allDay: boolean;
  readonly tz: string;
}

interface ByDay {
  readonly weekday: number;
  readonly nth?: number;
}

interface ParsedRule {
  readonly freq: Freq;
  readonly interval: number;
  readonly count?: number;
  readonly until?: Civil;
  readonly byDay: readonly ByDay[];
  readonly byMonthDay: readonly number[];
  readonly byMonth: readonly number[];
  readonly wkst: number;
}

interface ExSet {
  readonly instants: ReadonlySet<number>;
  readonly days: ReadonlySet<string>;
}

type RecurringEvent = Pick<
  CalendarEvent,
  "start" | "end" | "allDay" | "rrule" | "rdates" | "exdates" | "summary" | "uid"
>;

export function expandRRule(
  event: Pick<CalendarEvent, "start" | "end" | "allDay" | "rrule" | "rdates" | "exdates" | "summary" | "uid">,
  rangeStart: Date,
  rangeEnd: Date,
  cap?: number
): Occurrence[] {
  const limit = cap === undefined ? DEFAULT_CAP : cap;
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const parsedStart = parseDateTime(event.start);
  if (parsedStart === undefined) return [];
  const dtstart = event.allDay ? asAllDay(parsedStart) : parsedStart;
  const parsedEnd = event.end === undefined ? undefined : parseDateTime(event.end);
  const dtend =
    parsedEnd === undefined ? undefined : event.allDay ? asAllDay(parsedEnd) : parsedEnd;
  const durationSec = durationSeconds(dtstart, dtend);

  const rule = parseRRule(event.rrule);
  const byInstant = new Map<number, Civil>();
  const add = (civil: Civil): void => {
    const ms = toEpoch(civil);
    if (!byInstant.has(ms)) byInstant.set(ms, civil);
  };

  if (rule === undefined) add(dtstart);
  else for (const occ of expandRule(dtstart, rule, rangeEnd.getTime(), limit)) add(occ);

  for (const raw of event.rdates ?? []) {
    const parsed = parseDateTime(raw);
    if (parsed !== undefined) add(event.allDay ? asAllDay(parsed) : parsed);
  }

  const excluded = parseExdates(event.exdates ?? [], event.allDay);
  const sorted = [...byInstant.entries()].sort((a, b) => a[0] - b[0]);
  const out: Occurrence[] = [];
  for (const [ms, civil] of sorted) {
    if (isExcluded(civil, ms, excluded)) continue;
    if (ms < rangeStart.getTime() || ms > rangeEnd.getTime()) continue;
    out.push(toOccurrence(event, civil, applyDuration(civil, durationSec)));
    if (out.length >= limit) break;
  }
  return out;
}

function expandRule(dtstart: Civil, rule: ParsedRule, rangeEndMs: number, cap: number): Civil[] {
  const out: Civil[] = [];
  const seen = new Set<number>();
  const startMs = toEpoch(dtstart);
  const untilMs = rule.until === undefined ? undefined : untilEpoch(rule.until);

  const tryEmit = (civil: Civil): "skip" | "ok" | "stop" => {
    const ms = toEpoch(civil);
    if (seen.has(ms)) return "skip";
    if (ms < startMs) return "skip";
    if (untilMs !== undefined && ms > untilMs) return "stop";
    if (rule.count !== undefined && out.length >= rule.count) return "stop";
    seen.add(ms);
    out.push(civil);
    if (rule.count !== undefined && out.length >= rule.count) return "stop";
    if (ms > rangeEndMs && out.length >= cap) return "stop";
    return "ok";
  };

  const emitAll = (candidates: readonly Civil[]): boolean => {
    for (const civil of candidates) {
      const result = tryEmit(civil);
      if (result === "stop") return false;
    }
    return true;
  };

  if (tryEmit(dtstart) === "stop") return out;

  switch (rule.freq) {
    case "DAILY":
      emitDaily(dtstart, rule, tryEmit, rangeEndMs, untilMs);
      break;
    case "WEEKLY":
      emitWeekly(dtstart, rule, emitAll, rangeEndMs, untilMs);
      break;
    case "MONTHLY":
      emitMonthly(dtstart, rule, emitAll, rangeEndMs, untilMs);
      break;
    case "YEARLY":
      emitYearly(dtstart, rule, emitAll, rangeEndMs, untilMs);
      break;
  }
  return out;
}

function emitDaily(
  dtstart: Civil,
  rule: ParsedRule,
  tryEmit: (civil: Civil) => "skip" | "ok" | "stop",
  rangeEndMs: number,
  untilMs: number | undefined
): void {
  let cursor = addDays(dtstart, rule.interval);
  for (let i = 0; i < MAX_PERIODS; i += 1) {
    const ms = toEpoch(cursor);
    if (untilMs !== undefined && ms > untilMs) return;
    if (ms > rangeEndMs && ms > toEpoch(dtstart)) return;
    if (matchesLimitParts(cursor, rule) && tryEmit(cursor) === "stop") return;
    cursor = addDays(cursor, rule.interval);
  }
}

function emitWeekly(
  dtstart: Civil,
  rule: ParsedRule,
  emitAll: (candidates: readonly Civil[]) => boolean,
  rangeEndMs: number,
  untilMs: number | undefined
): void {
  const days = uniqueWeekdays(rule.byDay.length > 0 ? rule.byDay : [{ weekday: weekday(dtstart) }]);
  let week = startOfWeek(dtstart, rule.wkst);
  for (let i = 0; i < MAX_PERIODS; i += 1) {
    const weekMs = toEpoch(week);
    if (untilMs !== undefined && weekMs > untilMs) return;
    if (weekMs - 7 * 86_400_000 > rangeEndMs) return;
    const candidates: Civil[] = [];
    for (const wd of days) {
      const occ = addDays(week, (wd - rule.wkst + 7) % 7);
      if (matchesLimitParts(occ, rule)) candidates.push(occ);
    }
    candidates.sort((a, b) => toEpoch(a) - toEpoch(b));
    if (!emitAll(candidates)) return;
    week = addDays(week, 7 * rule.interval);
  }
}

function emitMonthly(
  dtstart: Civil,
  rule: ParsedRule,
  emitAll: (candidates: readonly Civil[]) => boolean,
  rangeEndMs: number,
  untilMs: number | undefined
): void {
  let year = dtstart.y;
  let month = dtstart.m;
  for (let i = 0; i < MAX_PERIODS; i += 1) {
    const probe = atDate(dtstart, year, month, 1);
    const probeMs = toEpoch(probe);
    if (untilMs !== undefined && probeMs > untilMs) return;
    if (probeMs > rangeEndMs && (year > dtstart.y || month > dtstart.m)) return;
    const candidates = monthCandidates(year, month, dtstart, rule);
    if (!emitAll(candidates)) return;
    const next = addMonths(year, month, rule.interval);
    year = next.y;
    month = next.m;
  }
}

function emitYearly(
  dtstart: Civil,
  rule: ParsedRule,
  emitAll: (candidates: readonly Civil[]) => boolean,
  rangeEndMs: number,
  untilMs: number | undefined
): void {
  let year = dtstart.y;
  for (let i = 0; i < MAX_PERIODS; i += 1) {
    const probe = atDate(dtstart, year, 1, 1);
    const probeMs = toEpoch(probe);
    if (untilMs !== undefined && probeMs > untilMs) return;
    if (year > dtstart.y && probeMs > rangeEndMs) return;
    const months = yearMonths(dtstart, rule);
    const candidates: Civil[] = [];
    for (const month of months) candidates.push(...monthCandidates(year, month, dtstart, rule));
    candidates.sort((a, b) => toEpoch(a) - toEpoch(b));
    if (!emitAll(candidates)) return;
    year += rule.interval;
  }
}

function yearMonths(dtstart: Civil, rule: ParsedRule): readonly number[] {
  if (rule.byMonth.length > 0) return [...rule.byMonth].sort((a, b) => a - b);
  if (rule.freq === "YEARLY" && (rule.byDay.length > 0 || rule.byMonthDay.length > 0)) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
  return [dtstart.m];
}

function monthCandidates(year: number, month: number, template: Civil, rule: ParsedRule): Civil[] {
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(month)) return [];
  const byDay = rule.byDay;
  const byMonthDay = rule.byMonthDay;
  if (byMonthDay.length > 0 && byDay.length > 0) {
    const weekdays = new Set(byDay.map((entry) => entry.weekday));
    return resolveMonthDays(year, month, byMonthDay, template).filter((civil) =>
      weekdays.has(weekday(civil))
    );
  }
  if (byMonthDay.length > 0) return resolveMonthDays(year, month, byMonthDay, template);
  if (byDay.length > 0) {
    const out: Civil[] = [];
    for (const entry of byDay) out.push(...weekdaysInMonth(year, month, entry, template));
    out.sort((a, b) => toEpoch(a) - toEpoch(b));
    return out;
  }
  const dim = daysInMonth(year, month);
  if (template.d > dim) return [];
  return [atDate(template, year, month, template.d)];
}

function resolveMonthDays(
  year: number,
  month: number,
  byMonthDay: readonly number[],
  template: Civil
): Civil[] {
  const out: Civil[] = [];
  const seen = new Set<number>();
  for (const n of byMonthDay) {
    const day = resolveMonthDay(year, month, n);
    if (day === undefined || seen.has(day)) continue;
    seen.add(day);
    out.push(atDate(template, year, month, day));
  }
  out.sort((a, b) => toEpoch(a) - toEpoch(b));
  return out;
}

function weekdaysInMonth(year: number, month: number, byDay: ByDay, template: Civil): Civil[] {
  const nth = byDay.nth;
  if (nth !== undefined) {
    const day = nthWeekdayOfMonth(year, month, byDay.weekday, nth);
    return day === undefined ? [] : [atDate(template, year, month, day)];
  }
  const dim = daysInMonth(year, month);
  const first = weekdayOf(year, month, 1);
  let day = 1 + ((byDay.weekday - first + 7) % 7);
  const out: Civil[] = [];
  while (day <= dim) {
    out.push(atDate(template, year, month, day));
    day += 7;
  }
  return out;
}

function matchesLimitParts(civil: Civil, rule: ParsedRule): boolean {
  if (rule.byMonth.length > 0 && !rule.byMonth.includes(civil.m)) return false;
  if (rule.freq === "DAILY" && rule.byDay.length > 0) {
    const days = new Set(rule.byDay.map((entry) => entry.weekday));
    if (!days.has(weekday(civil))) return false;
  }
  if (rule.byMonthDay.length === 0) return true;
  const allowed = new Set(
    rule.byMonthDay
      .map((n) => resolveMonthDay(civil.y, civil.m, n))
      .filter((day): day is number => day !== undefined)
  );
  return allowed.has(civil.d);
}

function parseRRule(raw: string | undefined): ParsedRule | undefined {
  if (raw === undefined) return undefined;
  let text = raw.trim();
  if (text.length === 0) return undefined;
  if (text.toUpperCase().startsWith("RRULE:")) text = text.slice(6).trim();
  let freq: Freq | undefined;
  let interval = 1;
  let count: number | undefined;
  let until: Civil | undefined;
  let byDay: ByDay[] = [];
  let byMonthDay: number[] = [];
  let byMonth: number[] = [];
  let wkst = 1;
  for (const segment of text.split(";")) {
    const part = segment.trim();
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    if (key === "FREQ") {
      const upper = value.toUpperCase();
      if (upper === "DAILY" || upper === "WEEKLY" || upper === "MONTHLY" || upper === "YEARLY") {
        freq = upper;
      }
    } else if (key === "INTERVAL") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 1) interval = parsed;
    } else if (key === "COUNT") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 1) count = parsed;
    } else if (key === "UNTIL") {
      until = parseDateTime(value);
    } else if (key === "BYDAY") {
      byDay = parseByDay(value);
    } else if (key === "BYMONTHDAY") {
      byMonthDay = parseInts(value, -31, 31).filter((n) => n !== 0);
    } else if (key === "BYMONTH") {
      byMonth = parseInts(value, 1, 12);
    } else if (key === "WKST") {
      const wd = WEEKDAY[value.toUpperCase()];
      if (wd !== undefined) wkst = wd;
    }
  }
  if (freq === undefined) return undefined;
  const parsed: ParsedRule = { freq, interval, byDay, byMonthDay, byMonth, wkst };
  return {
    ...parsed,
    ...(count === undefined ? {} : { count }),
    ...(until === undefined ? {} : { until })
  };
}

function parseByDay(value: string): ByDay[] {
  const out: ByDay[] = [];
  for (const piece of value.split(",")) {
    const token = piece.trim().toUpperCase();
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
    if (match === null) continue;
    const name = match[2];
    if (name === undefined) continue;
    const weekdayNum = WEEKDAY[name];
    if (weekdayNum === undefined) continue;
    const nthRaw = match[1];
    if (nthRaw === undefined || nthRaw.length === 0) {
      out.push({ weekday: weekdayNum });
      continue;
    }
    const nth = Number.parseInt(nthRaw, 10);
    if (!Number.isFinite(nth) || nth === 0) continue;
    out.push({ weekday: weekdayNum, nth });
  }
  return out;
}

function parseInts(value: string, min: number, max: number): number[] {
  const out: number[] = [];
  for (const piece of value.split(",")) {
    const parsed = Number.parseInt(piece.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) continue;
    if (!out.includes(parsed)) out.push(parsed);
  }
  return out;
}

function parseDateTime(raw: string): Civil | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (/^\d{4}-?\d{2}-?\d{2}$/.test(trimmed) && !trimmed.includes("T")) {
    const digits = trimmed.replaceAll("-", "");
    const y = Number(digits.slice(0, 4));
    const m = Number(digits.slice(4, 6));
    const d = Number(digits.slice(6, 8));
    if (!validYmd(y, m, d)) return undefined;
    return { y, m, d, hh: 0, mm: 0, ss: 0, allDay: true, tz: "" };
  }
  const match =
    /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      trimmed
    );
  if (match === null) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  const ss = Number(match[6]);
  if (!validYmd(y, m, d) || hh > 23 || mm > 59 || ss > 60) return undefined;
  const suffix = match[7];
  if (suffix === undefined) {
    return { y, m, d, hh, mm, ss, allDay: false, tz: "" };
  }
  if (/^Z$/i.test(suffix)) {
    return { y, m, d, hh, mm, ss, allDay: false, tz: "Z" };
  }
  const tz = suffix.length === 5 ? `${suffix.slice(0, 3)}:${suffix.slice(3)}` : suffix;
  return { y, m, d, hh, mm, ss, allDay: false, tz };
}

function parseExdates(values: readonly string[], allDay: boolean): ExSet {
  const instants = new Set<number>();
  const days = new Set<string>();
  for (const raw of values) {
    const parsed = parseDateTime(raw);
    if (parsed === undefined) continue;
    const civil = allDay ? asAllDay(parsed) : parsed;
    if (civil.allDay) days.add(ymd(civil));
    else instants.add(toEpoch(civil));
  }
  return { instants, days };
}

function isExcluded(civil: Civil, ms: number, excluded: ExSet): boolean {
  if (excluded.instants.has(ms)) return true;
  return excluded.days.has(ymd(civil));
}

function toOccurrence(event: RecurringEvent, start: Civil, end: Civil | undefined): Occurrence {
  const occurrence: Occurrence = {
    uid: event.uid,
    recurrenceId: formatCivil(start),
    start: formatCivil(start),
    summary: event.summary,
    cancelled: false
  };
  return end === undefined ? occurrence : { ...occurrence, end: formatCivil(end) };
}

function formatCivil(civil: Civil): string {
  const day = ymd(civil);
  if (civil.allDay) return day;
  return `${day}T${pad2(civil.hh)}:${pad2(civil.mm)}:${pad2(civil.ss)}${civil.tz}`;
}

function asAllDay(civil: Civil): Civil {
  return { y: civil.y, m: civil.m, d: civil.d, hh: 0, mm: 0, ss: 0, allDay: true, tz: "" };
}

function atDate(template: Civil, y: number, m: number, d: number): Civil {
  return { ...template, y, m, d };
}

function ymd(civil: Civil): string {
  return `${String(civil.y).padStart(4, "0")}-${pad2(civil.m)}-${pad2(civil.d)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekday(civil: Civil): number {
  return weekdayOf(civil.y, civil.m, civil.d);
}

function startOfWeek(civil: Civil, wkst: number): Civil {
  return addDays(civil, -((weekday(civil) - wkst + 7) % 7));
}

function uniqueWeekdays(days: readonly ByDay[]): number[] {
  const out: number[] = [];
  for (const entry of days) {
    if (!out.includes(entry.weekday)) out.push(entry.weekday);
  }
  return out;
}

function nthWeekdayOfMonth(y: number, m: number, wd: number, nth: number): number | undefined {
  const dim = daysInMonth(y, m);
  if (nth > 0) {
    const first = weekdayOf(y, m, 1);
    const day = 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
    return day > dim ? undefined : day;
  }
  if (nth < 0) {
    const last = weekdayOf(y, m, dim);
    const day = dim - ((last - wd + 7) % 7) + (nth + 1) * 7;
    return day < 1 ? undefined : day;
  }
  return undefined;
}

function resolveMonthDay(y: number, m: number, n: number): number | undefined {
  const dim = daysInMonth(y, m);
  if (n > 0) return n <= dim ? n : undefined;
  if (n < 0) {
    const day = dim + n + 1;
    return day >= 1 && day <= dim ? day : undefined;
  }
  return undefined;
}

function addMonths(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function addDays(civil: Civil, days: number): Civil {
  const ms = Date.UTC(civil.y, civil.m - 1, civil.d + days, civil.hh, civil.mm, civil.ss);
  return fromUtcParts(ms, civil);
}

function addSeconds(civil: Civil, seconds: number): Civil {
  const ms = Date.UTC(civil.y, civil.m - 1, civil.d, civil.hh, civil.mm, civil.ss + seconds);
  return fromUtcParts(ms, civil);
}

function fromUtcParts(ms: number, template: Civil): Civil {
  const date = new Date(ms);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    hh: date.getUTCHours(),
    mm: date.getUTCMinutes(),
    ss: date.getUTCSeconds(),
    allDay: template.allDay,
    tz: template.tz
  };
}

function toEpoch(civil: Civil): number {
  const utc = Date.UTC(
    civil.y,
    civil.m - 1,
    civil.d,
    civil.allDay ? 0 : civil.hh,
    civil.allDay ? 0 : civil.mm,
    civil.allDay ? 0 : civil.ss
  );
  if (civil.allDay || civil.tz === "Z" || civil.tz === "") return utc;
  return utc - offsetMs(civil.tz);
}

function untilEpoch(until: Civil): number {
  // DATE UNTIL is inclusive of that calendar day (RFC 5545).
  if (until.allDay) return Date.UTC(until.y, until.m - 1, until.d, 23, 59, 59);
  return toEpoch(until);
}

function offsetMs(tz: string): number {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (match === null) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60_000;
}

function durationSeconds(start: Civil, end: Civil | undefined): number | undefined {
  if (end === undefined) return undefined;
  if (start.allDay && end.allDay) {
    const days =
      Date.UTC(end.y, end.m - 1, end.d) / 86_400_000 - Date.UTC(start.y, start.m - 1, start.d) / 86_400_000;
    return days * 86_400;
  }
  return Math.round((toEpoch(end) - toEpoch(start)) / 1000);
}

function applyDuration(start: Civil, seconds: number | undefined): Civil | undefined {
  if (seconds === undefined) return undefined;
  if (start.allDay) return addDays(start, Math.round(seconds / 86_400));
  return addSeconds(start, seconds);
}
