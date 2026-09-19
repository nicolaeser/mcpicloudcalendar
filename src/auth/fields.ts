export type LoginFieldType = "password" | "text" | "url" | "select" | "textarea" | "combobox";
export type LoginFieldPrompt = "always" | "if-missing" | "never";

export interface LoginFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface LoginField {
  readonly name: string;
  readonly label: string;
  readonly type: LoginFieldType;
  readonly required?: boolean;
  readonly requiredUnless?: readonly string[];
  readonly section?: string;
  readonly inputmode?: "text" | "numeric" | "email" | "url";
  readonly pattern?: string;
  readonly secret?: boolean;
  readonly envFallback?: string;
  readonly prompt?: LoginFieldPrompt;
  readonly help?: string;
  readonly placeholder?: string;
  readonly autocomplete?: string;
  readonly options?: readonly LoginFieldOption[];
}

export interface LoginBag {
  readonly secrets: Readonly<Record<string, string>>;
  readonly claims: Readonly<Record<string, string>>;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_FIELD_CHARS = 512;

export function normalizeSecretToken(value: string): string {
  let token = value.trim().replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2) ||
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
  ) {
    token = token.slice(1, -1).trim();
  }
  token = token.replace(/^(bearer|token)\s+/i, "").trim();
  return token.replace(/\s+/g, "");
}

export function assertLoginFields(fields: readonly LoginField[]): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (!NAME_PATTERN.test(field.name)) {
      throw new Error(`Login field name is invalid: ${field.name}`);
    }
    if (seen.has(field.name)) {
      throw new Error(`Duplicate login field: ${field.name}`);
    }
    seen.add(field.name);
    if ((field.type === "select" || field.type === "combobox") && (field.options === undefined || field.options.length === 0)) {
      throw new Error(`Select field ${field.name} needs options.`);
    }
  }
}

export function envFallbackValue(field: LoginField, env: NodeJS.ProcessEnv): string {
  if (field.envFallback === undefined) return "";
  return env[field.envFallback]?.trim() ?? "";
}

export function visibleLoginFields(
  fields: readonly LoginField[],
  env: NodeJS.ProcessEnv
): readonly LoginField[] {
  return fields.filter((field) => {
    const mode = field.prompt ?? (field.envFallback === undefined ? "always" : "if-missing");
    if (mode === "never") return false;
    if (mode === "always") return true;
    return envFallbackValue(field, env).length === 0 && !hasAlternative(field, fields, {}, env);
  });
}

export function collectLoginBag(
  fields: readonly LoginField[],
  submitted: Readonly<Record<string, string | undefined>>,
  env: NodeJS.ProcessEnv
): { ok: true; bag: LoginBag } | { ok: false; error: string } {
  const secrets: Record<string, string> = {};
  const claims: Record<string, string> = {};
  for (const field of fields) {
    const raw = submitted[field.name]?.trim() ?? "";
    if (raw.length > MAX_FIELD_CHARS) {
      return { ok: false, error: "Could not authorize this request." };
    }
    const fallback = envFallbackValue(field, env);
    const picked = raw.length > 0 ? raw : fallback;
    const value = field.secret === true ? normalizeSecretToken(picked) : picked;
    const required = field.required !== false && !hasAlternative(field, fields, submitted, env);
    if (required && value.length === 0) {
      return { ok: false, error: `${field.label} is required.` };
    }
    if (value.length === 0) continue;
    if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
      return { ok: false, error: `${field.label} is invalid.` };
    }
    if (field.secret === true) secrets[field.name] = value;
    else claims[field.name] = value;
  }
  return { ok: true, bag: { secrets, claims } };
}

function hasAlternative(
  field: LoginField,
  fields: readonly LoginField[],
  submitted: Readonly<Record<string, string | undefined>>,
  env: NodeJS.ProcessEnv
): boolean {
  return field.requiredUnless?.some((name) => {
    const alternative = fields.find((candidate) => candidate.name === name);
    if (alternative === undefined) return false;
    const raw = submitted[name]?.trim() || envFallbackValue(alternative, env);
    const value = alternative.secret === true ? normalizeSecretToken(raw) : raw;
    return value.length > 0 && value.length <= MAX_FIELD_CHARS;
  }) ?? false;
}
