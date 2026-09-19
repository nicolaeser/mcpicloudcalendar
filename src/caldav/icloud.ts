export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";
export const ICLOUD_CALDAV_WELL_KNOWN = "https://caldav.icloud.com/.well-known/caldav";

export const DAV_NS = "DAV:";
export const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
export const CS_NS = "http://calendarserver.org/ns/";
/** Apple `calendar-color` / `calendar-order`. */
export const APPLE_ICAL_NS = "http://apple.com/ns/ical/";

const ICLOUD_CALDAV_HOST = "caldav.icloud.com";
const ICLOUD_PARTITION_CALDAV_HOST = /^p\d+-caldav\.icloud\.com$/;

export function calendarObjectHref(calendarHref: string, uid: string): string {
  const base = calendarHref.endsWith("/") ? calendarHref : `${calendarHref}/`;
  return `${base}${uid}.ics`;
}

export function normalizeCalDavHref(href: string, baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(href, base).href;
}

export function isIcloudCalDavHost(url: string): boolean {
  const host = calDavHostname(url);
  return host === ICLOUD_CALDAV_HOST || ICLOUD_PARTITION_CALDAV_HOST.test(host);
}

function calDavHostname(url: string): string {
  try {
    return hostnameOf(new URL(url));
  } catch {
    try {
      return hostnameOf(new URL(`https://${url}`));
    } catch {
      return "";
    }
  }
}

function hostnameOf(parsed: URL): string {
  return parsed.hostname.replace(/\.$/, "").toLowerCase();
}
