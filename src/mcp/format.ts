import { z } from "zod";
import { ConfirmationRequiredError, errorMessage, errorName } from "../errors.js";
import { stringifyRedacted } from "../lib/redact.js";
import type { ToolResult } from "../types.js";

export const confirmField = z
  .boolean()
  .optional()
  .describe("Must be true to execute this write.");

export const calendarHrefField = z.string().min(1).describe("Calendar collection href.");
export const eventUidField = z.string().min(1).describe("iCalendar UID.");
export const isoTimeField = z.string().min(1).describe("ISO 8601 date or date-time.");

export function toolSuccess(payload: unknown, secrets: readonly string[] = []): ToolResult {
  return {
    content: [{ type: "text", text: stringifyRedacted(payload, secrets) }]
  };
}

export function toolError(error: unknown, secrets: readonly string[] = []): ToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: stringifyRedacted({ error: errorName(error), message: errorMessage(error) }, secrets)
      }
    ]
  };
}

export function requireConfirm(confirm: boolean | undefined, toolName: string): void {
  if (confirm !== true) throw new ConfirmationRequiredError(toolName);
}

export function recordFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { value };
  return { ...(value as Record<string, unknown>) };
}

export function listPayload(
  items: readonly unknown[],
  pagination?: unknown
): Record<string, unknown> {
  return { items: items.map((item) => recordFields(item)), pagination };
}
