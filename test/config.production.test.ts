import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";

const SECRET = "test-oauth-secret-value-32chars-min";

describe("production HTTP fail-closed", () => {
  it("generates an ephemeral secret only on loopback outside production", () => {
    const config = readRuntimeConfig({ MCP_HOST: "127.0.0.1" });
    expect(config.auth.oauthSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects an exposed bind without a stable secret", () => {
    expect(() =>
      readRuntimeConfig({
        MCP_HOST: "0.0.0.0",
        MCP_PUBLIC_URL: "https://mcp.example",
        MCP_AUTH_PASSWORD: "operator-pass-12"
      })
    ).toThrow(/MCP_OAUTH_SECRET/);
  });

  it("rejects production without a stable secret even on loopback", () => {
    expect(() =>
      readRuntimeConfig({
        NODE_ENV: "production",
        MCP_HOST: "127.0.0.1"
      })
    ).toThrow(/MCP_OAUTH_SECRET/);
  });

  it("rejects an exposed bind without a public URL", () => {
    expect(() =>
      readRuntimeConfig({
        MCP_HOST: "0.0.0.0",
        MCP_OAUTH_SECRET: SECRET,
        MCP_AUTH_PASSWORD: "operator-pass-12"
      })
    ).toThrow(/MCP_PUBLIC_URL/);
  });

  it("rejects an exposed bind without an operator password", () => {
    expect(() =>
      readRuntimeConfig({
        MCP_HOST: "0.0.0.0",
        MCP_OAUTH_SECRET: SECRET,
        MCP_PUBLIC_URL: "https://mcp.example"
      })
    ).toThrow(/MCP_AUTH_PASSWORD/);
  });

  it("allows an isolated exposed bind with MCP_ALLOW_OPEN_CONSENT=1", () => {
    const config = readRuntimeConfig({
      MCP_HOST: "0.0.0.0",
      MCP_OAUTH_SECRET: SECRET,
      MCP_PUBLIC_URL: "https://mcp.example",
      MCP_ALLOW_OPEN_CONSENT: "1"
    });
    expect(config.auth.publicUrl).toBe("https://mcp.example");
    expect(config.auth.authPassword).toBeUndefined();
  });

  it("strips a path from MCP_PUBLIC_URL so metadata stays at the origin", () => {
    const config = readRuntimeConfig({
      MCP_HOST: "127.0.0.1",
      MCP_OAUTH_SECRET: SECRET,
      MCP_PUBLIC_URL: "https://mcp.example/mcp"
    });
    expect(config.auth.publicUrl).toBe("https://mcp.example");
  });

  it("honors MCP_SESSION_STORE from compose", () => {
    const config = readRuntimeConfig({
      NODE_ENV: "production",
      MCP_HOST: "0.0.0.0",
      MCP_OAUTH_SECRET: SECRET,
      MCP_PUBLIC_URL: "https://mcp.example",
      MCP_AUTH_PASSWORD: "operator-pass-12",
      MCP_SESSION_STORE: "/var/lib/mcp/sessions.sqlite"
    });
    expect(config.sessionStorePath).toBe("/var/lib/mcp/sessions.sqlite");
  });

  it("rejects a scheme-less public URL", () => {
    expect(() =>
      readRuntimeConfig({
        MCP_HOST: "127.0.0.1",
        MCP_OAUTH_SECRET: SECRET,
        MCP_PUBLIC_URL: "mcp.example"
      })
    ).toThrow(/MCP_PUBLIC_URL/);
  });
});
