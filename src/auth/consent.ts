import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoginField } from "./fields.js";
import { PACKAGE_ACCENT, PACKAGE_NAME, PACKAGE_PRODUCT, PACKAGE_TAGLINE } from "../version.js";

function loadConsentHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "consent.html"), join(process.cwd(), "src/auth/consent.html")];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new Error("consent.html is missing");
}

const consentTemplate = loadConsentHtml();

export const CONSENT_ERROR_SESSION_EXPIRED =
  "This sign-in session expired. Start the connector again.";
export const CONSENT_ERROR_GENERIC = "Could not authorize this request.";
export const CONSENT_SESSION_EXPIRED = CONSENT_ERROR_SESSION_EXPIRED;
export const CONSENT_GENERIC = CONSENT_ERROR_GENERIC;
export const CONSENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' https: cursor: http://127.0.0.1:* http://localhost:* http://[::1]:*; base-uri 'self'; frame-ancestors 'none'";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export interface ConsentPageInput {
  readonly title: string;
  readonly clientName: string;
  readonly error?: string;
  readonly csrf: string;
  readonly hidden: Readonly<Record<string, string>>;
  readonly fields: readonly LoginField[];
  readonly requirePassword: boolean;
}

export function fillSlot(html: string, name: string, value: string): string {
  const open = `<!--slot:${name}-->`;
  const close = `<!--/slot:${name}-->`;
  for (;;) {
    const start = html.indexOf(open);
    if (start === -1) return html;
    const from = start + open.length;
    const end = html.indexOf(close, from);
    if (end === -1) return html;
    html = html.slice(0, start) + value + html.slice(end + close.length);
  }
}

export function consentPage(input: ConsentPageInput): string {
  const sections = new Map<string, LoginField[]>();
  const primaryFields = input.fields.filter((field) => {
    if (field.section === undefined) return true;
    const section = sections.get(field.section) ?? [];
    section.push(field);
    sections.set(field.section, section);
    return false;
  });
  const extras = primaryFields.map(fieldMarkup).join("") + [...sections].map(([label, fields]) =>
    `<details class="options"><summary>${escapeHtml(label)}</summary><div class="options-body">${fields.map(fieldMarkup).join("")}</div></details>`
  ).join("");
  const password = input.requirePassword ? operatorPasswordMarkup() : "";
  const hidden = Object.entries(input.hidden)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    )
    .join("");
  const error =
    input.error === undefined
      ? ""
      : `<div class="alert" role="alert">${escapeHtml(input.error)}</div>`;
  let html = consentTemplate;
  html = fillSlot(html, "accent", /^#[0-9a-f]{6}$/i.test(PACKAGE_ACCENT) ? PACKAGE_ACCENT : "#4C6FFF");
  html = fillSlot(html, "title", escapeHtml(input.title));
  html = fillSlot(html, "product", escapeHtml(PACKAGE_PRODUCT));
  html = fillSlot(html, "clientName", escapeHtml(input.clientName.trim() || "This application"));
  html = fillSlot(html, "packageName", escapeHtml(PACKAGE_NAME));
  html = fillSlot(html, "heading", "Connect your account");
  html = fillSlot(html, "primary", "Authorize");
  html = fillSlot(html, "tagline", escapeHtml(PACKAGE_TAGLINE));
  html = fillSlot(html, "error", error);
  html = fillSlot(html, "hidden", hidden);
  html = fillSlot(
    html,
    "csrf",
    `<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}" />`
  );
  html = fillSlot(html, "password", password);
  html = fillSlot(html, "fields", extras);
  html = fillSlot(html, "ready", input.fields.length === 0
    ? '<p class="ready">Account details are configured on this server. Review the connection, then authorize access.</p>'
    : "");
  html = html.replace(/<!--\/?slot:[^>]*-->/g, "");
  return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(input.title.trim() || PACKAGE_PRODUCT)}</title>`);
}

function operatorPasswordMarkup(): string {
  return `<section class="panel" aria-labelledby="operator-access-label"><p class="panel-label" id="operator-access-label">Server access</p><div class="field"><label for="operator_password">Server password</label>
      <input type="password" name="operator_password" id="operator_password" spellcheck="false" required autocomplete="current-password" aria-describedby="operator_password_help" />
      <p class="help" id="operator_password_help">Enter the password provided by the person hosting this connector, not your account password.</p></div></section>`;
}

function fieldMarkup(field: LoginField): string {
  const required = field.required === false || field.requiredUnless !== undefined ? "" : " required";
  const placeholder =
    field.placeholder === undefined ? "" : ` placeholder="${escapeHtml(field.placeholder)}"`;
  const name = field.name === "operator_password" ? "operator_password" : `login_${field.name}`;
  const autocomplete = ` autocomplete="${escapeHtml(field.autocomplete ?? "off")}"`;
  const describedBy = field.help === undefined ? "" : ` aria-describedby="${escapeHtml(name)}_help"`;
  const conditional = field.requiredUnless === undefined ? "" : ` data-required-unless="${escapeHtml(field.requiredUnless.map((alternative) => `login_${alternative}`).join(" "))}"`;
  const inputmode = field.inputmode === undefined ? "" : ` inputmode="${escapeHtml(field.inputmode)}"`;
  const pattern = field.pattern === undefined ? "" : ` pattern="${escapeHtml(field.pattern)}"`;
  let control: string;
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
      )
      .join("");
    control = `<select name="${escapeHtml(name)}" id="${escapeHtml(name)}"${required}${describedBy}${conditional}><option value="">${field.required === false ? "Use default" : "Select an option"}</option>${options}</select>`;
  } else if (field.type === "textarea") {
    control = `<textarea name="${escapeHtml(name)}" id="${escapeHtml(name)}"${required}${placeholder}${autocomplete}${describedBy}${conditional}></textarea>`;
  } else {
    const type = field.type === "url" ? "url" : field.type === "password" ? "password" : "text";
    const list = field.type === "combobox" ? ` list="${escapeHtml(name)}_options"` : "";
    control = `<input type="${type}" name="${escapeHtml(name)}" id="${escapeHtml(name)}" spellcheck="false" autocapitalize="none"${required}${placeholder}${autocomplete}${describedBy}${conditional}${inputmode}${pattern}${list} />`;
    if (field.type === "combobox") {
      control += `<datalist id="${escapeHtml(name)}_options">${(field.options ?? []).map((option) =>
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
      ).join("")}</datalist>`;
    }
  }
  const help =
    field.help === undefined ? "" : `<p class="help" id="${escapeHtml(name)}_help">${escapeHtml(field.help)}</p>`;
  const optional = field.required === false ? '<span class="optional">Optional</span>' : "";
  return `<div class="field"><label for="${escapeHtml(name)}">${escapeHtml(field.label)}${optional}</label>${control}${help}</div>`;
}

export function submittedLoginFields(body: Record<string, unknown>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith("login_")) continue;
    out[key.slice("login_".length)] = typeof value === "string" ? value : undefined;
  }
  return out;
}
