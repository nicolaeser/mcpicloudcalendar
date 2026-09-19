import { describe, expect, it } from "vitest";
import {
  escapeText,
  eventFromCreate,
  extractUid,
  foldIcsLine,
  generateEvent,
  generateReminder,
  mergeEvent,
  parseCalendar,
  parseEvent,
  parseReminder,
  reminderFromCreate,
  unescapeText,
  unfoldIcs
} from "../src/caldav/ics.js";
import { CalendarAccountError, type CalendarEvent, type Reminder } from "../src/caldav/types.js";

const CALENDAR_HREF = "/calendars/home/";

describe("folding and escaping", () => {
  it("unfolds CRLF plus linear whitespace continuation", () => {
    expect(unfoldIcs("SUMMARY:Hel\r\n lo\r\n").trim()).toBe("SUMMARY:Hello");
    expect(unfoldIcs("SUMMARY:Hel\n lo\n").trim()).toBe("SUMMARY:Hello");
  });

  it("folds at 75 octets with CRLF and a single space continuation", () => {
    const line = `DESCRIPTION:${"a".repeat(80)}`;
    const folded = foldIcsLine(line);
    expect(folded.endsWith("\r\n")).toBe(true);
    const physical = folded.replace(/\r\n$/, "").split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    expect(physical[1]?.startsWith(" ")).toBe(true);
    for (const physicalLine of physical) {
      expect(new TextEncoder().encode(physicalLine).length).toBeLessThanOrEqual(75);
    }
    expect(unfoldIcs(folded).trimEnd()).toBe(line);
  });

  it("does not fold a 75-octet line", () => {
    const line = `SUMMARY:${"b".repeat(67)}`;
    expect(new TextEncoder().encode(line).length).toBe(75);
    expect(foldIcsLine(line)).toBe(`${line}\r\n`);
  });

  it("does not split a UTF-8 character when folding", () => {
    const line = `${"c".repeat(74)}ü`;
    const folded = foldIcsLine(line);
    const physical = folded.replace(/\r\n$/, "").split("\r\n");
    expect(physical[0]).toBe("c".repeat(74));
    expect(physical[1]).toBe(" ü");
    expect(unfoldIcs(folded).trimEnd()).toBe(line);
  });

  it("escapes backslash, semicolon, comma, and newlines", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    expect(unescapeText("a\\\\b\\;c\\,d\\ne")).toBe("a\\b;c,d\ne");
    expect(unescapeText("line\\Ntwo")).toBe("line\ntwo");
  });
});

describe("extractUid / factories / merge", () => {
  it("extracts UID from folded ICS", () => {
    const uid = `${"u".repeat(80)}@mcpicloudcalendar.test`;
    const ics = ["BEGIN:VEVENT", foldIcsLine(`UID:${uid}`).trimEnd(), "END:VEVENT"].join("\r\n");
    expect(extractUid(ics)).toBe(uid);
    expect(extractUid("SUMMARY:No uid")).toBeUndefined();
  });

  it("eventFromCreate infers all-day and copies calendar href", () => {
    const event = eventFromCreate(
      {
        calendarHref: CALENDAR_HREF,
        summary: "Birthday",
        start: "2026-07-04",
        end: "2026-07-05",
        description: "Party"
      },
      "birthday@mcpicloudcalendar.test",
      `${CALENDAR_HREF}birthday@mcpicloudcalendar.test.ics`
    );
    expect(event.allDay).toBe(true);
    expect(event.uid).toBe("birthday@mcpicloudcalendar.test");
    expect(event.href).toBe(`${CALENDAR_HREF}birthday@mcpicloudcalendar.test.ics`);
    expect(event.calendarHref).toBe(CALENDAR_HREF);
    expect(event.attendees).toEqual([]);
    expect(event.alarms).toEqual([]);
  });

  it("reminderFromCreate keeps due and priority including zero", () => {
    const reminder = reminderFromCreate(
      {
        calendarHref: "/calendars/reminders/",
        summary: "Milk",
        due: "2026-06-15",
        priority: 0
      },
      "milk@mcpicloudcalendar.test",
      "/calendars/reminders/milk@mcpicloudcalendar.test.ics"
    );
    expect(reminder.due).toBe("2026-06-15");
    expect(reminder.priority).toBe(0);
    expect(reminder.alarms).toEqual([]);
  });

  it("mergeEvent patches summary and attendees without dropping start", () => {
    const existing = eventFromCreate(
      {
        calendarHref: CALENDAR_HREF,
        summary: "Standup",
        start: "2026-06-01T09:00:00Z",
        end: "2026-06-01T09:30:00Z",
        location: "Room A"
      },
      "standup@mcpicloudcalendar.test",
      `${CALENDAR_HREF}standup@mcpicloudcalendar.test.ics`
    );
    const merged = mergeEvent(existing, {
      summary: "Standup (moved)",
      attendees: [{ email: "alex@example.com", partstat: "ACCEPTED" }]
    });
    expect(merged.start).toBe("2026-06-01T09:00:00Z");
    expect(merged.location).toBe("Room A");
    expect(merged.summary).toBe("Standup (moved)");
    expect(merged.attendees).toEqual([{ email: "alex@example.com", partstat: "ACCEPTED" }]);
  });
});

