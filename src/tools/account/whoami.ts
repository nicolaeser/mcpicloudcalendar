import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";

export const whoami = defineTool(
  "icloud_whoami",
  "Who am I",
  "Show the connected CalDAV URL, email, and username. Secrets are never returned.",
  z.object({}),
  (ctx) => runTool(ctx, async () => ctx.client.whoami())
);
