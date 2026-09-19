import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";

export const verify = defineTool(
  "icloud_verify",
  "Verify CalDAV",
  "Authenticate against iCloud CalDAV and confirm the session can reach the calendar service.",
  z.object({}),
  (ctx) => runTool(ctx, async () => ctx.client.verify())
);
