import { describe, expect, it } from "vitest";
import { expandRRule } from "../src/caldav/rrule.js";
import type { CalendarEvent, Occurrence } from "../src/caldav/types.js";

type Seed = Pick<
  CalendarEvent,
  "start" | "end" | "allDay" | "rrule" | "rdates" | "exdates" | "summary" | "uid"
>;

function event(overrides: Seed): Seed {
  return overrides;
}

function starts(items: readonly Occurrence[]): string[] {
  return items.map((item) => item.start);
}

describe("expandRRule", () => {
  it("expands weekly BYDAY=MO", () => {
    const items = expandRRule(
      event({
        uid: "weekly-mo",
        summary: "Monday standup",
        start: "2026-03-16T09:00:00Z",
        end: "2026-03-16T09:30:00Z",
        allDay: false,
        rrule: "FREQ=WEEKLY;BYDAY=MO"
      }),
      new Date("2026-03-16T00:00:00Z"),
      new Date("2026-04-06T09:00:00Z")
    );
    expect(starts(items)).toEqual([
      "2026-03-16T09:00:00Z",
      "2026-03-23T09:00:00Z",
      "2026-03-30T09:00:00Z",
      "2026-04-06T09:00:00Z"
    ]);
    expect(items[0]).toMatchObject({
      uid: "weekly-mo",
      summary: "Monday standup",
      recurrenceId: "2026-03-16T09:00:00Z",
      end: "2026-03-16T09:30:00Z",
      cancelled: false
    });
    expect(items[1]?.end).toBe("2026-03-23T09:30:00Z");
  });

  it("stops at daily COUNT", () => {
    const items = expandRRule(
      event({
        uid: "daily-count",
        summary: "Daily",
        start: "2026-01-01T09:00:00Z",
        end: "2026-01-01T10:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;COUNT=3"
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(items)).toEqual([
      "2026-01-01T09:00:00Z",
      "2026-01-02T09:00:00Z",
      "2026-01-03T09:00:00Z"
    ]);
    expect(items).toHaveLength(3);
  });

  it("honors UNTIL as DATE and UTC datetime", () => {
    const dateUntil = expandRRule(
      event({
        uid: "until-date",
        summary: "Until date",
        start: "2026-01-01T09:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;UNTIL=20260105"
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(dateUntil)).toEqual([
      "2026-01-01T09:00:00Z",
      "2026-01-02T09:00:00Z",
      "2026-01-03T09:00:00Z",
      "2026-01-04T09:00:00Z",
      "2026-01-05T09:00:00Z"
    ]);

    const utcUntil = expandRRule(
      event({
        uid: "until-utc",
        summary: "Until utc",
        start: "2026-01-01T09:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;UNTIL=20260103T090000Z"
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(utcUntil)).toEqual([
      "2026-01-01T09:00:00Z",
      "2026-01-02T09:00:00Z",
      "2026-01-03T09:00:00Z"
    ]);
  });

  it("skips EXDATE instances", () => {
    const items = expandRRule(
      event({
        uid: "exdate",
        summary: "Skip one",
        start: "2026-01-01T09:00:00Z",
        end: "2026-01-01T09:15:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;COUNT=4",
        exdates: ["2026-01-02T09:00:00Z"]
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(items)).toEqual([
      "2026-01-01T09:00:00Z",
      "2026-01-03T09:00:00Z",
      "2026-01-04T09:00:00Z"
    ]);
    expect(items.every((item) => item.cancelled === false)).toBe(true);

    const compact = expandRRule(
      event({
        uid: "exdate-ics",
        summary: "Skip compact",
        start: "2026-01-01T09:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;COUNT=3",
        exdates: ["20260102T090000Z"]
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(compact)).toEqual(["2026-01-01T09:00:00Z", "2026-01-03T09:00:00Z"]);
  });

  it("includes RDATE extras and caps at 400", () => {
    const withRdate = expandRRule(
      event({
        uid: "rdate",
        summary: "Plus rdate",
        start: "2026-01-01T09:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY;COUNT=2",
        rdates: ["2026-01-10T09:00:00Z"]
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-31T23:59:59Z")
    );
    expect(starts(withRdate)).toEqual([
      "2026-01-01T09:00:00Z",
      "2026-01-02T09:00:00Z",
      "2026-01-10T09:00:00Z"
    ]);

    const capped = expandRRule(
      event({
        uid: "cap",
        summary: "Long daily",
        start: "2026-01-01T00:00:00Z",
        allDay: false,
        rrule: "FREQ=DAILY"
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2028-01-01T00:00:00Z")
    );
    expect(capped).toHaveLength(400);
    expect(capped[0]?.start).toBe("2026-01-01T00:00:00Z");
    expect(capped[399]?.start).toBe("2027-02-04T00:00:00Z");
  });

  it("expands monthly BYMONTHDAY and yearly anniversary", () => {
    const monthly = expandRRule(
      event({
        uid: "monthly",
        summary: "Payday",
        start: "2026-01-15T12:00:00Z",
        allDay: false,
        rrule: "FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3"
      }),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-12-31T23:59:59Z")
    );
    expect(starts(monthly)).toEqual([
      "2026-01-15T12:00:00Z",
      "2026-02-15T12:00:00Z",
      "2026-03-15T12:00:00Z"
    ]);

    const yearly = expandRRule(
      event({
        uid: "yearly",
        summary: "Birthday",
        start: "2024-02-29",
        allDay: true,
        rrule: "FREQ=YEARLY"
      }),
      new Date("2024-01-01T00:00:00Z"),
      new Date("2028-12-31T23:59:59Z")
    );
    expect(starts(yearly)).toEqual(["2024-02-29", "2028-02-29"]);
  });
});
