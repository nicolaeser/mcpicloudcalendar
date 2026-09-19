import { describe, expect, it } from "vitest";
import {
  basicAuthHeader,
  davRequest,
  deleteHref,
  mkcalendar,
  propfind,
  proppatch,
  putCalendar,
  report,
  type DavRequestInput
} from "../src/caldav/http.js";
import { CalendarAccountError, type CalendarCredentials } from "../src/caldav/types.js";

const PASSWORD = "abcd-efgh-ijkl-mnop";
const EMAIL = "cal-user@icloud.com";
const CREDENTIALS: CalendarCredentials = {
  email: EMAIL,
  password: PASSWORD,
  caldavUrl: "https://caldav.icloud.com",
  username: EMAIL
};

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

type FetchInput = Parameters<typeof fetch>[0];

function asFetch(impl: (input: FetchInput, init?: RequestInit) => Promise<Response>): typeof fetch {
  return impl as typeof fetch;
}

function requestUrlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String(input.url);
  }
  return String(input);
}

function recordFetch(queue: readonly Response[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = asFetch(async (input, init) => {
    const url = requestUrlOf(input);
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    const call: FetchCall =
      typeof rawBody === "string"
        ? { url, method: init?.method ?? "GET", headers, body: rawBody }
        : { url, method: init?.method ?? "GET", headers };
    calls.push(call);
    const next = queue[calls.length - 1];
    if (next === undefined) {
      return new Response("unexpected fetch", { status: 500 });
    }
    return next;
  });
  return { fetchImpl, calls };
}

function expectNoSecret(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  expect(message).not.toContain(PASSWORD);
  expect(message).not.toContain(basicAuthHeader(CREDENTIALS));
  expect(message).not.toContain(Buffer.from(`${EMAIL}:${PASSWORD}`, "utf8").toString("base64"));
}

async function expectDavError(
  run: () => Promise<unknown>,
  code: string
): Promise<CalendarAccountError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarAccountError);
    const thrown = error as CalendarAccountError;
    expect(thrown.code).toBe(code);
    expectNoSecret(thrown);
    return thrown;
  }
  throw new Error("expected CalendarAccountError");
}

function baseInput(overrides: Partial<DavRequestInput> = {}): DavRequestInput {
  return {
    url: "https://caldav.icloud.com/",
    method: "PROPFIND",
    credentials: CREDENTIALS,
    ...overrides
  };
}

describe("basicAuthHeader", () => {
  it("encodes email:password as Basic base64", () => {
    expect(basicAuthHeader(CREDENTIALS)).toBe(
      `Basic ${Buffer.from(`${EMAIL}:${PASSWORD}`, "utf8").toString("base64")}`
    );
  });
});

describe("davRequest", () => {
  it("sends Authorization, User-Agent, and Depth and returns 207", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("<multistatus/>", { status: 207 })]);
    const result = await davRequest(
      baseInput({
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: "<propfind/>",
        depth: "1"
      }),
      fetchImpl
    );
    expect(result.status).toBe(207);
    expect(result.text).toBe("<multistatus/>");
    expect(result.url).toBe("https://caldav.icloud.com/");
    expect(calls).toHaveLength(1);
    const headers = calls[0]?.headers;
    expect(headers?.get("Authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect(headers?.get("User-Agent")).toBe("mcpicloudcalendar/1.0");
    expect(headers?.get("Depth")).toBe("1");
    expect(headers?.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(calls[0]?.method).toBe("PROPFIND");
    expect(calls[0]?.body).toBe("<propfind/>");
  });

  it("throws auth on 401 without the password", async () => {
    const { fetchImpl } = recordFetch([new Response("nope", { status: 401 })]);
    const thrown = await expectDavError(() => davRequest(baseInput(), fetchImpl), "auth");
    expect(thrown.message).toContain("401");
  });

  it("throws precondition on 412 without the password", async () => {
    const { fetchImpl } = recordFetch([new Response("precondition", { status: 412 })]);
    const thrown = await expectDavError(
      () =>
        davRequest(
          baseInput({ method: "PUT", body: "BEGIN:VCALENDAR\nEND:VCALENDAR\n" }),
          fetchImpl
        ),
      "precondition"
    );
    expect(thrown.message).toContain("412");
  });

  it("throws not_found on 404 without the password", async () => {
    const { fetchImpl } = recordFetch([new Response("missing", { status: 404 })]);
    const thrown = await expectDavError(() => davRequest(baseInput(), fetchImpl), "not_found");
    expect(thrown.message).toContain("404");
  });

  it("throws http with status on other 4xx/5xx without the password", async () => {
    const { fetchImpl } = recordFetch([new Response("fail", { status: 500 })]);
    const thrown = await expectDavError(() => davRequest(baseInput(), fetchImpl), "http");
    expect(thrown.message).toContain("500");
  });

  it("follows redirects and keeps Authorization on the next host", async () => {
    const { fetchImpl, calls } = recordFetch([
      new Response(null, {
        status: 301,
        headers: { Location: "https://p12-caldav.icloud.com/principals/" }
      }),
      new Response("<multistatus/>", { status: 207 })
    ]);
    const result = await davRequest(baseInput({ depth: "0" }), fetchImpl);
    expect(result.status).toBe(207);
    expect(result.url).toBe("https://p12-caldav.icloud.com/principals/");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://caldav.icloud.com/");
    expect(calls[1]?.url).toBe("https://p12-caldav.icloud.com/principals/");
    expect(calls[0]?.headers.get("Authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect(calls[1]?.headers.get("Authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect(calls[1]?.method).toBe("PROPFIND");
  });

  it("resolves a relative Location against the request URL", async () => {
    const { fetchImpl, calls } = recordFetch([
      new Response(null, { status: 302, headers: { Location: "/principals/" } }),
      new Response("<ok/>", { status: 207 })
    ]);
    const result = await davRequest(
      baseInput({ url: "https://caldav.icloud.com/.well-known/caldav" }),
      fetchImpl
    );
    expect(result.url).toBe("https://caldav.icloud.com/principals/");
    expect(calls[1]?.url).toBe("https://caldav.icloud.com/principals/");
  });

  it("switches 303 redirects to GET without a body", async () => {
    const { fetchImpl, calls } = recordFetch([
      new Response(null, {
        status: 303,
        headers: { Location: "https://caldav.icloud.com/moved" }
      }),
      new Response("ok", { status: 200 })
    ]);
    await davRequest(baseInput({ method: "PROPFIND", body: "<propfind/>" }), fetchImpl);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
    expect(calls[1]?.headers.has("Content-Type")).toBe(false);
  });

  it("stops after 5 redirects without leaking the password", async () => {
    const { fetchImpl, calls } = recordFetch(
      Array.from({ length: 8 }, () => new Response(null, { status: 301, headers: { Location: "/next/" } }))
    );
    const thrown = await expectDavError(() => davRequest(baseInput(), fetchImpl), "http");
    expect(thrown.message).toMatch(/5 redirects/);
    expect(calls).toHaveLength(6);
  });

  it("strips URL userinfo before fetching and from the final URL", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("ok", { status: 200 })]);
    const result = await davRequest(
      baseInput({ url: `https://${EMAIL}:${PASSWORD}@caldav.icloud.com/calendars/` }),
      fetchImpl
    );
    expect(calls[0]?.url).toBe("https://caldav.icloud.com/calendars/");
    expect(result.url).toBe("https://caldav.icloud.com/calendars/");
    expect(result.url).not.toContain(PASSWORD);
  });

  it("redacts the password from wrapped fetch errors", async () => {
    const fetchImpl = asFetch(async () => {
      throw new Error(`upstream ${PASSWORD} rejected`);
    });
    const thrown = await expectDavError(() => davRequest(baseInput(), fetchImpl), "http");
    expect(thrown.message).toContain("[REDACTED]");
    expect(thrown.message).not.toContain(PASSWORD);
  });
});

