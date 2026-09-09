/**
 * Drives the REAL OAuth 2.1 flow (L4, docs/ai-connector/PROGRAM-PLAN.md) end
 * to end against a deployed Life OS, using ONLY the endpoints its own
 * discovery documents advertise — never a hardcoded path — because a script
 * that hardcodes `/api/mcp/oauth/authorize` would prove our server works
 * while proving nothing about discovery, which is the half a real client
 * (Claude/ChatGPT/Gemini) actually depends on.
 *
 * WHY THIS SCRIPT, NOT PLAYWRIGHT: only the Lead runs Playwright against the
 * shared e2e environment (AGENTS.md). This never touches that environment —
 * it's a standalone script hitting the deployed server directly, and the one
 * step that needs a real Life OS session (logging in) uses `@supabase/ssr`'s
 * own `createServerClient` locally to do a real sign-in and capture the
 * exact cookies it writes, rather than hand-encoding Supabase's chunked
 * cookie format (fragile, easy to get subtly wrong in a way that reads as
 * "not logged in" and has nothing to do with the OAuth flow being checked).
 * The consent SCREEN's own rendering (does it show the client name, does
 * Deny actually deny) is a separate Playwright spec, handed to the Lead.
 *
 * Usage: npx tsx scripts/mcp-oauth-flow-check.ts [baseUrl]
 *   baseUrl defaults to https://tracking-app-sand.vercel.app
 *
 * Exits 0 only if every check passed. Never piped through `tail` when run —
 * see AGENTS.md's own warning about `playwright test | tail` swallowing the
 * real exit code; the same trap applies to any script whose exit status is
 * the thing being trusted.
 */
import { config } from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
import { createServerClient } from "@supabase/ssr";

config({ path: path.resolve(__dirname, "../.env.local") });

const BASE_URL = process.argv[2] ?? "https://tracking-app-sand.vercel.app";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.SEED_USER_EMAIL;
const PASSWORD = process.env.SEED_USER_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EMAIL || !PASSWORD) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SEED_USER_EMAIL / SEED_USER_PASSWORD in .env.local");
  process.exit(2);
}

