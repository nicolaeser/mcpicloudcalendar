import { openSessionStore } from "./session-store.js";

export interface DurableKv {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  list(prefix: string): Array<{ key: string; value: string }>;
}

export class MemoryDurableKv implements DurableKv {
  private readonly rows = new Map<string, string>();

  public get(key: string): string | undefined {
    return this.rows.get(key);
  }

  public set(key: string, value: string): void {
    this.rows.set(key, value);
  }

  public delete(key: string): void {
    this.rows.delete(key);
  }

  public list(prefix: string): Array<{ key: string; value: string }> {
    return [...this.rows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value }));
  }
}

export function openDurableKv(path: string | undefined, secret: string): DurableKv {
  if (path === undefined || path.length === 0) return new MemoryDurableKv();
  const sqlite = openSessionStore(path, secret);
  return {
    get: (key) => sqlite.get(key),
    set: (key, value) => sqlite.set(key, value),
    delete: (key) => sqlite.delete(key),
    list: (prefix) => sqlite.list().filter((row) => row.key.startsWith(prefix))
  };
}

export function sweepExpired(store: DurableKv, prefix: string, now = Date.now()): void {
  for (const row of store.list(prefix)) {
    try {
      const exp = (JSON.parse(row.value) as { exp?: unknown }).exp;
      if (typeof exp === "number" && exp < now) store.delete(row.key);
    } catch {
      store.delete(row.key);
    }
  }
}
