import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type {
  CalendarInfo,
  CreateCalendarInput,
  ObjectFilter,
  PrincipalInfo,
  UpdateCalendarInput
} from "./types.js";

const NS_DAV = "DAV:";
const NS_CALDAV = "urn:ietf:params:xml:ns:caldav";
const NS_CS = "http://calendarserver.org/ns/";
/** Apple `calendar-color` is in this xmlns, not CalDAV. */
const NS_ICAL = "http://apple.com/ns/ical/";

const WRITE_PRIVILEGES = new Set([
  "all",
  "write",
  "write-content",
  "write-properties",
  "bind",
  "unbind"
]);

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: false
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  textNodeName: "#text",
  processEntities: true
});

export interface ParsedMultistatus {
  readonly href: string;
  readonly status: number;
  readonly props: Record<string, unknown>;
}

export type ParsedPrincipal = Partial<
  Pick<PrincipalInfo, "principalHref" | "calendarHomeHref" | "displayName">
>;

export interface ParsedCalendarObject {
  readonly href: string;
  readonly etag?: string;
  readonly ics?: string;
  readonly status?: number;
}

export interface ParsedSyncHref {
  readonly href: string;
  readonly deleted?: boolean;
  readonly etag?: string;
  readonly ics?: string;
}

export interface ParsedSync {
  readonly syncToken?: string;
  readonly hrefs: ParsedSyncHref[];
}

export function propfindPrincipalXml(): string {
  return toXml({
    "d:propfind": {
      "@_xmlns:d": NS_DAV,
      "d:prop": {
        "d:current-user-principal": "",
        "d:displayname": ""
      }
    }
  });
}

export function propfindCalendarHomeXml(): string {
  return toXml({
    "d:propfind": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "d:prop": {
        "c:calendar-home-set": "",
        "d:displayname": ""
      }
    }
  });
}

export function propfindCalendarsXml(): string {
  return toXml({
    "d:propfind": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "@_xmlns:cs": NS_CS,
      "@_xmlns:ic": NS_ICAL,
      "d:prop": {
        "d:displayname": "",
        "d:resourcetype": "",
        "d:current-user-privilege-set": "",
        "d:sync-token": "",
        "cs:getctag": "",
        "ic:calendar-color": "",
        "c:supported-calendar-component-set": "",
        "c:calendar-description": ""
      }
    }
  });
}

export function calendarQueryXml(filter: ObjectFilter): string {
  return toXml({
    "c:calendar-query": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "d:prop": {
        "d:getetag": "",
        "c:calendar-data": ""
      },
      "c:filter": calendarFilter(filter)
    }
  });
}

export function calendarMultigetXml(hrefs: string[]): string {
  const body: Record<string, unknown> = {
    "@_xmlns:d": NS_DAV,
    "@_xmlns:c": NS_CALDAV,
    "d:prop": {
      "d:getetag": "",
      "c:calendar-data": ""
    }
  };
  if (hrefs.length === 1) {
    body["d:href"] = hrefs[0];
  } else if (hrefs.length > 1) {
    body["d:href"] = hrefs;
  }
  return toXml({ "c:calendar-multiget": body });
}

export function syncCollectionXml(syncToken?: string): string {
  return toXml({
    "d:sync-collection": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "d:sync-token": syncToken ?? "",
      "d:sync-level": "1",
      "d:prop": {
        "d:getetag": "",
        "c:calendar-data": ""
      }
    }
  });
}

export function mkcalendarXml(input: CreateCalendarInput): string {
  const prop: Record<string, unknown> = {
    "d:displayname": input.displayName
  };
  if (input.description !== undefined) {
    prop["c:calendar-description"] = input.description;
  }
  if (input.color !== undefined) {
    prop["ic:calendar-color"] = input.color;
  }
  const components = input.components ?? ["VEVENT"];
  prop["c:supported-calendar-component-set"] = {
    "c:comp": components.map((name) => ({ "@_name": name }))
  };
  return toXml({
    "c:mkcalendar": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "@_xmlns:ic": NS_ICAL,
      "d:set": { "d:prop": prop }
    }
  });
}

