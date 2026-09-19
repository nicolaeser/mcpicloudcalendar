import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { TypeOf, ZodTypeAny } from "zod";
import { toolError, toolSuccess } from "./format.js";
import type { ToolContext, ToolResult } from "../types.js";

export interface CatalogTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ZodTypeAny;
  readonly annotations: ToolAnnotations;
  readonly handler: (ctx: ToolContext, args: unknown) => Promise<ToolResult>;
}

export function defineTool<TSchema extends ZodTypeAny>(
  name: string,
  title: string,
  description: string,
  inputSchema: TSchema,
  handler: (ctx: ToolContext, args: TypeOf<TSchema>) => Promise<ToolResult>,
  annotations: ToolAnnotations = {}
): CatalogTool {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      title,
      openWorldHint: true,
      ...hintsForName(name),
      ...annotations
    },
    handler: (ctx, args) => handler(ctx, inputSchema.parse(args) as TypeOf<TSchema>)
  };
}

export async function runTool(
  ctx: ToolContext,
  execute: () => Promise<unknown>
): Promise<ToolResult> {
  try {
    const payload = await execute();
    return toolSuccess(payload, secretsFor(ctx));
  } catch (error) {
    return toolError(error, secretsFor(ctx));
  }
}

function secretsFor(ctx: ToolContext): readonly string[] {
  const secrets: string[] = [];
  for (const value of [...ctx.secrets, ...ctx.client.secretValues()]) {
    if (value.length > 0 && !secrets.includes(value)) secrets.push(value);
  }
  return secrets;
}

function hintsForName(name: string): ToolAnnotations {
  const key = name.replace(/^icloud_/, "");
  const write =
    /^(create_|update_|delete_|move_|duplicate_|set_|invite_|remove_|rsvp|complete_|uncomplete_|cancel_|put_)/.test(
      key
    );
  const readOnly =
    !write &&
    /^(list_|get_|search_|whoami|verify|agenda|freebusy|find_|expand_|sync_|today|overdue|undated|inbox)/.test(
      key
    );
  const destructive = write && /delete|cancel/.test(key);
  const idempotent = readOnly || /^(delete_|set_|move_|complete_|remove_|rsvp|cancel_|put_)/.test(key);
  if (readOnly) {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
  }
  return {
    readOnlyHint: false,
    destructiveHint: destructive,
    idempotentHint: idempotent
  };
}