describe("CalDAV helpers", () => {
  it("sends PROPFIND as XML with Depth", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("<multistatus/>", { status: 207 })]);
    await propfind("https://caldav.icloud.com/", CREDENTIALS, "<propfind/>", "0", fetchImpl);
    expect(calls[0]?.method).toBe("PROPFIND");
    expect(calls[0]?.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(calls[0]?.headers.get("Depth")).toBe("0");
    expect(calls[0]?.body).toBe("<propfind/>");
  });

  it("sends REPORT as XML with Depth 1", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("<multistatus/>", { status: 207 })]);
    await report("https://caldav.icloud.com/calendars/home/", CREDENTIALS, "<calendar-query/>", fetchImpl);
    expect(calls[0]?.method).toBe("REPORT");
    expect(calls[0]?.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(calls[0]?.headers.get("Depth")).toBe("1");
  });

  it("PUTs ICS with calendar content type and If-Match", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("", { status: 201 })]);
    const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    await putCalendar(
      "https://caldav.icloud.com/calendars/home/uid.ics",
      CREDENTIALS,
      ics,
      "\"etag-1\"",
      fetchImpl
    );
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(calls[0]?.headers.get("If-Match")).toBe("\"etag-1\"");
    expect(calls[0]?.body).toBe(ics);
  });

  it("omits If-Match on PUT when no etag is provided", async () => {
    const { fetchImpl, calls } = recordFetch([new Response("", { status: 201 })]);
    await putCalendar("https://caldav.icloud.com/calendars/home/uid.ics", CREDENTIALS, "ICS", undefined, fetchImpl);
    expect(calls[0]?.headers.has("If-Match")).toBe(false);
  });

  it("DELETEs with If-Match when an etag is provided", async () => {
    const { fetchImpl, calls } = recordFetch([new Response(null, { status: 204 })]);
    await deleteHref("https://caldav.icloud.com/calendars/home/uid.ics", CREDENTIALS, "\"etag-2\"", fetchImpl);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.headers.get("If-Match")).toBe("\"etag-2\"");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("sends MKCALENDAR and PROPPATCH as XML", async () => {
    const { fetchImpl, calls } = recordFetch([
      new Response("", { status: 201 }),
      new Response("<ok/>", { status: 207 })
    ]);
    await mkcalendar("https://caldav.icloud.com/calendars/new/", CREDENTIALS, "<mkcalendar/>", fetchImpl);
    await proppatch("https://caldav.icloud.com/calendars/new/", CREDENTIALS, "<propertyupdate/>", fetchImpl);
    expect(calls[0]?.method).toBe("MKCALENDAR");
    expect(calls[0]?.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(calls[1]?.method).toBe("PROPPATCH");
    expect(calls[1]?.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
  });

  it("maps helper 401/412 failures without the password", async () => {
    const unauthorized = recordFetch([new Response("no", { status: 401 })]);
    await expectDavError(
      () => propfind("https://caldav.icloud.com/", CREDENTIALS, "<propfind/>", "1", unauthorized.fetchImpl),
      "auth"
    );
    const precondition = recordFetch([new Response("no", { status: 412 })]);
    await expectDavError(
      () =>
        putCalendar(
          "https://caldav.icloud.com/calendars/home/uid.ics",
          CREDENTIALS,
          "ICS",
          "\"etag\"",
          precondition.fetchImpl
        ),
      "precondition"
    );
  });
});