export function proppatchCalendarXml(patch: UpdateCalendarInput): string {
  const prop: Record<string, unknown> = {};
  if (patch.displayName !== undefined) prop["d:displayname"] = patch.displayName;
  if (patch.description !== undefined) prop["c:calendar-description"] = patch.description;
  if (patch.color !== undefined) prop["ic:calendar-color"] = patch.color;
  return toXml({
    "d:propertyupdate": {
      "@_xmlns:d": NS_DAV,
      "@_xmlns:c": NS_CALDAV,
      "@_xmlns:ic": NS_ICAL,
      "d:set": { "d:prop": prop }
    }
  });
}

export function parseMultistatus(xml: string, baseUrl: string): ParsedMultistatus[] {
  const items: ParsedMultistatus[] = [];
  for (const response of responsesOf(xml)) {
    const href = resolveHref(firstHref(getProp(response, "href")), baseUrl);
    if (href === undefined) continue;
    items.push({
      href,
      status: pickStatus(response),
      props: mergeOkProps(response)
    });
  }
  return items;
}

export function parsePrincipal(xml: string, baseUrl: string): ParsedPrincipal {
  let principalHref: string | undefined;
  let calendarHomeHref: string | undefined;
  let displayName: string | undefined;
  for (const item of parseMultistatus(xml, baseUrl)) {
    if (principalHref === undefined) {
      principalHref =
        nestedHref(item.props["current-user-principal"], baseUrl) ??
        nestedHref(item.props["principal-URL"], baseUrl);
    }
    if (calendarHomeHref === undefined) {
      calendarHomeHref = nestedHref(item.props["calendar-home-set"], baseUrl);
    }
    if (displayName === undefined) {
      displayName = textOf(item.props["displayname"]);
    }
  }
  return {
    ...(principalHref !== undefined ? { principalHref } : {}),
    ...(calendarHomeHref !== undefined ? { calendarHomeHref } : {}),
    ...(displayName !== undefined ? { displayName } : {})
  };
}

export function parseCalendarList(xml: string, baseUrl: string): CalendarInfo[] {
  const calendars: CalendarInfo[] = [];
  for (const item of parseMultistatus(xml, baseUrl)) {
    if (item.status >= 400) continue;
    if (!isCalendarCollection(item.props["resourcetype"])) continue;
    calendars.push(calendarInfoFromProps(item.href, item.props));
  }
  return calendars;
}

export function parseCalendarObjects(xml: string, baseUrl: string): ParsedCalendarObject[] {
  return parseMultistatus(xml, baseUrl).map((item) => {
    const etag = textOf(item.props["getetag"]);
    const ics = textOf(item.props["calendar-data"]);
    return {
      href: item.href,
      status: item.status,
      ...(etag !== undefined ? { etag } : {}),
      ...(ics !== undefined ? { ics } : {})
    };
  });
}

export function parseSync(xml: string, baseUrl: string): ParsedSync {
  const token = textOf(getProp(multistatusOf(xml), "sync-token"));
  const hrefs: ParsedSyncHref[] = parseMultistatus(xml, baseUrl).map((item) => {
    const deleted = item.status === 404 || item.status === 410;
    if (deleted) return { href: item.href, deleted: true };
    const etag = textOf(item.props["getetag"]);
    const ics = textOf(item.props["calendar-data"]);
    return {
      href: item.href,
      ...(etag !== undefined ? { etag } : {}),
      ...(ics !== undefined ? { ics } : {})
    };
  });
  return {
    ...(token !== undefined ? { syncToken: token } : {}),
    hrefs
  };
}

function toXml(root: Record<string, unknown>): string {
  return builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    ...root
  }) as string;
}

function calendarFilter(filter: ObjectFilter): Record<string, unknown> {
  const constraints: Record<string, unknown> = {};
  const start = filter.start !== undefined ? toCalDavDateTime(filter.start) : undefined;
  const end = filter.end !== undefined ? toCalDavDateTime(filter.end) : undefined;
  if (start !== undefined || end !== undefined) {
    const range: Record<string, string> = {};
    if (start !== undefined) range["@_start"] = start;
    if (end !== undefined) range["@_end"] = end;
    constraints["c:time-range"] = range;
  }
  if (filter.uid !== undefined) {
    constraints["c:prop-filter"] = {
      "@_name": "UID",
      "c:text-match": filter.uid
    };
  }
  if (filter.component !== undefined) {
    return {
      "c:comp-filter": {
        "@_name": "VCALENDAR",
        "c:comp-filter": {
          "@_name": filter.component,
          ...constraints
        }
      }
    };
  }
  return {
    "c:comp-filter": {
      "@_name": "VCALENDAR",
      ...constraints
    }
  };
}

