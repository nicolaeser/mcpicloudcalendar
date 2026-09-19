import type { Express, Request, Response } from "express";
import {
  CONSENT_CSP,
  CONSENT_ERROR_GENERIC,
  CONSENT_ERROR_SESSION_EXPIRED,
  consentPage,
  submittedLoginFields
} from "./consent.js";
import { MCP_SCOPE, isS256Challenge, scopesFrom, type McpOAuthService } from "./service.js";
import { publicOrigin } from "./origin.js";
import { MCP_PATH, type RuntimeConfig } from "../config.js";
import { PACKAGE_PRODUCT } from "../version.js";

export function mountOAuth(app: Express, service: McpOAuthService, config: RuntimeConfig): void {
  const limited = createLimiter();
  const metadata = (req: Request, res: Response) => {
    cors(res);
    const origin = publicOrigin(req, config.auth.publicUrl);
    res.status(200).json(service.authorizationServerMetadata(origin));
  };
  const prm = (path: string) => (req: Request, res: Response) => {
    cors(res);
    const origin = publicOrigin(req, config.auth.publicUrl);
    res.status(200).json(service.resourceMetadata(origin, path));
  };

  const preflight = (_req: Request, res: Response) => {
    cors(res);
    res.status(204).end();
  };

  app.get("/.well-known/oauth-authorization-server", metadata);
  app.get("/.well-known/oauth-protected-resource", prm(MCP_PATH));
  app.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, prm(MCP_PATH));
  app.options("/.well-known/oauth-authorization-server", preflight);
  app.options("/.well-known/oauth-protected-resource", preflight);
  app.options(`/.well-known/oauth-protected-resource${MCP_PATH}`, preflight);

  app.options("/register", (_req, res) => {
    cors(res);
    res.status(204).end();
  });
  app.post("/register", (req, res) => {
    cors(res);
    if (limited(req, "register", 10, 60 * 60 * 1000)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    try {
      const client = service.registerClient(req.body as Record<string, unknown>);
      res.status(201).json(client);
    } catch (error) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const authorize = (req: Request, res: Response) => {
    handleAuthorize(req, res, service, config, req.method === "POST", limited);
  };
  app.get(["/authorize", "/authorize/"], authorize);
  app.post(["/authorize", "/authorize/"], authorize);

  app.options("/token", (_req, res) => {
    cors(res);
    res.status(204).end();
  });
  app.post("/token", (req, res) => {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    if (limited(req, "token", 60, 15 * 60 * 1000)) {
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    const body = formBody(req);
    const clientId = String(body.client_id ?? "");
    const client = service.getClient(clientId);
    if (client === undefined) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    try {
      if (body.grant_type === "authorization_code") {
        const tokens = service.exchangeCode({
          clientId,
          code: String(body.code ?? ""),
          codeVerifier: String(body.code_verifier ?? ""),
          ...(typeof body.redirect_uri === "string" ? { redirectUri: body.redirect_uri } : {}),
          ...(typeof body.resource === "string" ? { resource: body.resource } : {})
        });
        res.status(200).json(tokens);
        return;
      }
      if (body.grant_type === "refresh_token") {
        const tokens = service.exchangeRefresh({
          clientId,
          refreshToken: String(body.refresh_token ?? ""),
          ...(typeof body.resource === "string" ? { resource: body.resource } : {})
        });
        res.status(200).json(tokens);
        return;
      }
      res.status(400).json({ error: "unsupported_grant_type" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_grant";
      res.status(400).json({ error: code.startsWith("invalid_") ? code : "invalid_grant" });
    }
  });

  app.post("/revoke", (req, res) => {
    cors(res);
    const body = formBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    if (token.length > 0) service.revoke(token);
    res.status(200).json({ revoked: true });
  });
}

function handleAuthorize(
  req: Request,
  res: Response,
  service: McpOAuthService,
  config: RuntimeConfig,
  isPost: boolean,
  limited: RateLimitFn
): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    CONSENT_CSP
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  const params = isPost ? formBody(req) : queryMap(req);
  const clientId = String(params.client_id ?? "");
  const redirectUri = String(params.redirect_uri ?? "");
  const state = typeof params.state === "string" ? params.state : undefined;
  const client = service.getClient(clientId);

  if (client === undefined) {
    res.status(400).json({ error: "invalid_client", error_description: "Unknown client_id. Register first." });
    return;
  }
  if (!service.allowRedirect(redirectUri) || !service.clientRedirectOk(client, redirectUri)) {
    res.status(400).json({ error: "invalid_request", error_description: "Unregistered redirect_uri." });
    return;
  }

  const fail = (error: string, description: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    target.searchParams.set("error_description", description);
    if (state !== undefined) target.searchParams.set("state", state);
    res.redirect(302, target.toString());
  };
  const redirectWithCode = (code: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state !== undefined) target.searchParams.set("state", state);
    res.redirect(302, target.toString());
  };

  if (params.response_type !== "code") {
    fail("unsupported_response_type", "Only response_type=code is supported.");
    return;
  }
  if (
    params.code_challenge_method !== "S256" ||
    typeof params.code_challenge !== "string" ||
    !isS256Challenge(params.code_challenge)
  ) {
    fail("invalid_request", "S256 PKCE is required.");
    return;
  }
  const bind = { clientId, redirectUri, codeChallenge: params.code_challenge };

  let scopes: string[];
  try {
    scopes = scopesFrom(typeof params.scope === "string" ? params.scope : undefined);
  } catch {
    fail("invalid_scope", `Supported scope: ${MCP_SCOPE}`);
    return;
  }

  const origin = publicOrigin(req, config.auth.publicUrl);
  const resource = canonicalResource(origin, typeof params.resource === "string" ? params.resource : undefined);
  if (resource === undefined) {
    fail("invalid_target", "The resource does not match this server.");
    return;
  }
  const hidden = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: params.code_challenge,
    code_challenge_method: "S256",
    resource,
    scope: scopes.join(" "),
    ...(state === undefined ? {} : { state })
  };
  const showConsent = (status: number, error: string | undefined, csrf: string) => {
    res.status(status).type("html").send(
      consentPage({
        title: PACKAGE_PRODUCT,
        clientName: client.client_name?.trim() || client.client_id,
        csrf,
        fields: service.visibleLoginFields,
        requirePassword: service.requirePassword,
        hidden,
        ...(error === undefined ? {} : { error })
      })
    );
  };

  const isConsent = isPost && String(params.consent ?? "") === "1";
  const isDeny = isPost && String(params.consent ?? "") === "0";
  if (!isConsent && !isDeny) {
    if (limited(req, "authorize", 40, 15 * 60 * 1000)) {
      res.status(429).type("text").send("Too many authorization requests. Try again later.");
      return;
    }
    showConsent(200, undefined, service.issueCsrf(bind));
    return;
  }

  if (limited(req, "consent", 12, 15 * 60 * 1000)) {
    fail("temporarily_unavailable", "Too many sign-in attempts.");
    return;
  }
  const bodyToken = typeof params.csrf === "string" ? params.csrf : "";
  const verified = service.verifyCsrf(bodyToken, bind);
  if (!verified.ok) {
    if (verified.reason === "replay") {
      const existing = service.unusedCodeForCsrf(bodyToken);
      if (existing !== undefined) {
        process.stderr.write("auth.authorize replay_code\n");
        redirectWithCode(existing);
        return;
      }
    }
    process.stderr.write(`auth.authorize csrf_fail reason=${verified.reason}\n`);
    showConsent(401, CONSENT_ERROR_SESSION_EXPIRED, service.issueCsrf(bind));
    return;
  }
  if (isDeny) {
    fail("access_denied", "The user denied the request.");
    return;
  }
  if (typeof params.website === "string" && params.website.trim().length > 0) {
    showConsent(401, CONSENT_ERROR_GENERIC, bodyToken);
    return;
  }
  const password = typeof params.operator_password === "string" ? params.operator_password : undefined;
  if (!service.verifyOperatorPassword(password)) {
    process.stderr.write("auth.authorize password_fail\n");
    showConsent(401, CONSENT_ERROR_GENERIC, bodyToken);
    return;
  }
  const collected = service.collectBag(submittedLoginFields(params));
  if (!collected.ok) {
    showConsent(401, collected.error, bodyToken);
    return;
  }
  if (!service.consumeCsrf(bodyToken)) {
    showConsent(401, CONSENT_ERROR_SESSION_EXPIRED, service.issueCsrf(bind));
    return;
  }
  const code = service.completeAuthorization({
    clientId,
    redirectUri,
    codeChallenge: params.code_challenge,
    resource,
    scopes,
    bag: collected.bag,
    csrf: bodyToken
  });
  process.stderr.write(`auth.authorize ok client=${clientId}\n`);
  redirectWithCode(code);
}

function canonicalResource(origin: string, requested: string | undefined): string | undefined {
  const fallback = `${origin}${MCP_PATH}`;
  if (requested === undefined || requested.length === 0) return fallback;
  try {
    const url = new URL(requested);
    const base = new URL(origin);
    if (url.protocol !== base.protocol || url.hostname !== base.hostname) return undefined;
    const path = url.pathname.endsWith("/") && url.pathname.length > 1 ? url.pathname.slice(0, -1) : url.pathname;
    if (path === MCP_PATH) return `${origin}${path}`;
  } catch {
    return undefined;
  }
  return undefined;
}

function formBody(req: Request): Record<string, string> {
  const source = req.body as unknown;
  if (source === undefined || source === null || typeof source !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function queryMap(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function cors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, MCP-Protocol-Version, mcp-session-id"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, mcp-session-id");
  res.setHeader("Access-Control-Max-Age", "600");
}

type RateLimitFn = (req: Request, bucket: string, max: number, windowMs: number) => boolean;

function createLimiter(): RateLimitFn {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req, bucket, max, windowMs) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const slot = hits.get(key);
    if (slot === undefined || slot.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return false;
    }
    slot.count += 1;
    return slot.count > max;
  };
}