describe("ICS round-trip", () => {
  it("preserves a timed UTC event", () => {
    const event = timedEvent();
    const ics = generateEvent(event);
    assertRfcCalendar(ics);
    expect(ics).toContain("DTSTART:20260601T090000Z");
    expect(ics).toContain("DTEND:20260601T093000Z");
    expect(ics).not.toContain("VALUE=DATE");
    const parsed = parseEvent(ics);
    expectRoundTrippedEvent(parsed, event);
  });

  it("preserves an all-day event as VALUE=DATE", () => {
    const event: CalendarEvent = {
      uid: "birthday@mcpicloudcalendar.test",
      href: `${CALENDAR_HREF}birthday@mcpicloudcalendar.test.ics`,
      calendarHref: CALENDAR_HREF,
      summary: "Birthday",
      start: "2026-07-04",
      end: "2026-07-05",
      allDay: true,
      attendees: [],
      alarms: []
    };
    const ics = generateEvent(event);
    assertRfcCalendar(ics);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20260704/);
    expect(ics).toMatch(/DTEND;VALUE=DATE:20260705/);
    expectRoundTrippedEvent(parseEvent(ics), event);
  });

  it("preserves RRULE and EXDATEs", () => {
    const event: CalendarEvent = {
      uid: "weekly@mcpicloudcalendar.test",
      href: `${CALENDAR_HREF}weekly@mcpicloudcalendar.test.ics`,
      calendarHref: CALENDAR_HREF,
      summary: "Weekly sync",
      start: "2026-06-01T14:00:00Z",
      end: "2026-06-01T15:00:00Z",
      allDay: false,
      attendees: [],
      alarms: [],
      rrule: "FREQ=WEEKLY;BYDAY=MO;INTERVAL=1",
      exdates: ["2026-06-08T14:00:00Z", "2026-06-22T14:00:00Z"],
      rdates: ["2026-06-17T14:00:00Z"]
    };
    const ics = generateEvent(event);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=1");
    expect(ics).toContain("EXDATE:20260608T140000Z");
    expect(ics).toContain("EXDATE:20260622T140000Z");
    expect(ics).toContain("RDATE:20260617T140000Z");
    expectRoundTrippedEvent(parseEvent(ics), event);
  });

  it("preserves attendees, PARTSTAT, and a quoted CN comma", () => {
    const event: CalendarEvent = {
      uid: "invite@mcpicloudcalendar.test",
      href: `${CALENDAR_HREF}invite@mcpicloudcalendar.test.ics`,
      calendarHref: CALENDAR_HREF,
      summary: "Design review",
      start: "2026-06-03T16:00:00Z",
      end: "2026-06-03T17:00:00Z",
      allDay: false,
      status: "CONFIRMED",
      transparency: "OPAQUE",
      organizer: { email: "owner@example.com", cn: "Owner" },
      attendees: [
        {
          email: "alex@example.com",
          cn: "Example, Alex",
          role: "REQ-PARTICIPANT",
          partstat: "ACCEPTED",
          rsvp: true
        },
        {
          email: "blair@example.com",
          cn: "Blair",
          role: "OPT-PARTICIPANT",
          partstat: "TENTATIVE",
          rsvp: false
        }
      ],
      alarms: []
    };
    const ics = generateEvent(event);
    const unfolded = unfoldIcs(ics);
    expect(unfolded).toContain('CN="Example, Alex"');
    expect(unfolded).toContain("PARTSTAT=ACCEPTED");
    expect(unfolded).toContain("PARTSTAT=TENTATIVE");
    expect(unfolded).toContain("RSVP=TRUE");
    expect(unfolded).toContain("RSVP=FALSE");
    expect(unfolded).toContain("mailto:alex@example.com");
    expectRoundTrippedEvent(parseEvent(ics), event);
  });

  it("preserves a DISPLAY alarm 15 minutes before", () => {
    const event: CalendarEvent = {
      ...timedEvent(),
      uid: "alarmed@mcpicloudcalendar.test",
      alarms: [{ action: "DISPLAY", trigger: "-PT15M", description: "Reminder" }]
    };
    const ics = generateEvent(event);
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("ACTION:DISPLAY");
    expect(ics).toContain("TRIGGER:-PT15M");
    expectRoundTrippedEvent(parseEvent(ics), event);
  });

  it("preserves a VTODO with due date", () => {
    const reminder: Reminder = {
      uid: "todo@mcpicloudcalendar.test",
      href: "/calendars/reminders/todo@mcpicloudcalendar.test.ics",
      calendarHref: "/calendars/reminders/",
      summary: "File taxes",
      description: "Bring forms",
      due: "2026-06-15",
      priority: 1,
      status: "NEEDS-ACTION",
      alarms: [{ action: "DISPLAY", trigger: "-PT15M", description: "Due soon" }]
    };
    const ics = generateReminder(reminder);
    assertRfcCalendar(ics);
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toMatch(/DUE;VALUE=DATE:20260615/);
    expect(ics).toContain("PRIORITY:1");
    const parsed = parseReminder(ics);
    expect(parsed.uid).toBe(reminder.uid);
    expect(parsed.summary).toBe(reminder.summary);
    expect(parsed.due).toBe(reminder.due);
    expect(parsed.priority).toBe(reminder.priority);
    expect(parsed.status).toBe(reminder.status);
    expect(parsed.description).toBe(reminder.description);
    expect(parsed.alarms).toEqual(reminder.alarms);
    expect(parsed.href).toBe("");
    expect(parsed.calendarHref).toBe("");
  });

  it("round-trips TZID timed events and escaped description text", () => {
    const event: CalendarEvent = {
      uid: "berlin@mcpicloudcalendar.test",
      href: `${CALENDAR_HREF}berlin@mcpicloudcalendar.test.ics`,
      calendarHref: CALENDAR_HREF,
      summary: "Café 🎉",
      description: "Bring laptop; snacks, and a smile.\nSecond line",
      location: "Berlin, DE",
      start: "2026-03-09T10:30:00",
      end: "2026-03-09T11:30:00",
      allDay: false,
      timezone: "Europe/Berlin",
      categories: ["Work", "Focus"],
      attendees: [],
      alarms: []
    };
    const ics = generateEvent(event);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260309T103000");
    expect(ics).toContain("DESCRIPTION:Bring laptop\\; snacks\\, and a smile.\\nSecond line");
    const parsed = parseEvent(ics);
    expectRoundTrippedEvent(parsed, event);
    expect(parsed.categories).toEqual(["Work", "Focus"]);
  });
});

