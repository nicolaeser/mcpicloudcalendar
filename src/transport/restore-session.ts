import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

interface InnerTransport {
  sessionId?: string;
  _initialized?: boolean;
}

function innerTransport(transport: StreamableHTTPServerTransport): InnerTransport | undefined {
  const inner = (transport as unknown as { _webStandardTransport?: InnerTransport })._webStandardTransport;
  return inner;
}

export function restoreStreamableSession(
  transport: StreamableHTTPServerTransport,
  sessionId: string
): void {
  const inner = innerTransport(transport);
  if (inner === undefined) {
    throw new Error("Streamable HTTP transport internals changed; cannot restore MCP session.");
  }
  inner.sessionId = sessionId;
  inner._initialized = true;
  if (transport.sessionId !== sessionId) {
    throw new Error("Failed to restore MCP session id.");
  }
}
