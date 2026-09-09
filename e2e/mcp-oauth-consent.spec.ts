import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";
import { login } from "./helpers";

/**
 * The L4 OAuth consent screen (docs/ai-connector/PROGRAM-PLAN.md, R2's
 * red-team resolution) — asserts the things that make it a SECURITY CONTROL
 * rather than decoration, per the Lead's own framing: the client name and
 * the EXACT redirect host are displayed (so a mismatched/malicious client is
 * visible before clicking Allow, not after), Deny actually denies (no code
 * issued), and Allow issues a code that redirects ONLY to the registered
 * URI — never an unregistered one, even on the error path.
 *
 * Runs against a real, already-authenticated Life OS session (`login()`) —
 * this is exactly the flow a real browser click-through from claude.ai
 * exercises: Ayman is already logged in, sees the consent screen, decides.
 *
 * NOT covering: discovery (.well-known documents), token exchange, refresh
 * rotation, or the negative cases around code redemption (wrong verifier,
 * double-redeem, wrong client_id) — those don't need a browser and are
 * covered by `scripts/mcp-oauth-flow-check.ts`, run directly against
 * production rather than through this shared e2e environment.
 *
 * KNOWN, ALREADY-REPORTED FINDING AS OF THIS SPEC'S WRITING: the "Allow"
 * tests below expect a `code` param on the redirect. As of the flow-check
 * script's run against tracking-app-sand.vercel.app (2026-09-09), minting a
 * code fails in production with `error=server_error` even though the
 * identical operation succeeds when reproduced directly against the same
 * database outside of the deployed function — see the report to the Lead.
 * If these Allow-path assertions fail here too, that is expected until that
 * finding is resolved, not a new discovery from this spec.
 */

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function registerClient(request: APIRequestContext, redirectUri: string, clientName: string): Promise<string> {
  const res = await request.post("/api/mcp/oauth/register", {
    data: { redirect_uris: [redirectUri], client_name: clientName },
  });
  expect(res.status(), `register: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return body.client_id as string;
}

function authorizeUrl(params: { clientId: string; redirectUri: string; challenge: string; state: string; method?: string }): string {
  const qs = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    code_challenge: params.challenge,
    code_challenge_method: params.method ?? "S256",
    scope: "read write",
    state: params.state,
  });
  return `/api/mcp/oauth/authorize?${qs.toString()}`;
}

async function openAuthorize(page: Page, url: string) {
  await page.goto(url);
  // The consent screen is plain server-rendered HTML with no client JS —
  // no loading skeleton, no settle wait needed.
  await expect(page.getByRole("button", { name: "Allow" })).toBeVisible();
}

test.describe("MCP OAuth consent screen — the actual security control", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows the exact client name and redirect host — the mismatch a user is meant to notice", async ({ page, request }) => {
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const clientId = await registerClient(request, redirectUri, "Claude (spec)");
    const { challenge } = pkcePair();

    await openAuthorize(page, authorizeUrl({ clientId, redirectUri, challenge, state: "consent-name-test" }));

    await expect(page.getByText("Claude (spec)")).toBeVisible();
    await expect(page.getByText("claude.ai")).toBeVisible();
  });

  test("a DIFFERENT client's name/host are shown, not a cached/hardcoded value — proves the screen reads the real registration", async ({ page, request }) => {
    const distinctiveName = `Flow Check ${Date.now()}`;
    const redirectUri = "https://example.com/mcp-oauth-consent-spec-distinctive-callback";
    const clientId = await registerClient(request, redirectUri, distinctiveName);
    const { challenge } = pkcePair();

    await openAuthorize(page, authorizeUrl({ clientId, redirectUri, challenge, state: "consent-distinct-test" }));

    await expect(page.getByText(distinctiveName)).toBeVisible();
    await expect(page.getByText("example.com")).toBeVisible();
  });

  test("Deny actually denies — redirects with access_denied, no code, ever", async ({ page, request }) => {
    const redirectUri = "https://example.com/mcp-oauth-consent-spec-deny-callback";
    const clientId = await registerClient(request, redirectUri, "Deny Test Client");
    const { challenge } = pkcePair();

    await openAuthorize(page, authorizeUrl({ clientId, redirectUri, challenge, state: "consent-deny-test" }));
    await page.getByRole("button", { name: "Deny" }).click();

    await page.waitForURL((url) => url.hostname === "example.com", { timeout: 15_000 });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("error")).toBe("access_denied");
    expect(landed.searchParams.get("code")).toBeNull();
  });

  test("Allow issues a code that redirects ONLY to the registered URI, carrying the original state", async ({ page, request }) => {
    const redirectUri = "https://example.com/mcp-oauth-consent-spec-allow-callback";
    const clientId = await registerClient(request, redirectUri, "Allow Test Client");
    const { challenge } = pkcePair();

    await openAuthorize(page, authorizeUrl({ clientId, redirectUri, challenge, state: "consent-allow-test-xyz" }));
    await page.getByRole("button", { name: "Allow" }).click();

    await page.waitForURL((url) => url.hostname === "example.com", { timeout: 15_000 });
    const landed = new URL(page.url());
    expect(landed.origin + landed.pathname).toBe(redirectUri);
    expect(landed.searchParams.get("state")).toBe("consent-allow-test-xyz");
    // See this file's header re: this assertion's known-failing status as of
    // the 2026-09-09 flow-check finding — expected to fail until resolved.
    expect(landed.searchParams.get("code"), "code minting is the reported, unresolved finding — see the flow-check report").not.toBeNull();
  });

  test("an UNREGISTERED redirect_uri never redirects anywhere — the exact attack this screen exists to stop", async ({ page, request }) => {
    const registeredUri = "https://example.com/mcp-oauth-consent-spec-registered-callback";
    const clientId = await registerClient(request, registeredUri, "Redirect Mismatch Test");
    const { challenge } = pkcePair();

    const startUrl = authorizeUrl({ clientId, redirectUri: "https://evil.example.com/callback", challenge, state: "consent-mismatch-test" });
    const response = await page.goto(startUrl);

    // Must stay on OUR origin, rendering an error — never navigate to
    // evil.example.com, not even to show it an error via redirect.
    expect(new URL(page.url()).hostname).not.toBe("evil.example.com");
    expect(response?.status()).toBe(400);
    await expect(page.getByText(/redirect_uri/i)).toBeVisible();
    // The unregistered host must never even be echoed into the page.
    await expect(page.getByText("evil.example.com")).not.toBeVisible();
  });

  test("code_challenge_method=plain is rejected before Allow can issue anything", async ({ page, request }) => {
    const redirectUri = "https://example.com/mcp-oauth-consent-spec-plain-callback";
    const clientId = await registerClient(request, redirectUri, "Plain PKCE Test");

    // A raw string stands in for a "challenge" here — with method=plain
    // rejected up front, no code is ever minted from it either way.
    const startUrl = authorizeUrl({ clientId, redirectUri, challenge: "not-a-real-challenge", state: "consent-plain-test", method: "plain" });
    await page.goto(startUrl);

    // Rejected before the consent screen ever renders: a same-origin
    // redirect straight back to redirectUri with error=invalid_request,
    // not an Allow/Deny screen.
    await page.waitForURL((url) => url.hostname === "example.com", { timeout: 15_000 });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("error")).toBe("invalid_request");
    expect(landed.searchParams.get("code")).toBeNull();
  });
});