/** CalDAV time-range attributes are UTC `YYYYMMDDTHHMMSSZ`. */
function toCalDavDateTime(iso: string): string {
  const trimmed = iso.trim();
  const compact = /^(\d{8})T(\d{6})Z?$/u.exec(trimmed);
  if (compact?.[1] !== undefined && compact[2] !== undefined) {
    return `${compact[1]}T${compact[2]}Z`;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  if (dateOnly?.[1] !== undefined && dateOnly[2] !== undefined && dateOnly[3] !== undefined) {
    return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}T000000Z`;
  }
  const naive = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/u.exec(trimmed);
  if (
    naive?.[1] !== undefined &&
    naive[2] !== undefined &&
    naive[3] !== undefined &&
    naive[4] !== undefined &&
    naive[5] !== undefined &&
    naive[6] !== undefined
  ) {
    return `${naive[1]}${naive[2]}${naive[3]}T${naive[4]}${naive[5]}${naive[6]}Z`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${String(parsed.getUTCFullYear()).padStart(4, "0")}${pad(parsed.getUTCMonth() + 1)}${pad(parsed.getUTCDate())}T${pad(parsed.getUTCHours())}${pad(parsed.getUTCMinutes())}${pad(parsed.getUTCSeconds())}Z`;
  }
  return `${trimmed.replaceAll(/[-:]/gu, "").replace(/\.\d+/u, "").replace(/Z$/iu, "")}Z`;
}

function parseXml(xml: string): Record<string, unknown> {
  const parsed: unknown = parser.parse(xml);
  return asRecord(parsed) ?? {};
}

function multistatusOf(xml: string): Record<string, unknown> {
  return asRecord(getProp(parseXml(xml), "multistatus")) ?? {};
}

function responsesOf(xml: string): Record<string, unknown>[] {
  const collected: Record<string, unknown>[] = [];
  for (const value of asArray(getProp(multistatusOf(xml), "response"))) {
    const rec = asRecord(value);
    if (rec !== undefined) collected.push(rec);
  }
  return collected;
}

function mergeOkProps(response: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const propstats = asArray(getProp(response, "propstat"));
  if (propstats.length === 0) {
    const direct = asRecord(getProp(response, "prop"));
    if (direct !== undefined) assignLocalProps(props, direct);
    return props;
  }
  for (const value of propstats) {
    const propstat = asRecord(value);
    if (propstat === undefined) continue;
    const code = statusCode(getProp(propstat, "status")) ?? 200;
    if (code < 200 || code >= 300) continue;
    const prop = asRecord(getProp(propstat, "prop"));
    if (prop !== undefined) assignLocalProps(props, prop);
  }
  return props;
}

function assignLocalProps(target: Record<string, unknown>, prop: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(prop)) {
    if (key.startsWith("@_") || key === "#text") continue;
    target[stripNs(key)] = value;
  }
}

function pickStatus(response: Record<string, unknown>): number {
  const direct = statusCode(getProp(response, "status"));
  if (direct !== undefined) return direct;
  const codes: number[] = [];
  for (const value of asArray(getProp(response, "propstat"))) {
    const propstat = asRecord(value);
    if (propstat === undefined) continue;
    const code = statusCode(getProp(propstat, "status"));
    if (code !== undefined) codes.push(code);
  }
  const ok = codes.find((code) => code >= 200 && code < 300);
  if (ok !== undefined) return ok;
  return codes[0] ?? 200;
}

