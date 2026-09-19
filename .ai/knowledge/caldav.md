# iCloud CalDAV

Load this document when changing `src/caldav/`, ICS, discovery, or live vs memory drivers.

## Auth and discovery

- Credentials: full iCloud address + app-specific password. Regular Apple ID password fails.
- Basic auth on every DAV request. `User-Agent: mcpicloudcalendar/1.0`.
- Start at `https://caldav.icloud.com/.well-known/caldav`, then origin `/` on non-auth failure.
- PROPFIND `DAV:current-user-principal`, then `calendar-home-set`.
- The live host is often `https://pNN-caldav.icloud.com`. Follow redirects (max 5) and keep
  Authorization. `isIcloudCalDavHost` in `src/caldav/icloud.ts` matches both host forms.

## Collections and objects

- Calendar collections advertise `urn:ietf:params:xml:ns:caldav` `calendar` in resourcetype.
- Components: `VEVENT` (events), `VTODO` (reminders). Filter with `supported-calendar-component-set`.
- Object href: `{calendarHref}{uid}.ics` via `calendarObjectHref` (trailing slash required).
- Color is Apple `http://apple.com/ns/ical/` `calendar-color` (`#RRGGBB`, strip alpha if present).
- Display name is `DAV:displayname`. ctag is Calendar Server `getctag`.

## HTTP verbs

- PROPFIND / REPORT / MKCALENDAR / PROPPATCH: `text/xml; charset=utf-8`.
- PUT object: `text/calendar; charset=utf-8`. Send `If-Match` when an etag is known.
- 401 → `CalendarAccountError` code `auth`. 412 → `precondition`. 404 → `not_found`.
- Error messages must never include the app-specific password.

## ICS

Owned by `src/caldav/ics.ts`. RFC 5545: CRLF, 75-octet folding, escaped `\, \; \\` and `\n`.

- Timed events: UTC `Z` or `TZID=`. All-day: `DTSTART;VALUE=DATE` (no time).
- Always emit `UID`, `DTSTAMP`, `PRODID:-//mcpicloudcalendar//EN`.
- Skip `VTIMEZONE` when parsing so its `DTSTART` is not treated as an event.
- Round-trip must preserve uid, summary, start, allDay, rrule, attendees, alarms.

Do not add `ical.js` or `tsdav`.

## Recurrence

`src/caldav/rrule.ts` `expandRRule`: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL,
BYDAY, BYMONTHDAY. Cap 400. Honor EXDATE and RDATE. UNTIL may be DATE or UTC datetime.

## Tests

`MemoryCalDavStore` seeds Home (Standup + Birthday), Work (weekly RRULE), Reminders (Buy milk).
Default suite must not contact iCloud. Inject the memory store as `driver` on
`CalendarAccountClient`.
