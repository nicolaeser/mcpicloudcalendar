import { z } from "zod";
import type {
  AgendaInput,
  FindConflictsInput,
  SearchEventsInput
} from "../../caldav/client.js";
import { calendarHrefField, eventUidField, isoTimeField } from "../../mcp/format.js";

export const textField = z
  .string()
  .min(1)
  .optional()
  .describe("Match against summary, description, and location.");

export const limitField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Maximum number of events to return.");

export const offsetField = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Number of events to skip.");

export const optionalCalendarHrefField = calendarHrefField
  .optional()
  .describe("Calendar collection href. Omit to include every calendar.");

export const optionalEventUidField = eventUidField
  .optional()
  .describe("Exclude this event UID when checking overlaps.");

export const optionalIsoTimeField = isoTimeField.optional();

export function searchEventsQuery(input: {
  readonly text?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly calendarHref?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}): SearchEventsInput {
  return {
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.end === undefined ? {} : { end: input.end }),
    ...(input.calendarHref === undefined ? {} : { calendarHref: input.calendarHref }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset })
  };
}

export function timeWindowQuery(input: {
  readonly start: string;
  readonly end: string;
  readonly calendarHref?: string | undefined;
}): AgendaInput {
  return {
    start: input.start,
    end: input.end,
    ...(input.calendarHref === undefined ? {} : { calendarHref: input.calendarHref })
  };
}

export function conflictsQuery(input: {
  readonly calendarHref: string;
  readonly start: string;
  readonly end: string;
  readonly uid?: string | undefined;
}): FindConflictsInput {
  return {
    calendarHref: input.calendarHref,
    start: input.start,
    end: input.end,
    ...(input.uid === undefined ? {} : { uid: input.uid })
  };
}
