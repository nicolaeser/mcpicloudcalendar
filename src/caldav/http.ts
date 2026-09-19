import { CalendarAccountError, type CalendarCredentials } from "./types.js";

const USER_AGENT = "mcpicloudcalendar/1.0";
const XML_CONTENT_TYPE = "text/xml; charset=utf-8";
const CALENDAR_CONTENT_TYPE = "text/calendar; charset=utf-8";
const MAX_REDIRECTS = 5;

export interface DavRequestInput {
  readonly url: string;
  readonly method: string;
  readonly credentials: CalendarCredentials;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly depth?: "0" | "1" | "infinity";
}

export interface DavResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly url: string;
}

export function basicAuthHeader(credentials: CalendarCredentials): string {
  const token = Buffer.from(`${credentials.email}:${credentials.password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function davRequest(
  input: DavRequestInput,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  const doFetch = fetchImpl ?? fetch;
  let currentUrl = requestUrl(input.url);
  let method = input.method;
  let body = input.body;
  let redirects = 0;

  try {
    while (true) {
      const headers = buildHeaders(input.credentials, input.headers, input.depth, method);
      const init: RequestInit = {
        method,
        headers,
        // Manual hops keep Authorization across iCloud caldav → pXX-caldav hosts.
        redirect: "manual"
      };
      if (body !== undefined && method !== "GET" && method !== "HEAD") {
        init.body = body;
      }

      const response = await doFetch(currentUrl, init);
      if (isRedirectStatus(response.status)) {
        if (redirects >= MAX_REDIRECTS) {
          throw new CalendarAccountError(`CalDAV request exceeded ${MAX_REDIRECTS} redirects.`, "http");
        }
        const location = response.headers.get("location");
        if (location === null || location.length === 0) {
          throw statusError(response.status, await response.text());
        }
        await response.arrayBuffer();
        currentUrl = requestUrl(location, currentUrl);
        if (response.status === 303) {
          method = "GET";
          body = undefined;
        }
        redirects += 1;
        continue;
      }

      const text = await response.text();
      if (response.status >= 200 && response.status < 300) {
        return {
          status: response.status,
          headers: response.headers,
          text,
          url: currentUrl
        };
      }
      throw statusError(response.status, text);
    }
  } catch (error) {
    if (error instanceof CalendarAccountError) throw error;
    const detail = error instanceof Error ? error.message : "network error";
    throw new CalendarAccountError(
      `CalDAV request failed (${redactSecrets(detail, input.credentials)}).`,
      "http"
    );
  }
}

export function propfind(
  url: string,
  credentials: CalendarCredentials,
  body: string,
  depth: "0" | "1",
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "PROPFIND",
      credentials,
      headers: { "Content-Type": XML_CONTENT_TYPE },
      body,
      depth
    },
    fetchImpl
  );
}

export function report(
  url: string,
  credentials: CalendarCredentials,
  body: string,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "REPORT",
      credentials,
      headers: { "Content-Type": XML_CONTENT_TYPE },
      body,
      // RFC 4791 calendar-query REPORT is issued with Depth: 1.
      depth: "1"
    },
    fetchImpl
  );
}

export function putCalendar(
  url: string,
  credentials: CalendarCredentials,
  ics: string,
  etag?: string,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "PUT",
      credentials,
      headers: calendarWriteHeaders(etag),
      body: ics
    },
    fetchImpl
  );
}

export function deleteHref(
  url: string,
  credentials: CalendarCredentials,
  etag?: string,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  const headers = etagHeaders(etag);
  if (headers === undefined) {
    return davRequest({ url, method: "DELETE", credentials }, fetchImpl);
  }
  return davRequest({ url, method: "DELETE", credentials, headers }, fetchImpl);
}

export function mkcalendar(
  url: string,
  credentials: CalendarCredentials,
  body: string,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "MKCALENDAR",
      credentials,
      headers: { "Content-Type": XML_CONTENT_TYPE },
      body
    },
    fetchImpl
  );
}

export function moveHref(
  url: string,
  destination: string,
  credentials: CalendarCredentials,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "MOVE",
      credentials,
      headers: {
        Destination: destination,
        Overwrite: "T"
      }
    },
    fetchImpl
  );
}

export function proppatch(
  url: string,
  credentials: CalendarCredentials,
  body: string,
  fetchImpl?: typeof fetch
): Promise<DavResponse> {
  return davRequest(
    {
      url,
      method: "PROPPATCH",
      credentials,
      headers: { "Content-Type": XML_CONTENT_TYPE },
      body
    },
    fetchImpl
  );
}

function calendarWriteHeaders(etag?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": CALENDAR_CONTENT_TYPE };
  if (etag !== undefined) headers["If-Match"] = etag;
  return headers;
}

function etagHeaders(etag?: string): Record<string, string> | undefined {
  if (etag === undefined) return undefined;
  return { "If-Match": etag };
}

function buildHeaders(
  credentials: CalendarCredentials,
  extra: Readonly<Record<string, string>> | undefined,
  depth: "0" | "1" | "infinity" | undefined,
  method: string
): Headers {
  const headers = new Headers();
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      headers.set(key, value);
    }
  }
  headers.set("Authorization", basicAuthHeader(credentials));
  headers.set("User-Agent", USER_AGENT);
  if (depth !== undefined) headers.set("Depth", depth);
  if (method === "GET" || method === "HEAD") {
    headers.delete("Content-Type");
    headers.delete("Content-Length");
  }
  return headers;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function statusError(status: number, body = ""): CalendarAccountError {
  const snippet = davSnippet(body);
  const detail = snippet.length > 0 ? `: ${snippet}` : "";
  if (status === 401) {
    return new CalendarAccountError(`CalDAV authentication failed (HTTP 401)${detail}.`, "auth");
  }
  if (status === 403) {
    return new CalendarAccountError(
      `CalDAV forbidden (HTTP 403)${detail}. iCloud keeps VEVENT calendars and VTODO reminder lists separate.`,
      "forbidden"
    );
  }
  if (status === 412) {
    return new CalendarAccountError(`CalDAV precondition failed (HTTP 412)${detail}.`, "precondition");
  }
  if (status === 404) {
    return new CalendarAccountError(`CalDAV resource not found (HTTP 404)${detail}.`, "not_found");
  }
  return new CalendarAccountError(`CalDAV request failed (HTTP ${status})${detail}.`, "http");
}

function davSnippet(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "";
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}

function requestUrl(url: string, base?: string): string {
  try {
    const parsed = base === undefined ? new URL(url) : new URL(url, base);
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    throw new CalendarAccountError("CalDAV request failed (invalid URL).", "http");
  }
}

function redactSecrets(text: string, credentials: CalendarCredentials): string {
  const encoded = Buffer.from(`${credentials.email}:${credentials.password}`, "utf8").toString("base64");
  const secrets = [
    credentials.password,
    basicAuthHeader(credentials),
    encoded,
    `${credentials.email}:${credentials.password}`
  ];
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}
