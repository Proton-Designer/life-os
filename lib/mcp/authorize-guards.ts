/**
 * P4-13: pure checks for the OAuth authorize endpoint
 * (app/api/mcp/oauth/authorize/route.ts). No I/O, so each is unit-testable.
 */

/** The MCP protected resource this server advertises (app/.well-known/oauth-protected-resource: `${origin}/api/mcp`). */
export const MCP_RESOURCE_PATH = "/api/mcp";

/**
 * RFC 8707 `resource`: absent is fine (not every client sends it). If present
 * it must be THIS server's MCP endpoint -- same origin as the public origin
 * the discovery metadata advertises, path `/api/mcp` (a trailing slash is
 * tolerated), no query or fragment. Anything else means the client is asking
 * for a token meant for some other resource, which this server must not mint.
 */
export function isAllowedResource(resource: string | null, publicOrigins: string[]): boolean {
  if (resource === null) return true;
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  if (url.search || url.hash || url.username || url.password) return false;
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== MCP_RESOURCE_PATH) return false;
  return publicOrigins.some((o) => sameOrigin(url.origin, o));
}

/**
 * The consent form POST must come from our own consent page. Browsers send
 * `Origin` on form POSTs; fall back to `Referer`'s origin when a privacy
 * setting strips Origin. Neither present, `Origin: null` (sandboxed/opaque
 * contexts), or a different origin -> refuse. SameSite=Lax cookies already
 * block most cross-site POSTs; this makes the guarantee explicit instead of
 * resting on a cookie attribute this route does not control.
 */
export function isSameOriginRequest(headers: Headers, allowedOrigins: string[]): boolean {
  const origin = headers.get("origin");
  if (origin !== null) {
    if (origin === "null") return false;
    return allowedOrigins.some((o) => sameOrigin(origin, o));
  }
  const referer = headers.get("referer");
  if (!referer) return false;
  try {
    const refOrigin = new URL(referer).origin;
    return allowedOrigins.some((o) => sameOrigin(refOrigin, o));
  } catch {
    return false;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The GET authorize URL (relative) for these params, minus the consent `decision` -- where sign-in should return to. */
export function authorizeReturnPath(params: URLSearchParams): string {
  const copy = new URLSearchParams(params);
  copy.delete("decision");
  return `/api/mcp/oauth/authorize?${copy.toString()}`;
}
