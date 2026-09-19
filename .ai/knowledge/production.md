# Production

Load this document for Docker, compose, bind addresses, or production env.

`src/auth/production.ts` fail-closes HTTP when the process is exposed or `NODE_ENV=production`.

## Required on a non-loopback bind

- Stable `MCP_OAUTH_SECRET` of at least 32 characters. An ephemeral secret invalidates sessions
  across restarts and is refused in production.
- `MCP_PUBLIC_URL` (or `MCPICLOUDCALENDAR_PUBLIC_URL`) set to the public origin without `/mcp`.
  Host checks and token audience use it. `X-Forwarded-Host` is not trusted when this is unset.
- `MCP_AUTH_PASSWORD` unless `MCP_ALLOW_OPEN_CONSENT=1` on a trusted isolated network.

## Compose

`docker-compose.yml` pulls `ghcr.io/nicolaeser/mcpicloudcalendar:${IMAGE_TAG:-latest}`, sets
`container_name: mcpicloudcalendar`, persists sessions at
`MCP_SESSION_STORE=/var/lib/mcp/sessions.sqlite`, and reads `ICLOUD_EMAIL` /
`ICLOUD_APP_PASSWORD` from the host env. Override the tag with `IMAGE_TAG=dev`.
`docker-compose.dev.yml` builds from `context: .` with `MCP_ALLOW_OPEN_CONSENT=1`.

Local HTTP default is `127.0.0.1:3848`. The image binds `0.0.0.0:8080`.

`MCP_SESSION_STORE` is honored by `src/lib/session-path.ts`. Empty string disables sqlite.
Rows are AES-256-GCM sealed with `MCP_OAUTH_SECRET` via `node:sqlite`. Without that secret,
nothing is written.

The Dockerfile copies `src/` only. `test/` is listed in `.dockerignore` and must not ship in
the image. Runtime workdir is `/opt/app/mcpicloudcalendar`. Node `>=26`.

Do not pass secrets on argv. Do not commit `.env`, `tokens.json`, `sessions.sqlite`, or `data/`.

Pushes to `main` publish GHCR `:latest`. Pushes to `development` publish `:dev`.
