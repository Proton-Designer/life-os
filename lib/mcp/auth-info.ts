import type { McpScope } from "./tokens";

/**
 * The shape this connector puts into `AuthInfo.extra` (the
 * `@modelcontextprotocol/server` type — see lib/mcp/tokens.ts and
 * app/api/mcp/route.ts) once `withMcpAuth`'s `verifyToken` callback has
 * resolved a bearer token. `AuthInfo.scopes: string[]` already carries our
 * scopes natively, so only the two fields the SDK's own shape has no slot
 * for live here.
 */
export interface McpAuthExtra {
  userId: string;
  tokenId: string;
}

/** The minimal slice of `@modelcontextprotocol/server`'s `AuthInfo` this module actually reads — avoids importing that package's type into every consumer just to read two fields off `.extra`. */
export interface AuthInfoLike {
  scopes: string[];
  extra?: Record<string, unknown>;
}

function isMcpAuthExtra(value: unknown): value is McpAuthExtra {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).userId === "string" &&
    typeof (value as Record<string, unknown>).tokenId === "string"
  );
}

/**
 * Pulls `{ userId, tokenId, scopes }` back out of an `AuthInfo`-shaped
 * object, or `null` if it isn't one this connector minted (defensive: a
 * `ctx.http.authInfo` of the wrong shape must read as "not authenticated",
 * never as a crash half-way through a tool handler).
 */
export function readMcpAuth(authInfo: AuthInfoLike | undefined): { userId: string; tokenId: string; scopes: McpScope[] } | null {
  if (!authInfo || !isMcpAuthExtra(authInfo.extra)) return null;
  const scopes = authInfo.scopes.filter((s): s is McpScope => s === "read" || s === "write" || s === "jobs");
  return { userId: authInfo.extra.userId, tokenId: authInfo.extra.tokenId, scopes };
}