describe("parseCalendar", () => {
  it("parses mixed VEVENT and VTODO and ignores VTIMEZONE DTSTART", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example//EN",
      "X-WR-TIMEZONE:Europe/Berlin",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:meeting@mcpicloudcalendar.test",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=Europe/Berlin:20260309T090000",
      "DTEND;TZID=Europe/Berlin:20260309T100000",
      "SUMMARY:Planning",
      "END:VEVENT",
      "BEGIN:VTODO",
      "UID:task@mcpicloudcalendar.test",
      "DTSTAMP:20260101T000000Z",
      "SUMMARY:Follow up",
      "DUE;VALUE=DATE:20260310",
      "END:VTODO",
      "END:VCALENDAR"
    ].join("\n");
    const parsed = parseCalendar(ics);
    expect(parsed.raw).toBe(ics);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.reminders).toHaveLength(1);
    expect(parsed.events[0]?.start).toBe("2026-03-09T09:00:00");
    expect(parsed.events[0]?.end).toBe("2026-03-09T10:00:00");
    expect(parsed.events[0]?.timezone).toBe("Europe/Berlin");
    expect(parsed.events[0]?.allDay).toBe(false);
    expect(parsed.events[0]?.href).toBe("");
    expect(parsed.events[0]?.calendarHref).toBe("");
    expect(parsed.reminders[0]?.due).toBe("2026-03-10");
    expect(parsed.reminders[0]?.summary).toBe("Follow up");
  });

  it("computes DTEND from DURATION and accepts LF-only input", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:duration@mcpicloudcalendar.test",
      "DTSTART:20260601T090000Z",
      "DURATION:PT30M",
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\n");
    expect(parseEvent(ics).end).toBe("2026-06-01T09:30:00Z");
  });

  it("throws when the expected component is missing", () => {
    expect(() => parseEvent("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")).toThrow(CalendarAccountError);
    expect(() => parseReminder(generateEvent(timedEvent()))).toThrow(CalendarAccountError);
  });
});

