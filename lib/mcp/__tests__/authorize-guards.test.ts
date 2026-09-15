import { describe, expect, it } from "vitest";
import { authorizeReturnPath, isAllowedResource, isSameOriginRequest } from "../authorize-guards";

const ORIGINS = ["https://tracking-app-sand.vercel.app"];

describe("isAllowedResource (RFC 8707)", () => {
  it("absent resource is allowed", () => expect(isAllowedResource(null, ORIGINS)).toBe(true));
  it.each(["https://tracking-app-sand.vercel.app/api/mcp", "https://tracking-app-sand.vercel.app/api/mcp/", "https://TRACKING-APP-SAND.vercel.app/api/mcp"])(
    "accepts %s",
    (r) => expect(isAllowedResource(r, ORIGINS)).toBe(true),
  );
  it.each([
    "https://evil.example.com/api/mcp",
    "http://tracking-app-sand.vercel.app/api/mcp",
    "https://tracking-app-sand.vercel.app/api/mcp/extra",
    "https://tracking-app-sand.vercel.app/api/mcp?x=1",
    "https://tracking-app-sand.vercel.app/api/mcp#frag",
    "https://user:pw@tracking-app-sand.vercel.app/api/mcp",
    "/api/mcp",
    "",
  ])("rejects %s", (r) => expect(isAllowedResource(r, ORIGINS)).toBe(false));
});

describe("isSameOriginRequest (consent POST)", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("same Origin -> true", () => expect(isSameOriginRequest(h({ origin: ORIGINS[0] }), ORIGINS)).toBe(true));
  it("other Origin -> false even with a same-origin Referer", () =>
    expect(isSameOriginRequest(h({ origin: "https://evil.example.com", referer: `${ORIGINS[0]}/x` }), ORIGINS)).toBe(false));
  it("Origin: null -> false", () => expect(isSameOriginRequest(h({ origin: "null" }), ORIGINS)).toBe(false));
  it("no Origin, same-origin Referer -> true", () => expect(isSameOriginRequest(h({ referer: `${ORIGINS[0]}/api/mcp/oauth/authorize?a=b` }), ORIGINS)).toBe(true));
  it("no Origin, foreign or garbage Referer -> false", () => {
    expect(isSameOriginRequest(h({ referer: "https://evil.example.com/" }), ORIGINS)).toBe(false);
    expect(isSameOriginRequest(h({ referer: "not a url" }), ORIGINS)).toBe(false);
  });
  it("neither header -> false", () => expect(isSameOriginRequest(h({}), ORIGINS)).toBe(false));
});

describe("authorizeReturnPath", () => {
  it("rebuilds the GET authorize path without the consent decision", () => {
    const p = authorizeReturnPath(new URLSearchParams({ client_id: "c", state: "s", decision: "allow" }));
    expect(p).toBe("/api/mcp/oauth/authorize?client_id=c&state=s");
  });
});
