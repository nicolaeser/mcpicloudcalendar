import { randomUUID } from "node:crypto";
import {
  davRequest,
  deleteHref,
  mkcalendar,
  moveHref,
  propfind,
  proppatch,
  putCalendar,
  report,
  type DavResponse
} from "./http.js";
import { extractUid, parseEvent, parseReminder } from "./ics.js";
import { ICLOUD_CALDAV_WELL_KNOWN, isIcloudCalDavHost, normalizeCalDavHref } from "./icloud.js";
import {
  CalendarAccountError,
  type CalDavDriver,
  type CalDavVerifyResult,
  type CalendarCredentials,
  type CalendarInfo,
  type CalendarObject,
  type CreateCalendarInput,
  type ObjectFilter,
  type PrincipalInfo,
  type SyncResult,
  type UpdateCalendarInput
} from "./types.js";
import {
  calendarMultigetXml,
  calendarQueryXml,
  mkcalendarXml,
  parseCalendarList,
  parseCalendarObjects,
  parsePrincipal,
  parseSync,
  propfindCalendarHomeXml,
  propfindCalendarsXml,
  propfindPrincipalXml,
  proppatchCalendarXml,
  syncCollectionXml,
  type ParsedCalendarObject,
  type ParsedSyncHref
} from "./xml.js";

export class HttpCalDavDriver implements CalDavDriver {
  private readonly credentials: CalendarCredentials;
  private readonly fetchImpl: typeof fetch;
  private cachedPrincipal: PrincipalInfo | undefined;
  private principalInflight: Promise<PrincipalInfo> | undefined;