function timedEvent(): CalendarEvent {
  return {
    uid: "standup@mcpicloudcalendar.test",
    href: `${CALENDAR_HREF}standup@mcpicloudcalendar.test.ics`,
    calendarHref: CALENDAR_HREF,
    summary: "Standup",
    start: "2026-06-01T09:00:00Z",
    end: "2026-06-01T09:30:00Z",
    allDay: false,
    attendees: [],
    alarms: []
  };
}

function assertRfcCalendar(ics: string): void {
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("PRODID:-//mcpicloudcalendar//EN");
  expect(ics).toContain("UID:");
  expect(ics).toContain("DTSTAMP:");
  expect(ics.endsWith("\r\n")).toBe(true);
  expect(ics).not.toMatch(/(?<!\r)\n/);
}

function expectRoundTrippedEvent(parsed: CalendarEvent, original: CalendarEvent): void {
  expect(parsed.uid).toBe(original.uid);
  expect(parsed.summary).toBe(original.summary);
  expect(parsed.start).toBe(original.start);
  expect(parsed.allDay).toBe(original.allDay);
  expect(parsed.end).toBe(original.end);
  expect(parsed.timezone).toBe(original.timezone);
  expect(parsed.description).toBe(original.description);
  expect(parsed.location).toBe(original.location);
  expect(parsed.status).toBe(original.status);
  expect(parsed.transparency).toBe(original.transparency);
  expect(parsed.rrule).toBe(original.rrule);
  expect(parsed.rdates).toEqual(original.rdates);
  expect(parsed.exdates).toEqual(original.exdates);
  expect(parsed.organizer).toEqual(original.organizer);
  expect(parsed.attendees).toEqual(original.attendees);
  expect(parsed.alarms).toEqual(original.alarms);
  expect(parsed.href).toBe("");
  expect(parsed.calendarHref).toBe("");
}
