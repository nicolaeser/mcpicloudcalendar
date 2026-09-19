const SENSITIVE_WORDS = new Set([
  "authorization",
  "password",
  "secret",
  "cookie",
  "session",
  "credential",
  "credentials",
  "token",
  "apikey"
]);

function isSensitiveKey(key: string): boolean {
  const dashed = key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  if (dashed.includes("api-key")) return true;
  return dashed.split("-").some((part) => SENSITIVE_WORDS.has(part));
}

export function redactValue(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 8) return "[Truncated]";
  if (typeof value === "string") return redactString(value, secrets, depth);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets, depth)
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? "[REDACTED]" : redactValue(item, secrets, depth + 1);
  }
  return result;
}

export function redactText(text: string, secrets: readonly string[] = []): string {
  let result = redactCredentialAssignments(text);
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

export function stringifyRedacted(value: unknown, secrets: readonly string[] = []): string {
  return redactText(JSON.stringify(redactValue(value, secrets), null, 2), secrets);
}

function redactString(value: string, secrets: readonly string[], depth: number): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return redactValue(JSON.parse(trimmed), secrets, depth + 1);
    } catch {
      return redactText(value, secrets);
    }
  }
  return redactText(value, secrets);
}

function redactCredentialAssignments(value: string): string {
  return value.replace(
    /((?:authorization|api[-_]?key|\btoken\b|password|secret|cookie|\bsession\b|credential)\s*[=:]\s*)([^&,\s]+)/gi,
    "$1[REDACTED]"
  );
}

