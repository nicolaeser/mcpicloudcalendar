import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import {
  calendarMultigetXml,
  calendarQueryXml,
  mkcalendarXml,
  parseCalendarList,
  parseCalendarObjects,
  parseMultistatus,
  parsePrincipal,
  parseSync,
  propfindCalendarHomeXml,
  propfindCalendarsXml,
  propfindPrincipalXml,
  proppatchCalendarXml,
  syncCollectionXml
} from "../src/caldav/xml.js";

const BASE_URL = "https://p03-caldav.icloud.com/";
const HOME_HREF = "https://p03-caldav.icloud.com/1234567890/calendars/home/";
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false
});

const PRINCIPAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/1234567890/principal/</d:href>
        </d:current-user-principal>
        <d:displayname>cal-user@icloud.com</d:displayname>
        <c:calendar-home-set>
          <d:href>/1234567890/calendars/</d:href>
        </c:calendar-home-set>
        <extra-unused>ignore me</extra-unused>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop>
        <d:principal-URL/>
      </d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const CALENDAR_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"
  xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/1234567890/calendars/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>calendars</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567890/calendars/home/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname xml:lang="en">Home</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <c:calendar/>
        </d:resourcetype>
        <cs:getctag>ctag-home</cs:getctag>
        <d:sync-token>https://caldav.icloud.com/sync/home-1</d:sync-token>
        <ic:calendar-color symbolic-color="red">#C9341CFF</ic:calendar-color>
        <c:calendar-description>Personal</c:calendar-description>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
        </c:supported-calendar-component-set>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
          <d:privilege><d:write/></d:privilege>
        </d:current-user-privilege-set>
        <cs:calendar-order>1</cs:calendar-order>
        <c:max-resource-size>1048576</c:max-resource-size>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567890/calendars/work/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Work &amp; Home &lt;1&gt;</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <c:calendar/>
        </d:resourcetype>
        <cs:getctag>ctag-work</cs:getctag>
        <ic:calendar-color>#2563EB</ic:calendar-color>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
          <c:comp name="VTODO"/>
        </c:supported-calendar-component-set>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
        </d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567890/calendars/inbox/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Inbox</d:displayname>
        <d:resourcetype>
          <d:collection/>
          <c:schedule-inbox/>
        </d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const OBJECTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567890/calendars/home/standup.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup
