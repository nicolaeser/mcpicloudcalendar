import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ResolvedAuth } from "../auth/resolve.js";
import { sweepExpired, type DurableKv } from "../lib/durable.js";
import { restoreStreamableSession } from "./restore-session.js";

export type OkAuth = Extract<ResolvedAuth, { ok: true }>;

const PREFIX = "mcp:session:";

export interface SessionSlot {
  readonly transport: StreamableHTTPServerTransport;
  readonly familyId: string;
}

export class McpSessionTable {
  private readonly live = new Map<string, SessionSlot>();
  private readonly restoring = new Map<string, Promise<"missing" | "mismatch" | SessionSlot>>();

  public constructor(
    private readonly store: DurableKv,
    private readonly connect: (
      transport: StreamableHTTPServerTransport,
      credentials: OkAuth
    ) => Promise<void>
  ) {}

  public get liveCount(): number {
    sweepExpired(this.store, PREFIX);
    const ids = new Set(this.live.keys());
    for (const row of this.store.list(PREFIX)) ids.add(row.key.slice(PREFIX.length));
    return ids.size;
  }

  public async take(sessionId: string, credentials: OkAuth): Promise<"missing" | "mismatch" | SessionSlot> {
    const hit = this.live.get(sessionId);
    if (hit !== undefined) return hit.familyId === credentials.familyId ? hit : "mismatch";
    const pending = this.restoring.get(sessionId);
    if (pending !== undefined) return pending;
    const work = this.restore(sessionId, credentials);
    this.restoring.set(sessionId, work);
    try {
      return await work;
    } finally {
      this.restoring.delete(sessionId);
    }
  }

  public async create(credentials: OkAuth): Promise<StreamableHTTPServerTransport> {
    const transport = this.bind(undefined, credentials);
    await this.connect(transport, credentials);
    return transport;
  }

  private async restore(
    sessionId: string,
    credentials: OkAuth
  ): Promise<"missing" | "mismatch" | SessionSlot> {
    const stored = this.read(sessionId);
    if (stored === undefined) return "missing";
    if (stored.familyId !== credentials.familyId) return "mismatch";
    const transport = this.bind(sessionId, credentials);
    restoreStreamableSession(transport, sessionId);
    await this.connect(transport, credentials);
    const slot = { transport, familyId: credentials.familyId };
    this.live.set(sessionId, slot);
    return slot;
  }

  private bind(sessionId: string | undefined, credentials: OkAuth): StreamableHTTPServerTransport {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId ?? randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        this.live.set(id, { transport, familyId: credentials.familyId });
        this.store.set(PREFIX + id, JSON.stringify({ familyId: credentials.familyId, exp: credentials.expiresAt * 1000 }));
      },
      onsessionclosed: (id) => {
        this.live.delete(id);
        this.store.delete(PREFIX + id);
      }
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) this.live.delete(id);
    };
    return transport;
  }

  private read(sessionId: string): { familyId: string; exp: number } | undefined {
    const raw = this.store.get(PREFIX + sessionId);
    if (raw === undefined) return undefined;
    try {
      const parsed = JSON.parse(raw) as { familyId?: unknown; exp?: unknown };
      if (typeof parsed.familyId !== "string" || typeof parsed.exp !== "number") return undefined;
      if (parsed.exp < Date.now()) {
        this.store.delete(PREFIX + sessionId);
        return undefined;
      }
      return { familyId: parsed.familyId, exp: parsed.exp };
    } catch {
      return undefined;
    }
  }
}
