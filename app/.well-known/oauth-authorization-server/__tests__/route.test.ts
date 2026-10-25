import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("GET /.well-known/oauth-authorization-server", () => {
  it("advertises authorize/token/register at this origin, S256-only PKCE, and both scopes", async () => {
    const response = await GET(new Request("https://lifeos.example.com/.well-known/oauth-authorization-server"));
    const body = await response.json();

    expect(body.issuer).toBe("https://lifeos.example.com");
    expect(body.authorization_endpoint).toBe("https://lifeos.example.com/api/mcp/oauth/authorize");
    expect(body.token_endpoint).toBe("https://lifeos.example.com/api/mcp/oauth/token");
    expect(body.registration_endpoint).toBe("https://lifeos.example.com/api/mcp/oauth/register");
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.scopes_supported).toEqual(["read", "write", "jobs"]);
  });

  it("derives the origin from proxy-forwarding headers, not a hardcoded host", async () => {
    const response = await GET(
      new Request("http://localhost:3000/.well-known/oauth-authorization-server", {
        headers: { "x-forwarded-host": "tracking-app-sand.vercel.app", "x-forwarded-proto": "https" },
      })
    );
    const body = await response.json();
    expect(body.issuer).toBe("https://tracking-app-sand.vercel.app");
  });
});
