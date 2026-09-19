# Presentation and Interface Contract

## Scope

This repository ships one visual surface: the OAuth consent page for **iCloud Calendar** in
`src/auth/consent.html`, filled by `src/auth/consent.ts`. There is no component library, CSS
framework, or additional browser UI. This contract applies to that page and to public Markdown.

Fallback slot copy in `consent.html` must stay calendar-specific (product iCloud Calendar, eyebrow
Personal calendar, no From alias, package `mcpicloudcalendar`). Runtime branding still comes from
`src/version.ts`.

## Consent page

- The page must remain a single self-contained HTML document with inline CSS and a tiny inline
  script. UI dependencies must not be added.
- Brand values come from `src/version.ts`: `PACKAGE_PRODUCT`, `PACKAGE_TAGLINE`, `PACKAGE_ACCENT`.
  Accent colors must be hex `#RRGGBB` and must be validated before interpolation.
- Every label, value, client name, error, and field option must pass through `escapeHtml`.
- Secrets must not be prefilled. Password fields must use `autocomplete` values from
  `src/auth/login-fields.ts`. The operator password field is `operator_password`.
- The honeypot field `website` must remain present and visually hidden.
- CSRF, CSP (`CONSENT_CSP`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
  `Cache-Control: no-store` are owned by `src/auth/routes.ts` and must be preserved.
- The primary submit control text must remain `Authorize` and the busy label `Connecting…` so
  existing OAuth tests continue to pin the contract.
- Light and dark `prefers-color-scheme` must both be supported. `prefers-reduced-motion` must
  disable the busy spinner.
- Input font size must stay at least 16px to avoid iOS focus zoom.
- The page must reflow at a 320px-wide viewport without horizontal scrolling.

## Documentation presentation

- Markdown must use a coherent heading hierarchy, descriptive link text, fenced code blocks with an
  appropriate language, and tables only when they improve comparison or mapping.
- `README.md` must stay short. Agent operating rules belong in `.ai/`, not in the README.

## Verification

For consent changes, `npm test` must include `test/oauth.test.ts` and `test/consent.test.ts`.
Contrast, keyboard focus, and both color schemes must be inspected against the generated HTML.
Domain checks in the applicable Instructions remain mandatory.