  public constructor(credentials: CalendarCredentials, fetchImpl?: typeof fetch) {
    this.credentials = credentials;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async verify(): Promise<CalDavVerifyResult> {
    const info = await this.principal();
    return {
      ok: true,
      url: info.calendarHomeHref,
      principalHref: info.principalHref
    };
  }

  public async principal(): Promise<PrincipalInfo> {
    if (this.cachedPrincipal !== undefined) return this.cachedPrincipal;
    if (this.principalInflight !== undefined) return this.principalInflight;
    this.principalInflight = this.discoverPrincipal()
      .then((info) => {
        this.cachedPrincipal = info;
        return info;
      })
      .finally(() => {
        this.principalInflight = undefined;
      });
    return this.principalInflight;
  }

  public async listCalendars(): Promise<readonly CalendarInfo[]> {
    const home = (await this.principal()).calendarHomeHref;
    const response = await this.propfind(home, propfindCalendarsXml(), "1");
    return parseCalendarList(response.text, response.url);
  }

  public async getCalendar(href: string): Promise<CalendarInfo> {
    try {
      const listed = await this.listCalendars();
      const match = listed.find((calendar) => hrefsEqual(calendar.href, href));
      if (match !== undefined) return match;
    } catch (error) {
      if (error instanceof CalendarAccountError && error.code === "auth") throw error;
    }
    const url = this.absolute(href);
    const response = await this.propfind(url, propfindCalendarsXml(), "0");
    const parsed = parseCalendarList(response.text, response.url);
    const match = parsed.find((calendar) => hrefsEqual(calendar.href, href)) ?? parsed[0];
    if (match === undefined) {
      throw new CalendarAccountError(`CalDAV resource not found (${href}).`, "not_found");
    }
    return match;
  }

  public async createCalendar(input: CreateCalendarInput): Promise<CalendarInfo> {
    const home = (await this.principal()).calendarHomeHref;
    const existing = await this.listCalendars();
    const href = uniqueCalendarHref(home, input.displayName, existing);
    const body = mkcalendarXml({
      ...input,
      components: input.components ?? ["VEVENT"]
    });
    try {
      await mkcalendar(href, this.credentials, body, this.fetchImpl);
    } catch (error) {
      if (!(error instanceof CalendarAccountError) || error.code !== "http") throw error;
      const retry = uniqueCalendarHref(home, `${slugify(input.displayName)}-${randomUUID().slice(0, 8)}`, existing);
      await mkcalendar(retry, this.credentials, body, this.fetchImpl);
      return this.getCalendar(retry);
    }
    return this.getCalendar(href);
  }

  public async updateCalendar(href: string, patch: UpdateCalendarInput): Promise<CalendarInfo> {
    const url = this.absolute(href);
    await proppatch(url, this.credentials, proppatchCalendarXml(patch), this.fetchImpl);
    return this.getCalendar(url);
  }

  public async deleteCalendar(href: string): Promise<{ readonly deleted: true; readonly href: string }> {
    const url = this.absolute(href);
    await this.remove(url);
    return { deleted: true, href: url };
  }

  public async queryObjects(calendarHref: string, filter: ObjectFilter): Promise<readonly CalendarObject[]> {
    const url = this.absolute(calendarHref);
    const response = await this.report(url, calendarQueryXml(filter));
    const parsed = parseCalendarObjects(response.text, response.url);
    let objects = await this.hydrateObjects(url, parsed);
    if (filter.component !== undefined) {
      const component = filter.component;
      objects = objects.filter((object) => object.component === component);
    }
    if (filter.uid !== undefined) {
      const uid = filter.uid;
      objects = objects.filter((object) => object.uid === uid);
    }
    if (filter.text !== undefined && filter.text.trim().length > 0) {
      const needle = filter.text.trim();
      objects = objects.filter((object) => objectMatchesText(object, needle));
    }
    const offset = Math.max(0, filter.offset ?? 0);
    const sliced = objects.slice(offset);
    if (filter.limit === undefined) return sliced;
    return sliced.slice(0, Math.max(0, filter.limit));
  }

  public async getObject(href: string): Promise<CalendarObject> {
    const url = this.absolute(href);
    try {
      const response = await davRequest(
        { url, method: "GET", credentials: this.credentials },
        this.fetchImpl
      );
      const object = toCalendarObject(url, response.text, headerEtag(response.headers));
      if (object !== undefined) return object;
    } catch (error) {
      if (error instanceof CalendarAccountError && (error.code === "auth" || error.code === "not_found")) {
        throw error;
      }
    }
    const fetched = await this.multiget(parentHref(url), [requestHref(url)]);
    const match = fetched.find((object) => hrefsEqual(object.href, url)) ?? fetched[0];
    if (match === undefined) {
      throw new CalendarAccountError(`CalDAV resource not found (${href}).`, "not_found");
    }
    return match;
  }

  public async putObject(href: string, ics: string, etag?: string): Promise<CalendarObject> {
    const url = this.absolute(href);
    const response =
      etag === undefined || etag.length === 0
        ? await putCalendar(url, this.credentials, ics, undefined as never, this.fetchImpl)
        : await putCalendar(url, this.credentials, ics, etag, this.fetchImpl);
    const fromHeader = toCalendarObject(url, ics, headerEtag(response.headers));
    if (fromHeader !== undefined && fromHeader.etag !== undefined) return fromHeader;
    try {
      return await this.getObject(url);
    } catch (error) {
      if (error instanceof CalendarAccountError && (error.code === "auth" || error.code === "precondition")) {
        throw error;
      }
      const fallback = toCalendarObject(url, ics, headerEtag(response.headers));
      if (fallback !== undefined) return fallback;
      throw new CalendarAccountError("Calendar object has no UID.", "http");
    }
  }

  public async moveObject(fromHref: string, toHref: string, etag?: string): Promise<CalendarObject> {
    const from = this.absolute(fromHref);
    const to = this.absolute(toHref);
    try {
      await moveHref(from, to, this.credentials, this.fetchImpl);
      return await this.getObject(to);
    } catch (error) {
      if (error instanceof CalendarAccountError && error.code === "auth") throw error;
      const source = await this.getObject(from);
      const stored = await this.putObject(to, source.ics);
      try {
        await this.remove(from);
      } catch (cleanup) {
        if (cleanup instanceof CalendarAccountError && cleanup.code === "auth") throw cleanup;
      }
      return stored;
    }
  }

  public async deleteObject(
    href: string,
    etag?: string
  ): Promise<{ readonly deleted: true; readonly href: string }> {
    const url = this.absolute(href);
    await this.remove(url, etag);
    return { deleted: true, href: url };
  }

  public async sync(calendarHref: string, syncToken?: string): Promise<SyncResult> {
    const url = this.absolute(calendarHref);
    const hadToken = syncToken !== undefined && syncToken.length > 0;
    try {
      const body = hadToken ? syncCollectionXml(syncToken) : syncCollectionXml();
      const response = await this.report(url, body);
      const parsed = parseSync(response.text, response.url);
      const deleted: string[] = [];
      const changed: ParsedSyncHref[] = [];
      for (const item of parsed.hrefs) {
        if (hrefsEqual(item.href, url)) continue;
        if (item.deleted === true) deleted.push(item.href);
        else changed.push(item);
      }
      const objects = await this.hydrateObjects(url, changed);
      const token = parsed.syncToken ?? (await this.getCalendar(url)).syncToken ?? "";
      if (!hadToken) {
        return { href: url, syncToken: token, created: objects, updated: [], deleted };
      }
      return { href: url, syncToken: token, created: [], updated: objects, deleted };
    } catch (error) {
      if (!isInvalidSyncTokenError(error)) throw error;
      const objects = await this.queryObjects(url, {});
      const calendar = await this.getCalendar(url);
      return {
        href: url,
        syncToken: calendar.syncToken ?? "",
        created: objects,
        updated: [],
        deleted: [],
        reset: true
      };
    }
  }

  public dispose(): void {
    this.cachedPrincipal = undefined;
    this.principalInflight = undefined;
  }

  private async discoverPrincipal(): Promise<PrincipalInfo> {
    const { wellKnown, root } = discoveryUrls(this.credentials.caldavUrl);
    const first = await this.propfindPrincipal(wellKnown, root);
    const parsed = parsePrincipal(first.text, first.url);
    const principalHref = parsed.principalHref;
    if (principalHref === undefined) {
      throw new CalendarAccountError("CalDAV current-user-principal was not returned.", "http");
    }
    const homeResponse = await this.propfind(principalHref, propfindCalendarHomeXml(), "0");
    const home = parsePrincipal(homeResponse.text, homeResponse.url);
    const calendarHomeHref = home.calendarHomeHref;
    if (calendarHomeHref === undefined) {
      throw new CalendarAccountError("CalDAV calendar-home-set was not returned.", "http");
    }
    const displayName = home.displayName ?? parsed.displayName;
    return {
      email: this.credentials.email,
      principalHref,
      calendarHomeHref,
      ...(displayName !== undefined && displayName.length > 0 ? { displayName } : {})
    };
  }

  private async propfindPrincipal(primary: string, fallback: string): Promise<DavResponse> {
    const tryUrl = async (url: string): Promise<DavResponse | undefined> => {
      try {
        return await this.propfind(url, propfindPrincipalXml(), "0");
      } catch (error) {
        if (error instanceof CalendarAccountError && error.code === "auth") throw error;
        return undefined;
      }
    };
    const first = await tryUrl(primary);
    if (first !== undefined) {
      const parsed = parsePrincipal(first.text, first.url);
      if (parsed.principalHref !== undefined) return first;
    }
    const second = await tryUrl(fallback);
    if (second !== undefined) return second;
    if (first !== undefined) return first;
    throw new CalendarAccountError("CalDAV current-user-principal was not returned.", "http");
  }

  private async hydrateObjects(
    collectionUrl: string,
    items: readonly (ParsedCalendarObject | ParsedSyncHref)[]
  ): Promise<CalendarObject[]> {
    const live: Array<ParsedCalendarObject | ParsedSyncHref> = [];
    for (const item of items) {
      if ("deleted" in item && item.deleted === true) continue;
      if ("status" in item && typeof item.status === "number" && item.status >= 400) continue;
      if (hrefsEqual(item.href, collectionUrl)) continue;
      live.push(item);
    }
    const objects: CalendarObject[] = [];
    const missing: string[] = [];
    for (const item of live) {
      if (item.ics !== undefined && item.ics.length > 0) {
        const object = toCalendarObject(item.href, item.ics, item.etag);
        if (object !== undefined) objects.push(object);
        continue;
      }
      missing.push(requestHref(item.href));
    }
    if (missing.length > 0) {
      const fetched = await this.multiget(collectionUrl, missing);
      objects.push(...fetched);
    }
    return objects;
  }

  private async multiget(collectionUrl: string, hrefs: string[]): Promise<CalendarObject[]> {
    const unique = [...new Set(hrefs.filter((href) => href.length > 0))];
    if (unique.length === 0) return [];
    const response = await this.report(collectionUrl, calendarMultigetXml(unique));
    const objects: CalendarObject[] = [];
    for (const item of parseCalendarObjects(response.text, response.url)) {
      if (item.ics === undefined || item.ics.length === 0) continue;
      if (typeof item.status === "number" && item.status >= 400) continue;
      const object = toCalendarObject(item.href, item.ics, item.etag);
      if (object !== undefined) objects.push(object);
    }
    return objects;
  }

  private propfind(url: string, body: string, depth: "0" | "1"): Promise<DavResponse> {
    return propfind(url, this.credentials, body, depth, this.fetchImpl);
  }

  private report(url: string, body: string): Promise<DavResponse> {
    return report(url, this.credentials, body, this.fetchImpl);
  }

  private remove(url: string, etag?: string): Promise<DavResponse> {
    if (etag === undefined || etag.length === 0) {
      return deleteHref(url, this.credentials, undefined as never, this.fetchImpl);
    }
    return deleteHref(url, this.credentials, etag, this.fetchImpl);
  }

  private absolute(href: string): string {
    const base = this.cachedPrincipal?.calendarHomeHref ?? this.credentials.caldavUrl;
    return normalizeCalDavHref(href, base);
  }
}

function discoveryUrls(caldavUrl: string): { wellKnown: string; root: string } {
  const origin = originOf(caldavUrl);
  // iCloud well-known stays on caldav.icloud.com; pXX hosts come from redirects.
  const wellKnown = isIcloudCalDavHost(caldavUrl)
    ? ICLOUD_CALDAV_WELL_KNOWN
    : new URL("/.well-known/caldav", origin).href;
  return { wellKnown, root: new URL("/", origin).href };
}

function originOf(url: string): string {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return url.endsWith("/") ? url : `${url}/`;
  }
}

