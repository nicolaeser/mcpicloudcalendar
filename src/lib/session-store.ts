import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decryptString, encryptString } from "../auth/crypto.js";

const FILE_MODE = 0o600;
const open = new Map<string, EncryptedSessionStore>();

export function storeSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const secret = env.MCP_OAUTH_SECRET?.trim();
  return secret !== undefined && secret.length >= 32 ? secret : undefined;
}

export function sessionKey(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex");
}

export function sqlitePathFor(path: string): string {
  return path.endsWith(".json") ? join(dirname(path), "sessions.sqlite") : path;
}

export function legacyJsonPathFor(path: string): string {
  return path.endsWith(".json") ? path : join(dirname(path), "tokens.json");
}

export class EncryptedSessionStore {
  private readonly db: DatabaseSync;

  public constructor(
    private readonly path: string,
    private readonly secret: string
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    );
    protect(path);
  }

  public get(key: string): string | undefined {
    const row = this.db.prepare("SELECT v FROM sessions WHERE k = ?").get(key) as { v?: string } | undefined;
    if (row?.v === undefined) return undefined;
    try {
      return decryptString(this.secret, row.v);
    } catch {
      return undefined;
    }
  }

  public set(key: string, plaintext: string): void {
    this.db
      .prepare(
        "INSERT INTO sessions(k, v, updated_at) VALUES(?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at"
      )
      .run(key, encryptString(this.secret, plaintext), Date.now());
    protect(this.path);
  }

  public delete(key: string): void {
    this.db.prepare("DELETE FROM sessions WHERE k = ?").run(key);
  }

  public list(): Array<{ key: string; value: string }> {
    const rows = this.db.prepare("SELECT k, v FROM sessions").all() as Array<{ k: string; v: string }>;
    const out: Array<{ key: string; value: string }> = [];
    for (const row of rows) {
      try {
        out.push({ key: row.k, value: decryptString(this.secret, row.v) });
      } catch {
        continue;
      }
    }
    return out;
  }

  public close(): void {
    this.db.close();
  }
}

export function openSessionStore(path: string, secret: string): EncryptedSessionStore {
  const sqlitePath = ensureSqliteFile(sqlitePathFor(path));
  const cacheKey = `${sqlitePath}\0${secret}`;
  const existing = open.get(cacheKey);
  if (existing !== undefined) return existing;
  const store = new EncryptedSessionStore(sqlitePath, secret);
  open.set(cacheKey, store);
  return store;
}

export function closeSessionStore(path: string): void {
  const base = sqlitePathFor(path);
  const files = [base, join(base, "sessions.sqlite")];
  for (const [key, store] of open) {
    if (!files.some((file) => key.startsWith(`${file}\0`))) continue;
    store.close();
    open.delete(key);
  }
}

function ensureSqliteFile(path: string): string {
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "sessions.sqlite") : path;
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) closeSync(openSync(file, "a"));
  return file;
}

function protect(path: string): void {
  chmodIfPossible(path);
  for (const extra of [`${path}-wal`, `${path}-shm`]) {
    if (existsSync(extra)) chmodIfPossible(extra);
  }
}

function chmodIfPossible(path: string): void {
  try {
    chmodSync(path, FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
  }
}
