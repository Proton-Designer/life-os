import { protectedResourceHandler, metadataCorsOptionsRequestHandler, getPublicOrigin } from "mcp-handler";

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata — MUST live on the MCP
 * server itself (L4, PROGRAM-PLAN.md), advertised via the `WWW-Authenticate:
 * Bearer resource_metadata="..."` header on an unauthenticated 401 from the
 * actual MCP endpoint.
 *
 * Uses `mcp-handler`'s own `protectedResourceHandler` rather than a
 * hand-written JSON responder — this package is already the chosen
 * dependency for L3's transport layer (R3, PROGRAM-PLAN.md), and this
 * helper exists specifically for this well-known path; hand-rolling it
 * would just be a worse reimplementation of proxy-header handling
 * (`getPublicOrigin`) this package already gets right.
 *
 * FORWARD REFERENCE, NOT YET LIVE: `resourceUrl` names `${origin}/api/mcp`
 * as the protected resource — that route is L3's, not yet built at the time
 * this file is written. This metadata is correct the moment L3 lands at
 * that path and inert (describes a 404) until then; nothing here needs to
 * change when L3 ships, since both derive the same origin the same way.
 */
export const GET = (request: Request) => {
  const origin = getPublicOrigin(request);
  return protectedResourceHandler({
    authServerUrls: [origin],
    // Explicit, not derived from this request's own URL: that would name
    // THIS metadata endpoint as the protected resource instead of the
    // actual MCP endpoint, since protectedResourceHandler's own fallback
    // (when resourceUrl is omitted) is "detect from proxy headers or fall
    // back to req.url" — correct for req.url pointing AT the resource,
    // wrong here, where req.url is this well-known document's own address.
    resourceUrl: `${origin}/api/mcp`,
  })(request);
};

export const OPTIONS = metadataCorsOptionsRequestHandler();
