import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MissingTokenError } from "../errors.js";
import { toolError } from "./format.js";
import { TOOL_CATALOG } from "./catalog.js";
import type { LoginBag } from "../auth/fields.js";
import { credentialsFromBag, type CalendarEnv } from "../auth/login-fields.js";
import {
  defaultClientFactory,
  type CalendarAccountClient,
  type CalendarClientFactory
} from "../caldav/client.js";
import type { ToolContext } from "../types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

export interface McpServerOptions extends CalendarEnv {
  readonly getToken: () => string | undefined;
  readonly getBag?: (() => LoginBag) | undefined;
  readonly createClient?: CalendarClientFactory | undefined;
}

export const MCP_INSTRUCTIONS = [
  "iCloud Calendar over CalDAV. Login is iCloud email plus an app-specific password.",
  "Start with icloud_whoami / icloud_verify / icloud_list_calendars.",
  "Events: icloud_list_events expands RRULE when start+end are set (expand:false for masters). icloud_agenda and icloud_freebusy also expand.",
  "Move events with icloud_move_event (CalDAV MOVE). Series exceptions: icloud_update_occurrence with the instance DTSTART as recurrenceId (ISO or compact ICS, preferably UTC Z).",
  "Writes need confirm: true. Secrets are never returned."
].join(" ");

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS }
  );
  let sharedClient: CalendarAccountClient | undefined;
  const factory = options.createClient ?? defaultClientFactory;

  for (const entry of TOOL_CATALOG) {
    const config = {
      title: entry.title,
      description: entry.description,
      inputSchema: schemaShape(entry.inputSchema),
      annotations: entry.annotations
    };
    const callback = async (args: Record<string, unknown> | undefined) => {
      let ctx: ToolContext | undefined;
      try {
        ctx = createToolContext(options, factory, sharedClient);
        if (sharedClient === undefined) sharedClient = ctx.client;
        return await entry.handler(ctx, args ?? {});
      } catch (error) {
        return toolError(error, ctx?.secrets ?? []);
      }
    };
    server.registerTool(entry.name, config, callback as never);
  }

  return server;
}

function createToolContext(
  options: McpServerOptions,
  factory: CalendarClientFactory,
  shared: CalendarAccountClient | undefined
): ToolContext {
  const token = options.getToken();
  if (token === undefined || token.length === 0) throw new MissingTokenError();
  const bag = options.getBag?.() ?? { secrets: { appPassword: token }, claims: {} };
  const creds = credentialsFromBag(bag, options);
  if (creds === undefined) throw new MissingTokenError();
  const client = shared ?? factory(creds);
  const secrets = [token, creds.password, ...client.secretValues()];
  return {
    client,
    bag,
    secrets: [...new Set(secrets.filter((value) => value.length > 0))]
  };
}

function schemaShape(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape as z.ZodRawShape;
  }
  return {};
}
