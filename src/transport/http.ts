import { createServer, type Server } from "node:http";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loginFields } from "../auth/login-fields.js";
import { mountOAuth } from "../auth/routes.js";
import {
  authenticateHeader,
  authenticateInvalidHeader,
  envFromConfig,
  resolveHttpAuth
} from "../auth/resolve.js";
import { publicOrigin } from "../auth/origin.js";
import { McpOAuthService } from "../auth/service.js";
import type { LoginBag } from "../auth/fields.js";
import {
  HEALTH_PATH,
  MCP_PATH,
  type HttpBindConfig,
  type RuntimeConfig,
  readRuntimeConfig
} from "../config.js";
import { openDurableKv } from "../lib/durable.js";
import { createMcpServer } from "../mcp/server.js";
import { defaultClientFactory, type CalendarClientFactory } from "../caldav/client.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";
import { McpSessionTable } from "./mcp-sessions.js";

export interface HttpAppOptions {
  readonly config?: RuntimeConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionStorePath?: string;
  readonly createClient?: CalendarClientFactory;
}


export function createHttpApp(options: HttpAppOptions = {}): express.Express {
  const env = options.env ?? process.env;
  const config = options.config ?? readRuntimeConfig(env);
  const createClient = options.createClient ?? defaultClientFactory;
  const storePath =
    options.sessionStorePath === "" ? undefined : (options.sessionStorePath ?? config.sessionStorePath);
  const durable = openDurableKv(storePath, config.auth.oauthSecret);
  const oauth = new McpOAuthService(config.auth, env, loginFields(), durable);
  const sessions = new McpSessionTable(durable, async (transport, credentials) => {
    const server = createMcpServer(mcpOptions(createClient, credentials.apiToken, config, credentials.bag));
    await server.connect(transport as never);
  });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use((req, res, next) => {
    if (req.path === HEALTH_PATH) {
      next();
      return;
    }
    if (hostAllowed(req, config)) {
      next();
      return;
    }
    res.setHeader("WWW-Authenticate", authenticateHeader(config, config.auth.publicUrl));
    res.status(421).json({
      error: "misdirected_request",
      error_description: "Unexpected Host header."
    });
  });
  mountOAuth(app, oauth, config);

  app.get(HEALTH_PATH, (_req, res) => {
    res.status(200).json({
      status: "ok",
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      mcp: MCP_PATH,
      auth: "oauth"
    });
  });

  app.all(MCP_PATH, async (req: Request, res: Response) => {
    applyMcpCors(res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (!hostAllowed(req, config)) {
      res.setHeader("WWW-Authenticate", authenticateHeader(config, config.auth.publicUrl));
      res.status(421).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Misdirected request: unexpected Host header." },
        id: null
      });
      return;
    }
    const credentials = resolveHttpAuth(req, config, oauth);
    if (!credentials.ok) {
      res.setHeader("WWW-Authenticate", credentials.wwwAuthenticate);
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: credentials.code === "missing" ? "Authentication required." : "Invalid credentials."
        },
        id: null
      });
      return;
    }
    const sessionId = headerString(req.headers["mcp-session-id"]);
    try {
      if (sessionId !== undefined) {
        const session = await sessions.take(sessionId, credentials);
        if (session === "missing") {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unknown MCP session." },
            id: null
          });
          return;
        }
        if (session === "mismatch") {
          res.setHeader(
            "WWW-Authenticate",
            authenticateInvalidHeader(config, publicOrigin(req, config.auth.publicUrl))
          );
          res.status(401).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Session credential mismatch." },
            id: null
          });
          return;
        }
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === "POST" && isInitializeRequest(req.body)) {
        if (config.maxSessions !== undefined && sessions.liveCount >= config.maxSessions) {
          res.status(429).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session limit reached." },
            id: jsonRpcId(req.body)
          });
          return;
        }
        const transport = await sessions.create(credentials);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === "POST") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        } as never);
        const server = createMcpServer(
          mcpOptions(createClient, credentials.apiToken, config, credentials.bag)
        );
        await server.connect(transport as never);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: missing MCP session or initialize request." },
        id: null
      });
    } catch (error) {
      process.stderr.write(
        `${PACKAGE_NAME} HTTP handler failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });

  return app;
}

export async function listenHttp(app: express.Express, bind: HttpBindConfig): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bind.port, bind.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export async function runHttp(options: HttpAppOptions = {}): Promise<Server> {
  const env = options.env ?? process.env;
  const config = options.config ?? readRuntimeConfig(env);
  const app = createHttpApp({ ...options, config, env });
  const server = await listenHttp(app, config.http);
  const listened = server.address();
  const bound =
    typeof listened === "object" && listened !== null
      ? { host: config.http.host, port: listened.port }
      : config.http;
  const host = bound.host.includes(":") && !bound.host.startsWith("[") ? `[${bound.host}]` : bound.host;
  const base = `http://${host}:${bound.port}`;
  process.stderr.write(
    `${PACKAGE_NAME}/${PACKAGE_VERSION} oauth\n  MCP    ${base}${MCP_PATH}\n  Health ${base}${HEALTH_PATH}\n  Login  ${base}/authorize\n`
  );
  if (config.auth.publicUrl !== undefined) {
    process.stderr.write(`  Public ${config.auth.publicUrl}\n`);
  }

  return server;
}

function applyMcpCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, MCP-Protocol-Version, mcp-session-id"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, mcp-session-id");
  res.setHeader("Access-Control-Max-Age", "600");
}

function mcpOptions(
  createClient: CalendarClientFactory,
  token: string,
  config: RuntimeConfig,
  bag: LoginBag
) {
  return {
    createClient,
    getToken: () => token,
    getBag: () => bag,
    ...envFromConfig(config)
  };
}

function hostAllowed(req: Request, config: RuntimeConfig): boolean {
  const host = headerString(req.headers.host);
  if (host === undefined) return false;
  if (config.allowedHosts.includes(host)) return true;
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.includes(":")
      ? host.slice(0, host.lastIndexOf(":"))
      : host;
  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") return true;
  const publicHost = publicHostname(config.auth.publicUrl);
  return publicHost !== undefined && (hostname === publicHost || host === publicHost);
}

function publicHostname(publicUrl: string | undefined): string | undefined {
  if (publicUrl === undefined || publicUrl.length === 0) return undefined;
  try {
    return new URL(publicUrl).hostname;
  } catch {
    return undefined;
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcId(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "id" in body) {
    return (body as { id?: unknown }).id ?? null;
  }
  return null;
}