function slugify(displayName: string): string {
  return (
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "calendar"
  );
}

function uniqueCalendarHref(
  home: string,
  displayName: string,
  existing: readonly CalendarInfo[]
): string {
  const slug = slugify(displayName);
  const taken = (href: string): boolean => existing.some((calendar) => hrefsEqual(calendar.href, href));
  let href = joinCollection(home, slug);
  let n = 2;
  while (taken(href)) {
    href = joinCollection(home, `${slug}-${n}`);
    n += 1;
  }
  return href;
}

function joinCollection(home: string, slug: string): string {
  const base = home.endsWith("/") ? home : `${home}/`;
  return new URL(`${slug}/`, base).href;
}

function toCalendarObject(href: string, ics: string, etag?: string): CalendarObject | undefined {
  const uid = extractUid(ics) ?? uidFromHref(href);
  const component = componentOfIcs(ics);
  if (uid === undefined || uid.length === 0 || component === undefined) return undefined;
  return etag === undefined || etag.length === 0
    ? { href, ics, uid, component }
    : { href, ics, uid, component, etag };
}

function componentOfIcs(ics: string): CalendarObject["component"] | undefined {
  const upper = ics.toUpperCase();
  if (upper.includes("BEGIN:VEVENT")) return "VEVENT";
  if (upper.includes("BEGIN:VTODO")) return "VTODO";
  if (upper.includes("BEGIN:VJOURNAL")) return "VJOURNAL";
  return undefined;
}

