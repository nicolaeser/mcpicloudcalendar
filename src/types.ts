import type { LoginBag } from "./auth/fields.js";
import type { CalendarAccountClient } from "./caldav/client.js";

export interface ToolContext {
  readonly client: CalendarAccountClient;
  readonly bag: LoginBag;
  readonly secrets: readonly string[];
}

export type ToolContent = {
  readonly type: "text";
  readonly text: string;
};

export interface ToolResult {
  readonly content: readonly ToolContent[];
  readonly isError?: boolean;
}
