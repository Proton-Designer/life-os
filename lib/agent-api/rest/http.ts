import "server-only";
import { GENERIC_TOOL_ERROR_MESSAGE, type OperationResult } from "@/lib/agent-api/execute";
import { RATE_LIMIT_WINDOW_SECONDS } from "@/lib/mcp/rate-limit";

/**
 * P4-17: HTTP mapping for the /api/v1 REST adapter. It turns
 * executeOperation's typed result into a Response. Success bodies are the
 * tool's structuredContent VERBATIM (the contract test holds REST ===
 * MCP), so request metadata travels in headers, never in the body. Errors
 * are RFC 9457 application/problem+json.
 *
 * CORS `*` is safe ONLY because auth is header-only. Nothing in the REST
 * adapter reads a cookie, and route.test.ts guards that structurally. If a
 * cookie fallback is ever added, this becomes a CSRF hole.
 */

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-LifeOS-Token",
  "Access-Control-Expose-Headers": "Link, Retry-After, X-Request-Id, X-LifeOS-Operation",
  "Access-Control-Max-Age": "600",
};

/** Every code a /api/v1 error can carry: executeOperation's plus the ones only HTTP can produce. */
export type RestErrorCode =
  | "unauthenticated"
  | "insufficient_scope"
  | "rate_limited"
  | "invalid_input"
  | "not_found"
  | "audit_failed"
  | "internal"
  | "token_in_query"
  | "invalid_json"
  | "route_not_found"
  | "method_not_allowed";

const TITLES: Record<RestErrorCode, string> = {
  unauthenticated: "Missing or invalid token",
  insufficient_scope: "Token lacks the required scope",
  rate_limited: "Rate limit exceeded",
  invalid_input: "Invalid input",
  not_found: "Not found",
  audit_failed: "Call could not be recorded",
  internal: "Internal error",
  token_in_query: "Token sent in the URL",
  invalid_json: "Malformed JSON body",
  route_not_found: "No such route",
  method_not_allowed: "Method not allowed",
};

export interface ResponseContext {
  requestId: string;
  /** The resolved audit operation (e.g. "deen.prayer.read"), or null before one exists. */
  operation: string | null;
  /** The request URL of a GET list read; when set and the page has more, a Link rel=next is emitted from it. */
  linkBase: URL | null;
}

function baseHeaders(ctx: Pick<ResponseContext, "requestId" | "operation">, contentType: string): Headers {
  const headers = new Headers(CORS_HEADERS);
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-Id", ctx.requestId);
  if (ctx.operation) headers.set("X-LifeOS-Operation", ctx.operation);
  return headers;
}

export function problemResponse(
  code: RestErrorCode,
  status: number,
  detail: string,
  ctx: Pick<ResponseContext, "requestId" | "operation">,
  extraHeaders: Record<string, string> = {},
  // P4-14: the ACTUAL seconds until the exhausted bucket's window resets
  // (from executeOperation's rate-limit result, or the auth-failure
  // limiter). Falls back to the fixed window length only when no real
  // value is available (a caller that hasn't been rate-limited itself).
  retryAfterSeconds?: number,
): Response {
  const headers = baseHeaders(ctx, "application/problem+json");
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  if (code === "rate_limited") {
    const seconds = retryAfterSeconds !== undefined && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : RATE_LIMIT_WINDOW_SECONDS;
    headers.set("Retry-After", String(seconds));
  }
  const body = { type: `urn:lifeos:problem:${code}`, title: TITLES[code], status, code, detail, operation: ctx.operation, request_id: ctx.requestId };
  return new Response(JSON.stringify(body), { status, headers });
}

export function jsonResponse(body: unknown, ctx: Pick<ResponseContext, "requestId" | "operation">, extraHeaders: Record<string, string> = {}): Response {
  const headers = baseHeaders(ctx, "application/json");
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: new Headers(CORS_HEADERS) });
}

function nextLink(data: unknown, linkBase: URL | null): string | null {
  if (!linkBase || typeof data !== "object" || data === null) return null;
  const page = data as { has_more?: unknown; cursor?: unknown };
  if (page.has_more !== true || typeof page.cursor !== "string" || !page.cursor) return null;
  const next = new URL(linkBase.toString());
  next.searchParams.set("cursor", page.cursor);
  return `<${next.toString()}>; rel="next"`;
}

export function operationToResponse(result: OperationResult, ctx: ResponseContext): Response {
  if (!result.ok) return problemResponse(result.code, result.status, result.message, ctx, {}, result.retryAfterSeconds);

  // A tool that REPORTS an error without throwing (isError:true) is still an
  // error: never a 200. Its text was written for the model, so it is shown
  // as-is. Empty or generic text reads as an internal failure (500).
  // Anything else is the caller's to fix (400).
  if (result.toolResult.isError === true) {
    const text = result.text.trim();
    if (!text || text === GENERIC_TOOL_ERROR_MESSAGE) return problemResponse("internal", 500, GENERIC_TOOL_ERROR_MESSAGE, ctx);
    return problemResponse("invalid_input", 400, text, ctx);
  }

  const body = result.data ?? { text: result.text };
  const link = nextLink(result.data, ctx.linkBase);
  return jsonResponse(body, ctx, link ? { Link: link } : {});
}

/**
 * `Authorization: Bearer <token>` (scheme case-insensitive), else
 * `X-LifeOS-Token`. Cookies and the query string are never consulted.
 */
export function extractToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const m = /^bearer\s+(\S+)\s*$/i.exec(authorization.trim());
    return m ? m[1] : null;
  }
  const alt = headers.get("x-lifeos-token")?.trim();
  return alt ? alt : null;
}
