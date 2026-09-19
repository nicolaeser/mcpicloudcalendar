import { describe, expect, it } from "vitest";
import { collectLoginBag } from "../src/auth/fields.js";
import { credentialsFromBag, loginFields } from "../src/auth/login-fields.js";
import { isAllowedRedirect } from "../src/auth/redirects.js";
import { readRuntimeConfig } from "../src/config.js";
import { ICLOUD_CALDAV_URL } from "../src/caldav/icloud.js";

describe("iCloud login fields", () => {
  it("collects email and app-specific password and fills CalDAV settings", () => {
    const names = loginFields().map((field) => field.name);
    expect(names).toEqual(["email", "appPassword"]);
    expect(loginFields().find((field) => field.name === "email")?.secret).toBe(false);
    expect(loginFields().find((field) => field.name === "appPassword")?.secret).toBe(true);
    expect(loginFields().some((field) => field.name === "fromAddress")).toBe(false);
    const result = collectLoginBag(
      loginFields(),
      {
        email: " Cal-User@iCloud.com ",
        appPassword: " abcd-efgh-ijkl-mnop "
      },
      {}
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bag.secrets.appPassword).toBe("abcd-efgh-ijkl-mnop");
    expect(result.bag.claims.email).toBe("Cal-User@iCloud.com");
    expect(result.bag.claims.fromAddress).toBeUndefined();
    expect(credentialsFromBag(result.bag, {})).toEqual({
      email: "cal-user@icloud.com",
      password: "abcd-efgh-ijkl-mnop",
      caldavUrl: ICLOUD_CALDAV_URL,
      username: "cal-user@icloud.com"
    });
    expect(credentialsFromBag(result.bag, {})).toMatchObject({
      caldavUrl: "https://caldav.icloud.com"
    });
  });

  it("fills from ICLOUD_EMAIL and ICLOUD_APP_PASSWORD when the form is empty", () => {
    const result = collectLoginBag(
      loginFields(),
      {},
      {
        ICLOUD_EMAIL: "env-user@icloud.com",
        ICLOUD_APP_PASSWORD: "xxxx-yyyy-zzzz-wwww",
        ICLOUD_FROM: "alias@icloud.com"
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bag.claims.fromAddress).toBeUndefined();
    expect(credentialsFromBag(result.bag, {})).toEqual({
      email: "env-user@icloud.com",
      password: "xxxx-yyyy-zzzz-wwww",
      caldavUrl: "https://caldav.icloud.com",
      username: "env-user@icloud.com"
    });
  });

  it("reads ICLOUD_* in runtime config", () => {
    const config = readRuntimeConfig({
      ICLOUD_EMAIL: "alias-user@icloud.com",
      ICLOUD_APP_PASSWORD: "alias-pass",
      MCPICLOUDCALENDAR_PORT: "4000"
    });
    expect(config.email).toBe("alias-user@icloud.com");
    expect(config.password).toBe("alias-pass");
    expect(config.http.port).toBe(4000);
    expect(config).not.toHaveProperty("fromAddress");
  });
});

describe("redirect allowlist", () => {
  it("allows Grok, Cursor loopback, and the Cursor native callback", () => {
    expect(isAllowedRedirect("https://grok.com/connectors-oauth-exchange-code/")).toBe(true);
    expect(isAllowedRedirect("http://localhost:8787/callback")).toBe(true);
    expect(isAllowedRedirect("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(isAllowedRedirect("cursor://evil.example/oauth/callback")).toBe(false);
  });
});