// ── reporting ──────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
function pass(label: string) {
  passCount++;
  console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
}
function fail(label: string, detail?: string) {
  failCount++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${label}${detail ? `\n        ${detail}` : ""}`);
}
function assert(condition: boolean, label: string, detail?: string) {
  if (condition) pass(label);
  else fail(label, detail);
}
function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ── a real Supabase session, via the real library, cookies captured rather than hand-encoded ──
class CookieJar {
  private cookies = new Map<string, string>();
  set(name: string, value: string) {
    if (value) this.cookies.set(name, value);
    else this.cookies.delete(name);
  }
  header(): string {
    return [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  }
}

async function signIn(): Promise<CookieJar> {
  const jar = new CookieJar();
  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: EMAIL!, password: PASSWORD! });
  if (error) throw new Error(`Supabase sign-in failed: ${error.message}`);
  return jar;
}

// ── PKCE ───────────────────────────────────────────────────────────────
function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ── typed helpers over fetch ───────────────────────────────────────────
async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

interface RegisteredClient {
  client_id: string;
}

async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<RegisteredClient> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "MCP Flow Check" }),
  });
  if (res.status !== 201) throw new Error(`register -> ${res.status}: ${await res.text()}`);
  return res.json();
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  method?: string;
  scope?: string;
  state?: string;
}

function buildAuthorizeForm(p: AuthorizeParams, decision: "allow" | "deny" | null): URLSearchParams {
  const form = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    code_challenge: p.challenge,
    code_challenge_method: p.method ?? "S256",
    scope: p.scope ?? "read write",
    state: p.state ?? "flow-check",
  });
  if (decision) form.set("decision", decision);
  return form;
}

/** POSTs the consent decision. `redirect: "manual"` so we read the Location header ourselves rather than following it into a redirect_uri that doesn't really exist. */
async function postAuthorize(authorizeEndpoint: string, cookie: string, params: AuthorizeParams, decision: "allow" | "deny") {
  return fetch(authorizeEndpoint, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: buildAuthorizeForm(params, decision),
  });
}

async function exchangeCode(tokenEndpoint: string, params: { code: string; redirectUri: string; clientId: string; verifier: string }) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.verifier,
    }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function refreshToken(tokenEndpoint: string, rawRefreshToken: string) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rawRefreshToken }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A real MCP Streamable HTTP call, handling both application/json and text/event-stream response shapes. */
async function mcpCall(mcpEndpoint: string, accessToken: string, method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  let body: unknown = null;
  if (contentType.includes("application/json")) {
    body = JSON.parse(text || "null");
  } else if (contentType.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    body = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
  }
  return { status: res.status, contentType, body };
}

async function mintFreshCode(authorizeEndpoint: string, cookie: string, clientId: string, redirectUri: string, method = "S256") {
  const { verifier, challenge } = pkcePair();
  const res = await postAuthorize(authorizeEndpoint, cookie, { clientId, redirectUri, challenge, method }, "allow");
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) return { code: null, verifier, location, status: res.status };
  const code = new URL(location).searchParams.get("code");
  return { code, verifier, location, status: res.status };
}

async function main() {
  console.log(`MCP OAuth flow check against ${BASE_URL}\n`);
  const redirectUri = "https://example.com/mcp-flow-check-callback";

  // ── 1. Discovery, followed exactly as a client would ────────────────
  section("1. Discovery");
  const prm = await getJson(`${BASE_URL}/.well-known/oauth-protected-resource`);
  const authServers = prm.authorization_servers as string[] | undefined;
  assert(Array.isArray(authServers) && authServers.length > 0, "protected-resource metadata names an authorization server");
  const authServerOrigin = authServers?.[0];

  const asMeta = authServerOrigin ? await getJson(`${authServerOrigin}/.well-known/oauth-authorization-server`) : {};
  const authorizationEndpoint = asMeta.authorization_endpoint as string | undefined;
  const tokenEndpoint = asMeta.token_endpoint as string | undefined;
  const registrationEndpoint = asMeta.registration_endpoint as string | undefined;
  assert(!!authorizationEndpoint && !!tokenEndpoint && !!registrationEndpoint, "authorization-server metadata names authorize/token/register endpoints", JSON.stringify(asMeta));

  if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
    console.error("\nCannot continue without discovery endpoints.");
    process.exit(1);
  }

  // Confirm /api/mcp actually challenges with the SAME protected-resource
  // document discovery started from — proves the 401 a real client hits
  // points back at the metadata this whole script is driven by.
  const mcpProbe = await fetch(`${BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const wwwAuth = mcpProbe.headers.get("www-authenticate") ?? "";
  assert(mcpProbe.status === 401, "/api/mcp returns 401 when unauthenticated");
  assert(wwwAuth.includes("resource_metadata"), "401's WWW-Authenticate carries resource_metadata", wwwAuth);

  // ── 2. Sign in (real Life OS session, for the /authorize consent step) ──
  section("2. Sign in");
  const jar = await signIn();
  pass("signed in via Supabase (session cookies captured)");

  // ── 3. Register a client ─────────────────────────────────────────────
  section("3. Register (DCR)");
  const client = await registerClient(registrationEndpoint, redirectUri);
  assert(typeof client.client_id === "string" && client.client_id.length > 0, "register returns a client_id");

  // ── 4. Full happy-path flow: authorize -> code -> token -> real MCP call ──
  section("4. Full flow: authorize -> code -> token -> initialize/tools-list");
  const { verifier, challenge } = pkcePair();
  const authResp = await postAuthorize(authorizationEndpoint, jar.header(), { clientId: client.client_id, redirectUri, challenge }, "allow");
  const location1 = authResp.headers.get("location");
  assert(authResp.status === 302 && !!location1, "Allow decision redirects with a code", `status=${authResp.status} location=${location1}`);
  const code1 = location1 ? new URL(location1).searchParams.get("code") : null;
  assert(!!code1, "redirect carries a code param");

  const exchange1 = code1 ? await exchangeCode(tokenEndpoint, { code: code1, redirectUri, clientId: client.client_id, verifier }) : { status: 0, body: {} };
  assert(exchange1.status === 200, "code exchange succeeds", JSON.stringify(exchange1.body));
  assert(typeof exchange1.body.access_token === "string", "response carries access_token");
  assert(typeof exchange1.body.refresh_token === "string", "response carries refresh_token");
  assert(!("expires_in" in exchange1.body), "response carries NO expires_in (deliberate -- see token route header)");
  const accessToken1 = exchange1.body.access_token as string | undefined;
  const refreshToken1 = exchange1.body.refresh_token as string | undefined;

  if (accessToken1) {
    const init = await mcpCall(`${BASE_URL}/api/mcp`, accessToken1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-flow-check", version: "1.0.0" } });
    assert(init.status === 200, "initialize succeeds with the minted access token", `status=${init.status} body=${JSON.stringify(init.body)}`);

    const toolsList = await mcpCall(`${BASE_URL}/api/mcp`, accessToken1, "tools/list");
    assert(toolsList.status === 200, "tools/list succeeds with the minted access token", `status=${toolsList.status} body=${JSON.stringify(toolsList.body)}`);
  } else {
    fail("initialize/tools-list", "no access token to test with");
  }

  // ── 5. Refresh, then prove reuse detection actually revokes the LIVE descendant ──
  section("5. Refresh rotation and reuse detection");
  const refresh1 = refreshToken1 ? await refreshToken(tokenEndpoint, refreshToken1) : { status: 0, body: {} };
  assert(refresh1.status === 200, "first refresh succeeds", JSON.stringify(refresh1.body));
  const accessToken2 = refresh1.body.access_token as string | undefined;
  const refreshToken2 = refresh1.body.refresh_token as string | undefined;
  assert(!!accessToken2 && accessToken2 !== accessToken1, "refresh mints a genuinely NEW access token");

  if (accessToken2) {
    const initWithNew = await mcpCall(`${BASE_URL}/api/mcp`, accessToken2, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-flow-check", version: "1.0.0" } });
    assert(initWithNew.status === 200, "the ROTATED access token works", `status=${initWithNew.status}`);
  }
  if (accessToken1) {
    const initWithOld = await mcpCall(`${BASE_URL}/api/mcp`, accessToken1, "initialize", {});
    assert(initWithOld.status === 401, "the token that got rotated AWAY FROM is now revoked", `status=${initWithOld.status}`);
  }

  // Replay refreshToken1 -- already rotated once, above. This must (a) fail,
  // and (b) revoke accessToken2, the CURRENTLY LIVE descendant -- the exact
  // fix made during this verification (see lib/mcp/oauth.ts's
  // findLiveAccessTokenIdsForClient). A version of this server that only
  // revokes the stale row's OWN (already-dead) access token would pass (a)
  // and silently fail (b) -- this is the check that tells them apart.
  const replay = refreshToken1 ? await refreshToken(tokenEndpoint, refreshToken1) : { status: 0, body: {} };
  assert(replay.status !== 200, "REPLAYING an already-rotated refresh token is rejected", JSON.stringify(replay.body));

  if (accessToken2) {
    // Give the revoke a brief moment to be visible (should be immediate; this is not a retry-until-pass loop).
    const initAfterReplay = await mcpCall(`${BASE_URL}/api/mcp`, accessToken2, "initialize", {});
    assert(
      initAfterReplay.status === 401,
      "reuse detection revoked the CURRENTLY LIVE access token, not just the already-dead one",
      `status=${initAfterReplay.status} -- if this is 200, the live-descendant fix is not live on ${BASE_URL} yet`
    );
  }

  // ── 6. Negative cases ─────────────────────────────────────────────────
  section("6. Negative cases");

  // (a) Unregistered redirect_uri: must show an error, MUST NOT redirect anywhere.
  {
    const { challenge: c } = pkcePair();
    const res = await postAuthorize(authorizationEndpoint, jar.header(), { clientId: client.client_id, redirectUri: "https://evil.example.com/callback", challenge: c }, "allow");
    assert(res.status !== 302, "unregistered redirect_uri: NOT a redirect", `status=${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    assert(ct.includes("text/html"), "unregistered redirect_uri: renders an HTML error page", ct);
  }

  // (b) A code redeemed twice.
  {
    const minted = await mintFreshCode(authorizationEndpoint, jar.header(), client.client_id, redirectUri);
    if (minted.code) {
      const first = await exchangeCode(tokenEndpoint, { code: minted.code, redirectUri, clientId: client.client_id, verifier: minted.verifier });
      assert(first.status === 200, "double-redeem test: first redemption succeeds");
      const second = await exchangeCode(tokenEndpoint, { code: minted.code, redirectUri, clientId: client.client_id, verifier: minted.verifier });
      assert(second.status !== 200, "double-redeem test: SECOND redemption of the same code fails", JSON.stringify(second.body));
    } else {
      fail("double-redeem test", `could not mint a code (authorize status ${minted.status})`);
    }
  }

  // (c) Wrong code_verifier.
  {
    const minted = await mintFreshCode(authorizationEndpoint, jar.header(), client.client_id, redirectUri);
    if (minted.code) {
      const wrongVerifier = crypto.randomBytes(32).toString("base64url");
      const res = await exchangeCode(tokenEndpoint, { code: minted.code, redirectUri, clientId: client.client_id, verifier: wrongVerifier });
      assert(res.status !== 200, "wrong code_verifier is rejected", JSON.stringify(res.body));
    } else {
      fail("wrong-verifier test", `could not mint a code (authorize status ${minted.status})`);
    }
  }

  // (d) Different client_id than issued the code.
  {
    const otherClient = await registerClient(registrationEndpoint, redirectUri);
    const minted = await mintFreshCode(authorizationEndpoint, jar.header(), client.client_id, redirectUri);
    if (minted.code) {
      const res = await exchangeCode(tokenEndpoint, { code: minted.code, redirectUri, clientId: otherClient.client_id, verifier: minted.verifier });
      assert(res.status !== 200, "redeeming with a DIFFERENT client_id than issued the code is rejected", JSON.stringify(res.body));
    } else {
      fail("wrong-client_id test", `could not mint a code (authorize status ${minted.status})`);
    }
  }

  // (e) code_challenge_method=plain rejected before it ever reaches a code mint.
  {
    const { challenge: c } = pkcePair();
    const res = await postAuthorize(authorizationEndpoint, jar.header(), { clientId: client.client_id, redirectUri, challenge: c, method: "plain" }, "allow");
    const location = res.headers.get("location");
    const hasCode = !!(location && new URL(location).searchParams.get("code"));
    assert(!hasCode, "code_challenge_method=plain never produces a code", `status=${res.status} location=${location}`);
    if (location) {
      assert(new URL(location).searchParams.get("error") === "invalid_request", "plain PKCE is rejected as invalid_request", location);
    }
  }

  // (f) Deny actually denies.
  {
    const { challenge: c } = pkcePair();
    const res = await postAuthorize(authorizationEndpoint, jar.header(), { clientId: client.client_id, redirectUri, challenge: c }, "deny");
    const location = res.headers.get("location");
    const hasCode = !!(location && new URL(location).searchParams.get("code"));
    assert(!hasCode, "Deny decision never produces a code", `status=${res.status} location=${location}`);
    if (location) {
      assert(new URL(location).searchParams.get("error") === "access_denied", "Deny redirects with error=access_denied", location);
    }
  }

  // ── summary ────────────────────────────────────────────────────────────
  console.log(`\n${passCount} passed, ${failCount} failed\n`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nSCRIPT ERROR (not a check failure -- the run itself broke):", err);
  process.exit(2);
});
