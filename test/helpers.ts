import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CalendarAccountClient } from "../src/caldav/client.js";
import { MemoryCalDavStore } from "../src/caldav/memory.js";
import { ICLOUD_CALDAV_URL } from "../src/caldav/icloud.js";
import type { CalendarCredentials } from "../src/caldav/types.js";
import { createMcpServer } from "../src/mcp/server.js";

export const SECRET_USERNAME = "cal-user@icloud.com";
export const SECRET_PASSWORD = "abcd-efgh-ijkl-mnop";

export function testCredentials(overrides: Partial<CalendarCredentials> = {}): CalendarCredentials {
  const email = overrides.email ?? SECRET_USERNAME;
  return {
    email,
    password: overrides.password ?? SECRET_PASSWORD,
    caldavUrl: overrides.caldavUrl ?? ICLOUD_CALDAV_URL,
    username: overrides.username ?? email
  };
}

export function memoryPair(overrides: Partial<CalendarCredentials> = {}): {
  client: CalendarAccountClient;
  store: MemoryCalDavStore;
} {
  const credentials = testCredentials(overrides);
  const store = new MemoryCalDavStore(credentials);
  return {
    store,
    client: new CalendarAccountClient({ ...credentials, driver: store })
  };
}

export async function withMcpClient(options: {
  readonly email?: string;
  readonly password?: string | undefined;
}): Promise<{ client: Client; close: () => Promise<void>; store: MemoryCalDavStore }> {
  const email = options.email ?? SECRET_USERNAME;
  const password = options.password;
  const store = new MemoryCalDavStore(
    testCredentials({
      email,
      password: password ?? SECRET_PASSWORD,
      username: email
    })
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = createMcpServer({
    getToken: () => password,
    getBag: () => ({
      secrets: password !== undefined && password.length > 0 ? { appPassword: password } : {},
      claims: {
        ...(email.length > 0 ? { email } : {})
      }
    }),
    createClient: (factory) =>
      new CalendarAccountClient({
        ...factory,
        driver: store
      })
  });
  const client = new Client({ name: "mcpicloudcalendar-test", version: "0.0.0" });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    store,
    close: async () => {
      await client.close();
      await mcp.close();
    }
  };
}

export function toolText(result: unknown): string {
  if (typeof result !== "object" || result === null) return String(result);
  if (!("content" in result) || !Array.isArray(result.content)) {
    return JSON.stringify(result);
  }
  return result.content
    .map((part) => {
      if (typeof part === "object" && part !== null && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("\n");
}

export function parseToolJson(result: unknown): unknown {
  return JSON.parse(toolText(result));
}

export async function oauthAccessToken(
  origin: string,
  input: {
    readonly password: string;
    readonly email?: string;
    readonly loginPassword?: string;
  }
): Promise<string> {
  const redirect = "https://client.example/oauth/callback";
  const registered = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "test",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none"
    })
  });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${origin}/authorize`);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirect);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("scope", "mcp:tools");
  authorize.searchParams.set("resource", `${origin}/mcp`);
  const page = await fetch(authorize);
  const html = await page.text();
  const hidden: Record<string, string> = {};
  const re = /<input type="hidden" name="([^"]+)" value="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) hidden[match[1]] = match[2];
  }
  const body: Record<string, string> = {
    ...hidden,
    consent: "1",
    csrf: hidden.csrf ?? "",
    operator_password: input.password
  };
  if (input.email !== undefined) body.login_email = input.email;
  if (input.loginPassword !== undefined) body.login_appPassword = input.loginPassword;
  const consented = await fetch(`${origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const location = consented.headers.get("location") ?? "";
  const code = new URL(location).searchParams.get("code") ?? "";
  const tokens = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirect
    })
  });
  return ((await tokens.json()) as { access_token: string }).access_token;
}

export function spawnStdio(env: NodeJS.ProcessEnv = {}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

export function writeJsonRpc(child: ChildProcessWithoutNullStreams, message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

export async function readJsonRpc(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 8000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for stdio JSON-RPC.\nstdout=${stdout}\nstderr=${stderr}`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    const onOut = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.jsonrpc === "2.0") {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {

        }
      }
    };
    const onErr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`stdio process exited ${code}. stdout=${stdout} stderr=${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onOut);
      child.stderr.off("data", onErr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onOut);
    child.stderr.on("data", onErr);
    child.once("exit", onExit);
  });
}

export const INIT_PARAMS = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "mcpicloudcalendar-probe", version: "0.0.1" }
} as const;

export async function initializeStdio(
  child: ChildProcessWithoutNullStreams
): Promise<Record<string, unknown>> {
  writeJsonRpc(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: INIT_PARAMS
  });
  const init = await readJsonRpc(child);
  writeJsonRpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });
  return init;
}

export function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1000).unref();
  });
}
