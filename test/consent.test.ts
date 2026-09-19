import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { consentPage, escapeHtml, type ConsentPageInput } from "../src/auth/consent.js";
import { collectLoginBag, visibleLoginFields, type LoginField } from "../src/auth/fields.js";
import { loginFields } from "../src/auth/login-fields.js";
import { McpOAuthService } from "../src/auth/service.js";
import { PACKAGE_ACCENT, PACKAGE_PRODUCT } from "../src/version.js";

const fields: readonly LoginField[] = [
  { name: "password", label: "Account password", type: "password", secret: true, required: true, envFallback: "TEST_PASSWORD", requiredUnless: ["session"], autocomplete: "current-password", help: "Your account password." },
  { name: "session", label: "Session token", type: "password", secret: true, required: false, envFallback: "TEST_SESSION", section: "Session sign-in" },
  { name: "port", label: "Server port", type: "combobox", required: false, section: "Server settings", inputmode: "numeric", options: [{ value: "587", label: "STARTTLS" }, { value: "465", label: "TLS" }] }
];
const input: ConsentPageInput = {
  title: PACKAGE_PRODUCT,
  clientName: "Test application",
  csrf: "test-csrf",
  hidden: { client_id: "test-client", state: "test-state" },
  requirePassword: true,
  fields
};

describe("consent page design", () => {
  it("renders branded, self-contained consent with accessible optional sections", () => {
    const html = consentPage(input);
    expect(html).toContain(escapeHtml(PACKAGE_PRODUCT));
    expect(html).toContain(`--accent: ${PACKAGE_ACCENT}`);
    expect(html).toContain('<details class="options"><summary>Session sign-in</summary>');
    expect(html).not.toContain('<details class="options" open');
    expect(html).toContain('aria-describedby="login_password_help"');
    expect(html).toContain('id="login_password_help"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('name="website" tabindex="-1"');
    expect(html).toContain('name="consent" value="0" formnovalidate');
    expect(html).toContain('name="operator_password"');
    expect(html).toContain('name="csrf" value="test-csrf"');
    expect(html).toContain('name="state" value="test-state"');
    expect(html).toContain('>Authorize</button>');
    expect(html).toContain('Connecting…');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).not.toMatch(/<!--\/?slot:|@@[A-Z]+@@|<script[^>]+src=|<link[^>]+stylesheet/);
  });

  it("escapes client names, errors, labels, hints, sections and suggestions", () => {
    const hostile = '\"><img src=x onerror=alert(1)>';
    const html = consentPage({ ...input, clientName: hostile, error: hostile, fields: [{ name: "custom", type: "combobox", label: hostile, help: hostile, section: hostile, placeholder: hostile, options: [{ value: hostile, label: hostile }] }] });
    expect(html).toContain(escapeHtml(hostile));
    expect(html).not.toContain('<img');
    expect(html).toContain('role="alert"');
  });

  it("renders preset suggestions and custom entry in the same field", () => {
    const html = consentPage(input);
    expect(html).toMatch(/<input[^>]+name="login_port"[^>]+list="login_port_options"/);
    expect(html).toContain('<datalist id="login_port_options"><option value="587">STARTTLS</option>');
    expect(html).not.toContain('name="login_portCustom"');
  });

  it("skips empty account forms without prefilling configured credentials", () => {
    const html = consentPage({ ...input, fields: [] });
    expect(html).toContain('Account details are configured on this server.');
    expect(html).not.toContain('name="login_');
    expect(html).not.toMatch(/type="password"[^>]+value=/);
    expect(consentPage({ ...input, fields: [], requirePassword: false })).not.toContain('name="operator_password"');
  });

  it("keeps the inline interaction script syntactically valid", () => {
    const script = consentPage(input).match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Script(script ?? "")).not.toThrow();
  });
});

describe("progressive field requirements", () => {
  it("accepts a session in place of a password but rejects missing credentials", () => {
    expect(collectLoginBag(fields, { session: "test-session" }, {}).ok).toBe(true);
    expect(collectLoginBag(fields, { password: "test-password" }, {}).ok).toBe(true);
    expect(collectLoginBag(fields, {}, {}).ok).toBe(false);
    expect(collectLoginBag(fields, { session: "   " }, {}).ok).toBe(false);
  });

  it("hides a password when a configured alternative already satisfies it", () => {
    expect(visibleLoginFields(fields, { TEST_SESSION: "configured-session" }).map(field => field.name)).toEqual(["port"]);
    expect(collectLoginBag(fields, {}, { TEST_SESSION: "configured-session" }).ok).toBe(true);
  });

  it("never hides explicit public prompts or exposes environment credentials", () => {
    const prompted = fields.map(field => ({ ...field, prompt: "always" as const }));
    expect(visibleLoginFields(prompted, { TEST_SESSION: "configured-session" }).length).toBe(3);
    const html = consentPage({ ...input, fields: visibleLoginFields(prompted, { TEST_SESSION: "configured-session" }) });
    expect(html).not.toContain('configured-session');
  });

  it("keeps public sign-in fields visible and configuration-only fields hidden", () => {
    const definitions = loginFields();
    const env = Object.fromEntries(definitions.filter(field => field.envFallback).map(field => [field.envFallback!, "configured-value"]));
    const service = new McpOAuthService({ oauthSecret: "test-oauth-secret-value-32chars-min" }, env);
    expect(service.visibleLoginFields.map(field => field.name)).toEqual(definitions.filter(field => field.prompt !== "never").map(field => field.name));
  });
});