SUMMARY:Standup &amp; notes
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>birthday.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-2"</d:getetag>
        <c:calendar-data><![CDATA[BEGIN:VCALENDAR
BEGIN:VEVENT
UID:birthday
END:VEVENT
END:VCALENDAR]]></c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const SYNC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/1234567890/calendars/home/standup.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-9"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/1234567890/calendars/home/old.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>https://caldav.icloud.com/1234567890/sync/99</d:sync-token>
</d:multistatus>`;

describe("CalDAV XML builders", () => {
  it("propfindPrincipalXml asks for current-user-principal in DAV:", () => {
    const xml = propfindPrincipalXml();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:d="DAV:"');
    expect(xml).toContain("d:current-user-principal");
    expect(xml).toContain("d:displayname");
    expect(parser.parse(xml).propfind).toBeTruthy();
  });

  it("propfindCalendarHomeXml asks for caldav calendar-home-set", () => {
    const xml = propfindCalendarHomeXml();
    expect(xml).toContain('xmlns:c="urn:ietf:params:xml:ns:caldav"');
    expect(xml).toContain("c:calendar-home-set");
    expect(xml).toContain("d:displayname");
  });

  it("propfindCalendarsXml includes CS getctag and apple calendar-color", () => {
    const xml = propfindCalendarsXml();
    expect(xml).toContain('xmlns:d="DAV:"');
    expect(xml).toContain('xmlns:c="urn:ietf:params:xml:ns:caldav"');
    expect(xml).toContain('xmlns:cs="http://calendarserver.org/ns/"');
    expect(xml).toContain('xmlns:ic="http://apple.com/ns/ical/"');
    expect(xml).toContain("cs:getctag");
    expect(xml).toContain("ic:calendar-color");
    expect(xml).toContain("d:sync-token");
    expect(xml).toContain("c:supported-calendar-component-set");
    expect(xml).toContain("d:current-user-privilege-set");
    expect(xml).toContain("d:resourcetype");
    expect(xml).toContain("c:calendar-description");
    expect(xml).toContain("d:displayname");
  });

  it("calendarQueryXml emits component, UTC time-range, and UID filters", () => {
    const xml = calendarQueryXml({
      component: "VEVENT",
      start: "2026-03-15T00:00:00Z",
      end: "2026-03-16T00:00:00Z",
      uid: "standup",
      text: "client-side only",
      limit: 10
    });
    expect(xml).toContain("c:calendar-query");
    expect(xml).toContain('name="VCALENDAR"');
    expect(xml).toContain('name="VEVENT"');
    expect(xml).toContain('start="20260315T000000Z"');
    expect(xml).toContain('end="20260316T000000Z"');
    expect(xml).toContain('name="UID"');
    expect(xml).toContain("standup");
    expect(xml).toContain("c:calendar-data");
    expect(xml).not.toContain("client-side only");
  });

  it("calendarQueryXml converts a date-only window and omits text-match without uid", () => {
    const xml = calendarQueryXml({ start: "2026-01-04", end: "2026-01-05" });
    expect(xml).toContain('start="20260104T000000Z"');
    expect(xml).toContain('end="20260105T000000Z"');
    expect(xml).not.toContain("text-match");
    expect(xml).toContain('name="VCALENDAR"');
  });

  it("calendarMultigetXml lists each href", () => {
    const xml = calendarMultigetXml([
      "/1234567890/calendars/home/a.ics",
      "/1234567890/calendars/home/b.ics"
    ]);
    expect(xml).toContain("c:calendar-multiget");
    expect(xml).toContain("/1234567890/calendars/home/a.ics");
    expect(xml).toContain("/1234567890/calendars/home/b.ics");
    expect(xml).toContain("d:getetag");
    expect(xml).toContain("c:calendar-data");
  });

  it("syncCollectionXml uses an empty token for the initial sync", () => {
    const initial = syncCollectionXml();
    expect(initial).toContain("d:sync-collection");
    expect(initial).toContain("d:sync-token");
    expect(initial).toContain("d:sync-level");
    expect(initial).toContain("c:calendar-data");
    const withToken = syncCollectionXml("https://caldav.icloud.com/sync/1");
    expect(withToken).toContain("https://caldav.icloud.com/sync/1");
  });

  it("mkcalendarXml defaults the component set to VEVENT", () => {
    const xml = mkcalendarXml({ displayName: "Only name" });
    expect(xml).toContain('name="VEVENT"');
    expect(xml).not.toContain('name="VTODO"');
  });

  it("mkcalendarXml sets displayname, apple color, and component set", () => {
    const xml = mkcalendarXml({
      displayName: "Work & Personal",
      description: "Jobs",
      color: "#C9341C",
      components: ["VEVENT", "VTODO"]
    });
    expect(xml).toContain("c:mkcalendar");
    expect(xml).toContain('xmlns:ic="http://apple.com/ns/ical/"');
    expect(xml).toContain("Work &amp; Personal");
    expect(xml).toContain("c:calendar-description");
    expect(xml).toContain("Jobs");
    expect(xml).toContain("ic:calendar-color");
    expect(xml).toContain("#C9341C");
    expect(xml).toContain('name="VEVENT"');
    expect(xml).toContain('name="VTODO"');
  });

  it("proppatchCalendarXml includes only provided fields", () => {
    const xml = proppatchCalendarXml({ displayName: "Renamed", color: "#2563EB" });
    expect(xml).toContain("d:propertyupdate");
    expect(xml).toContain("Renamed");
    expect(xml).toContain("ic:calendar-color");
    expect(xml).toContain("#2563EB");
    expect(xml).not.toContain("calendar-description");
  });
});

describe("CalDAV XML parsers", () => {
  it("parseMultistatus resolves hrefs and keeps extra props without throwing", () => {
    const items = parseMultistatus(PRINCIPAL_XML, BASE_URL);
    expect(items).toHaveLength(1);
    expect(items[0]?.href).toBe("https://p03-caldav.icloud.com/");
    expect(items[0]?.status).toBe(200);
    expect(items[0]?.props["extra-unused"]).toBe("ignore me");
    expect(items[0]?.props["principal-URL"]).toBeUndefined();
  });

  it("parsePrincipal reads principal, calendar-home, and displayname", () => {
    const principal = parsePrincipal(PRINCIPAL_XML, BASE_URL);
    expect(principal).toEqual({
      principalHref: "https://p03-caldav.icloud.com/1234567890/principal/",
      calendarHomeHref: "https://p03-caldav.icloud.com/1234567890/calendars/",
      displayName: "cal-user@icloud.com"
    });
  });

  it("parseCalendarList keeps only calendar collections with apple color and CS getctag", () => {
    const calendars = parseCalendarList(CALENDAR_LIST_XML, BASE_URL);
    expect(calendars.map((cal) => cal.displayName)).toEqual(["Home", "Work & Home <1>"]);
    expect(calendars[0]).toEqual({
      href: HOME_HREF,
      displayName: "Home",
      description: "Personal",
      color: "#C9341C",
      ctag: "ctag-home",
      syncToken: "https://caldav.icloud.com/sync/home-1",
      components: ["VEVENT"],
      readOnly: false
    });
    expect(calendars[1]).toMatchObject({
      href: "https://p03-caldav.icloud.com/1234567890/calendars/work/",
      color: "#2563EB",
      ctag: "ctag-work",
      components: ["VEVENT", "VTODO"],
      readOnly: true
    });
    expect("description" in (calendars[1] ?? {})).toBe(false);
    expect("syncToken" in (calendars[1] ?? {})).toBe(false);
  });

  it("parseCalendarObjects returns etag, ics, and relative hrefs", () => {
    const objects = parseCalendarObjects(OBJECTS_XML, HOME_HREF);
    expect(objects).toHaveLength(2);
    expect(objects[0]?.href).toBe(
      "https://p03-caldav.icloud.com/1234567890/calendars/home/standup.ics"
    );
    expect(objects[0]?.etag).toBe('"etag-1"');
    expect(objects[0]?.status).toBe(200);
    expect(objects[0]?.ics).toContain("UID:standup");
    expect(objects[0]?.ics).toContain("SUMMARY:Standup & notes");
    expect(objects[1]?.href).toBe(
      "https://p03-caldav.icloud.com/1234567890/calendars/home/birthday.ics"
    );
    expect(objects[1]?.ics).toContain("UID:birthday");
  });

  it("parseSync returns the token, updates, and deleted hrefs", () => {
    const sync = parseSync(SYNC_XML, BASE_URL);
    expect(sync.syncToken).toBe("https://caldav.icloud.com/1234567890/sync/99");
    expect(sync.hrefs).toEqual([
      {
        href: "https://p03-caldav.icloud.com/1234567890/calendars/home/standup.ics",
        etag: '"etag-9"',
        ics: "BEGIN:VCALENDAR\nEND:VCALENDAR"
      },
      {
        href: "https://p03-caldav.icloud.com/1234567890/calendars/home/old.ics",
        deleted: true
      }
    ]);
    expect("deleted" in (sync.hrefs[0] ?? {})).toBe(false);
  });

  it("parses unprefixed DAV XML and omits missing principal fields", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
  <response>
    <href>/principals/me/</href>
    <propstat>
      <prop><displayname>Me</displayname></prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;
    const principal = parsePrincipal(xml, BASE_URL);
    expect(principal).toEqual({
      displayName: "Me"
    });
    expect("principalHref" in principal).toBe(false);
    expect("calendarHomeHref" in principal).toBe(false);
  });
});
