const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PATH_OK = /callback|oauth|auth|connector|mcp/i;
const CURSOR_CALLBACK = {
  protocol: "cursor:",
  hostname: "anysphere.cursor-mcp",
  pathname: "/oauth/callback"
} as const;

export function isAllowedRedirect(uri: string, extra: readonly string[] = []): boolean {
  if (extra.includes(uri)) return true;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    logRejectedRedirect(uri);
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    logRejectedRedirect(uri);
    return false;
  }
  if (
    url.protocol === CURSOR_CALLBACK.protocol &&
    url.hostname === CURSOR_CALLBACK.hostname &&
    url.pathname === CURSOR_CALLBACK.pathname
  ) {
    return true;
  }
  const allowed = LOOPBACK.has(url.hostname)
    ? url.protocol === "http:" && PATH_OK.test(url.pathname)
    : url.protocol === "https:" && PATH_OK.test(url.pathname);
  if (!allowed) logRejectedRedirect(uri);
  return allowed;
}

function logRejectedRedirect(uri: string): void {
  try {
    const url = new URL(uri);
    process.stderr.write(`auth.register reject_redirect host=${url.hostname} path=${url.pathname}\n`);
  } catch {
    process.stderr.write("auth.register reject_redirect host= path=\n");
  }
}

export function filterRedirectUris(uris: readonly string[], extra: readonly string[] = []): string[] {
  return [...new Set(uris.filter((uri) => isAllowedRedirect(uri, extra)))];
}

export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  for (const item of registered) {
    let reg: URL;
    try {
      reg = new URL(item);
    } catch {
      continue;
    }
    if (req.href === reg.href) return true;
    if (!LOOPBACK.has(req.hostname) || !LOOPBACK.has(reg.hostname)) continue;
    if (
      req.protocol === reg.protocol &&
      req.hostname === reg.hostname &&
      req.pathname === reg.pathname &&
      req.search === reg.search
    ) {
      return true;
    }
  }
  return false;
}
