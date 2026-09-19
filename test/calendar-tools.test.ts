import { describe, expect, it } from "vitest";
import {
  parseToolJson,
  SECRET_PASSWORD,
  SECRET_USERNAME,
  toolText,
  withMcpClient
} from "./helpers.js";

const HOME_HREF = "/calendars/home/";
const PLANNING_START = "2099-01-15T14:00:00Z";
const PLANNING_END = "2099-01-15T15:00:00Z";
const PLANNING_SUMMARY = "Planning";

describe("iCloud calendar tools", () => {
  it("lists whoami, calendars, and create_event tools", async () => {
    const { client, close } = await session();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(["icloud_whoami", "icloud_list_calendars", "icloud_create_event"])
      );
      expect(names.some((name) => name.includes("reminder"))).toBe(false);
    } finally {
      await close();
    }
  });

  it("whoami never contains the password", async () => {
    const { client, close } = await session();
    try {
      const result = await client.callTool({ name: "icloud_whoami", arguments: {} });
      const text = toolText(result);
      expect(result.isError ?? false).toBe(false);
      expect(text).not.toContain(SECRET_PASSWORD);
      expect(text.toLowerCase()).not.toContain("abcd-efgh-ijkl-mnop");
      expect(text).toContain(SECRET_USERNAME);
    } finally {
      await close();
    }
  });

  it("list_calendars returns Home, Work, and Reminders", async () => {
    const { client, close } = await session();
    try {
      const result = await client.callTool({ name: "icloud_list_calendars", arguments: {} });
      expect(result.isError ?? false).toBe(false);
      const text = toolText(result);
      expect(text).toContain("Home");
      expect(text).toContain("Work");
      expect(text).toContain("Reminders");
      const names = itemsOf(parseToolJson(result)).map((item) => String(item.displayName ?? ""));
      expect(names).toEqual(expect.arrayContaining(["Home", "Work", "Reminders"]));
    } finally {
      await close();
    }
  });

  it("create_event without confirm errors ConfirmationRequired", async () => {
    const { client, close } = await session();
    try {
      const result = await client.callTool({
        name: "icloud_create_event",
        arguments: {
          calendarHref: HOME_HREF,
          summary: PLANNING_SUMMARY,
          start: PLANNING_START,
          end: PLANNING_END
        }
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toMatch(/ConfirmationRequired/);
    } finally {
      await close();
    }
  });

  it("create_event with confirm:true then get_event", async () => {
    const { client, close } = await session();
    try {
      const created = await client.callTool({
        name: "icloud_create_event",
        arguments: {
          confirm: true,
          calendarHref: HOME_HREF,
          summary: PLANNING_SUMMARY,
          start: PLANNING_START,
          end: PLANNING_END
        }
      });
      expect(created.isError ?? false).toBe(false);
      expect(toolText(created)).toContain(PLANNING_SUMMARY);
      const uid = stringField(parseToolJson(created), "uid");
      expect(uid.length).toBeGreaterThan(0);
      const got = await client.callTool({
        name: "icloud_get_event",
        arguments: { calendarHref: HOME_HREF, uid }
      });
      expect(got.isError ?? false).toBe(false);
      expect(toolText(got)).toContain(PLANNING_SUMMARY);
      expect(toolText(got)).toContain(uid);
    } finally {
      await close();
    }
  });

  it("search or agenda returns Standup", async () => {
    const { client, close } = await session();
    try {
      const search = await client.callTool({
        name: "icloud_search_events",
        arguments: { text: "Standup" }
      });
      expect(search.isError ?? false).toBe(false);
      const range = utcWeekRange();
      const agenda = await client.callTool({
        name: "icloud_agenda",
        arguments: { start: range.start, end: range.end }
      });
      expect(agenda.isError ?? false).toBe(false);
      const blob = `${toolText(search)}\n${toolText(agenda)}`;
      expect(blob).toContain("Standup");
    } finally {
      await close();
    }
  });

  it("moves an event between calendars", async () => {
    const { client, close } = await session();
    try {
      const created = await client.callTool({
        name: "icloud_create_event",
        arguments: {
          confirm: true,
          calendarHref: HOME_HREF,
          summary: "Move me",
          start: PLANNING_START,
          end: PLANNING_END
        }
      });
      const uid = stringField(parseToolJson(created), "uid");
      const moved = await client.callTool({
        name: "icloud_move_event",
        arguments: {
          confirm: true,
          calendarHref: HOME_HREF,
          uid,
          destinationHref: "/calendars/work/"
        }
      });
      expect(moved.isError ?? false).toBe(false);
      expect(toolText(moved)).toContain("/calendars/work/");
    } finally {
      await close();
    }
  });

  it("delete_event with confirm", async () => {
    const { client, close } = await session();
    try {
      const created = await client.callTool({
        name: "icloud_create_event",
        arguments: {
          confirm: true,
          calendarHref: HOME_HREF,
          summary: PLANNING_SUMMARY,
          start: PLANNING_START,
          end: PLANNING_END
        }
      });
      expect(created.isError ?? false).toBe(false);
      const uid = stringField(parseToolJson(created), "uid");
      const deleted = await client.callTool({
        name: "icloud_delete_event",
        arguments: { confirm: true, calendarHref: HOME_HREF, uid }
      });
      expect(deleted.isError ?? false).toBe(false);
      expect(toolText(deleted)).not.toMatch(/ConfirmationRequired/);
    } finally {
      await close();
    }
  });
});

function session() {
  return withMcpClient({ email: SECRET_USERNAME, password: SECRET_PASSWORD });
}

function itemsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  for (const key of ["items", "calendars", "events", "reminders"] as const) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === "string") return value[key];
  return "";
}

function utcWeekRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