function uidFromHref(href: string): string | undefined {
  let leaf: string | undefined;
  try {
    const path = new URL(href, "https://caldav.icloud.com").pathname;
    leaf = path.split("/").filter((part) => part.length > 0).at(-1);
  } catch {
    leaf = href.split("/").filter((part) => part.length > 0).at(-1);
  }
  if (leaf === undefined) return undefined;
  const uid = leaf.replace(/\.ics$/iu, "");
  return uid.length > 0 ? uid : undefined;
}

function objectMatchesText(object: CalendarObject, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  try {
    if (object.component === "VTODO") {
      const reminder = parseReminder(object.ics);
      return [reminder.summary, reminder.description ?? ""].join("\n").toLowerCase().includes(needle);
    }
    const event = parseEvent(object.ics);
    return [event.summary, event.description ?? "", event.location ?? ""].join("\n").toLowerCase().includes(needle);
  } catch {
    return object.ics.toLowerCase().includes(needle);
  }
}

function hrefsEqual(a: string, b: string): boolean {
  return normalizeHrefPath(a) === normalizeHrefPath(b);
}

function normalizeHrefPath(href: string): string {
  try {
    const url = href.includes("://") ? new URL(href) : new URL(href, "https://caldav.icloud.com");
    return url.pathname.replace(/\/+$/u, "") || "/";
  } catch {
    return href.replace(/\/+$/u, "") || "/";
  }
}

function requestHref(href: string): string {
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

function parentHref(href: string): string {
  const url = new URL(href);
  let path = url.pathname;
  if (path.endsWith("/")) path = path.slice(0, -1);
  const index = path.lastIndexOf("/");
  url.pathname = `${path.slice(0, Math.max(index, 0) + 1)}` || "/";
  url.search = "";
  url.hash = "";
  return url.href;
}

function headerEtag(headers: Headers): string | undefined {
  const value = headers.get("etag");
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isInvalidSyncTokenError(error: unknown): boolean {
  if (!(error instanceof CalendarAccountError)) return false;
  if (error.code === "precondition") return true;
  if (error.code !== "http") return false;
  return /HTTP (403|405|409|501)\b/u.test(error.message);
}
