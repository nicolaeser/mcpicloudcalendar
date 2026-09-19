import { z } from "zod";
import { defineTool, runTool } from "../../mcp/define-tool.js";

export const getPrincipal = defineTool(
  "icloud_get_principal",
  "Get principal",
  "Return the CalDAV principal href, calendar home, and display name.",
  z.object({}),
  (ctx) => runTool(ctx, async () => ctx.client.getPrincipal())
);
