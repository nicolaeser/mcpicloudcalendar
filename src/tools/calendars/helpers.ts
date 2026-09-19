import { z } from "zod";
import type { CreateCalendarInput, UpdateCalendarInput } from "../../caldav/types.js";

export const displayNameField = z.string().min(1).describe("Calendar display name.");

export const descriptionField = z.string().optional().describe("Calendar description.");

export const colorField = z.string().optional().describe("Calendar color as #RRGGBB.");

export const componentsField = z
  .array(z.enum(["VEVENT", "VTODO"]))
  .optional()
  .describe("Supported calendar components (VEVENT, VTODO).");

export function calendarPatch(input: {
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
}): UpdateCalendarInput {
  return {
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.color === undefined ? {} : { color: input.color })
  };
}

export function calendarCreateInput(input: {
  readonly displayName: string;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
  readonly components?: ReadonlyArray<"VEVENT" | "VTODO"> | undefined;
}): CreateCalendarInput {
  return {
    displayName: input.displayName,
    ...calendarPatch(input),
    ...(input.components === undefined ? {} : { components: input.components })
  };
}