function calendarInfoFromProps(href: string, props: Record<string, unknown>): CalendarInfo {
  const displayName = textOf(props["displayname"]) ?? "";
  const description = textOf(props["calendar-description"]);
  const colorRaw = textOf(props["calendar-color"]);
  const color = colorRaw !== undefined ? normalizeColor(colorRaw) : undefined;
  const ctag = textOf(props["getctag"]);
  const syncToken = textOf(props["sync-token"]);
  return {
    href,
    displayName,
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(ctag !== undefined ? { ctag } : {}),
    ...(syncToken !== undefined ? { syncToken } : {}),
    components: parseComponents(props["supported-calendar-component-set"]),
    readOnly: isReadOnly(props["current-user-privilege-set"])
  };
}

function parseComponents(value: unknown): CalendarInfo["components"] {
  const rec = asRecord(value);
  if (rec === undefined) return [];
  const names: Array<"VEVENT" | "VTODO" | "VJOURNAL"> = [];
  for (const item of asArray(getProp(rec, "comp"))) {
    const name = componentName(item);
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

function componentName(value: unknown): "VEVENT" | "VTODO" | "VJOURNAL" | undefined {
  const rec = asRecord(value);
  const raw =
    rec !== undefined
      ? textOf(rec["@_name"]) ?? textOf(getProp(rec, "name"))
      : textOf(value);
  if (raw === undefined) return undefined;
  const upper = raw.toUpperCase();
  if (upper === "VEVENT" || upper === "VTODO" || upper === "VJOURNAL") return upper;
  return undefined;
}

function isCalendarCollection(resourcetype: unknown): boolean {
  if (resourcetype == null || resourcetype === "") return false;
  if (typeof resourcetype === "string") return stripNs(resourcetype).toLowerCase() === "calendar";
  const rec = asRecord(resourcetype);
  if (rec === undefined) return false;
  return getProp(rec, "calendar") !== undefined;
}

function isReadOnly(cups: unknown): boolean {
  const names = privilegeNames(cups);
  if (names.size === 0) return false;
  for (const name of names) {
    if (WRITE_PRIVILEGES.has(name)) return false;
  }
  return true;
}

function privilegeNames(cups: unknown): Set<string> {
  const names = new Set<string>();
  const rec = asRecord(cups);
  if (rec === undefined) return names;
  for (const item of asArray(getProp(rec, "privilege"))) {
    if (typeof item === "string") {
      names.add(stripNs(item).toLowerCase());
      continue;
    }
    const privilege = asRecord(item);
    if (privilege === undefined) continue;
    for (const key of Object.keys(privilege)) {
      if (key.startsWith("@_") || key === "#text") continue;
      names.add(stripNs(key).toLowerCase());
    }
  }
  return names;
}

function nestedHref(value: unknown, baseUrl: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number") {
    return resolveHref(String(value), baseUrl);
  }
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  if (getProp(rec, "unauthenticated") !== undefined) return undefined;
  for (const item of asArray(getProp(rec, "href"))) {
    const href = resolveHref(textOf(item), baseUrl);
    if (href !== undefined) return href;
  }
  return resolveHref(textOf(value), baseUrl);
}

function firstHref(value: unknown): string | undefined {
  for (const item of asArray(value)) {
    const text = textOf(item);
    if (text !== undefined) return text;
  }
  return textOf(value);
}

function resolveHref(href: string | undefined, baseUrl: string): string | undefined {
  if (href === undefined) return undefined;
  const trimmed = href.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

function normalizeColor(raw: string): string {
  const match = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/u.exec(raw.trim());
  if (match?.[1] === undefined) return raw.trim();
  return `#${match[1]}`;
}

function statusCode(value: unknown): number | undefined {
  const text = textOf(value);
  if (text === undefined) return undefined;
  const http = /HTTP\/[\d.]+\s+(\d{3})/iu.exec(text);
  if (http?.[1] !== undefined) return Number(http[1]);
  const bare = /^(\d{3})$/u.exec(text);
  if (bare?.[1] !== undefined) return Number(bare[1]);
  return undefined;
}

function textOf(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  }
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  return textOf(rec["#text"]);
}

function getProp(obj: Record<string, unknown>, local: string): unknown {
  if (Object.hasOwn(obj, local)) return obj[local];
  for (const [key, value] of Object.entries(obj)) {
    if (stripNs(key) === local) return value;
  }
  return undefined;
}

function stripNs(name: string): string {
  if (name.startsWith("{")) {
    const close = name.indexOf("}");
    if (close >= 0) return name.slice(close + 1);
  }
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}
