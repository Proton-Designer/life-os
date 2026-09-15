/**
 * P4-13 04 verification, the 3 checks NOT covered by
 * mcp-oauth-refresh-grant-check.ts (that script proves the refresh grant +
 * authorize guards A/B; this one proves the login round-trip and the
 * default-scope behaviour). Lead/reviewer-run against the REAL deployed
 * server with the teamb-* test accounts. Never Playwright (AGENTS.md).
 *
 * Usage:
 *   npx tsx scripts/p4-13-login-scope-check.ts [baseUrl] [--accounts path/to/accounts.json]
 * Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or _PUBLISHABLE_KEY), SUPABASE_SERVICE_ROLE_KEY.
 *
 * Per account:
 *   1. GET /api/mcp/oauth/authorize with no session -> "sign in first" page
 *      linking to /login?next=<this authorize path>, same params intact.
 *   2. GET that /login?next=... unauthenticated -> the page's hidden `next`
 *      field round-trips the value (safeNextPath accepted a REAL authorize
 *      URL, not just a synthetic test string).
 *   3. GET /login?next=//evil.com unauthenticated -> no hidden `next` field
 *      at all (safeNextPath rejected it, so sign-in falls through to "/").
 *   4. A real sign-in (direct signInWithPassword, cookies captured -- same
 *      technique mcp-oauth-flow-check.ts already uses, since the
 *      app/login/actions.ts signIn action is exactly
 *      `redirect(safeNextPath(next) ?? "/")` and safeNextPath itself is unit
 *      tested), then GET the SAME authorize URL with that session -> now the
 *      CONSENT page, with matching client_id/redirect_uri -- proves the
 *      round trip lands back on consent with the same params.
 *   5. GET authorize with no `scope` param (authenticated) -> consent page
 *      shows "Requesting: read" only, hidden scope field is exactly "read".
 *      Allow it -> code exchange returns scope "read". A `write` tool call
 *      on that token is denied (insufficient_scope), never reaching the DB.
 *
 * Cleanup (finally): revokes any tokens minted and deletes the client this
 * script registered.
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BASE = (argv.find((a) => a.startsWith("http")) ?? "https://tracking-app-sand.vercel.app").replace(/\/$/, "");
const MCP_URL = `${BASE}/api/mcp`;
const ACCOUNTS_PATH =
  flag("--accounts") ??
  process.env.TEAMB_ACCOUNTS_JSON ??
  path.resolve(__dirname, "../.claude/overnight/run-20260915-0011/teamb-accounts.json");

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !ANON || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / anon key / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8")) as Record<string, { email: string; password: string; userId: string; mode: string }>;
for (const a of Object.values(accounts)) {
  if (!/@lifeos\.test$/.test(a.email)) {
    console.error(`Refusing to run against a non-test account: ${a.email}`);
    process.exit(2);
  }
}

const service = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const REDIRECT_URI = "http://127.0.0.1:8765/p4-13-login-scope-check-cb";
const CLIENT_NAME = "P4-13 login/scope check";

let passed = 0;
let failed = 0;
function check(account: string, label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] ${label}${detail ? ` :: ${detail.slice(0, 300)}` : ""}`);
}

const registeredClientIds: string[] = [];

async function sessionCookie(email: string, password: string): Promise<string> {
  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPA_URL!, ANON!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function register(): Promise<string> {
  const res = await fetch(`${BASE}/api/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [REDIRECT_URI] }),
  });
  const body = (await res.json()) as { client_id?: string; error_description?: string };
  if (res.status !== 201 || !body.client_id) throw new Error(`register -> ${res.status} ${JSON.stringify(body)}`);
  registeredClientIds.push(body.client_id);
  return body.client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** No `scope` key unless the caller supplies one -- unlike the refresh-grant script, this one needs the omitted-scope case. */
function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(6).toString("hex"),
    resource: MCP_URL,
    ...extra,
  });
}

async function tokenRequest(fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "p4-13-login-scope-check", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    return { isError: !!r.isError, text: r.content?.[0]?.text ?? "" };
  } finally {
    await client.close();
  }
}

async function revokeToken(raw: string) {
  await service.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", sha256(raw)).is("revoked_at", null);
}

async function runAccount(email: string, password: string) {
  const who = email.split("@")[0];
  const clientId = await register();

  // ── 1 & 2: unauthenticated authorize -> login-required page -> /login?next= round-trips ──
  const { challenge: c1 } = pkce();
  const params1 = authorizeParams(clientId, c1, { scope: "read write" });
  const authorizeUrl = `${BASE}/api/mcp/oauth/authorize?${params1.toString()}`;
  const noSession = await fetch(authorizeUrl, { redirect: "manual" });
  const body1 = await noSession.text();
  check(who, "1a unauthenticated GET authorize -> 200 'sign in first' page", noSession.status === 200 && body1.includes("Sign in to Life OS first"), `${noSession.status}`);

  const hrefMatch = body1.match(/href="([^"]*)"/);
  const loginHref = hrefMatch ? hrefMatch[1].replace(/&amp;/g, "&") : "";
  check(who, "1b login-required link points at /login?next=<this authorize path>", loginHref.startsWith("/login?next="), loginHref);
  const decodedNext = decodeURIComponent(loginHref.slice("/login?next=".length));
  check(who, "1c the encoded next is this exact authorize path+params", decodedNext === `/api/mcp/oauth/authorize?${params1.toString()}`, decodedNext);

  const loginPage = await fetch(`${BASE}${loginHref}`, { redirect: "manual" });
  const loginBody = await loginPage.text();
  const nextInputMatch = loginBody.match(/name="next"\s+value="([^"]*)"/);
  check(who, "2 /login?next=<authorize url> unauthenticated round-trips it into a hidden `next` field", loginPage.status === 200 && !!nextInputMatch, `status=${loginPage.status} hasField=${!!nextInputMatch}`);
  if (nextInputMatch) {
    const fieldValue = nextInputMatch[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    check(who, "2b the round-tripped next value is unchanged", fieldValue === decodedNext, fieldValue);
  }

  // ── 3: open-redirect guard ──
  const evilLogin = await fetch(`${BASE}/login?next=${encodeURIComponent("//evil.com")}`, { redirect: "manual" });
  const evilBody = await evilLogin.text();
  check(who, "3 /login?next=//evil.com -> no hidden `next` field (safeNextPath rejected it, falls through to '/')", evilLogin.status === 200 && !/name="next"/.test(evilBody), `status=${evilLogin.status}`);

  // ── 4: after a real sign-in, the SAME authorize URL lands on consent with matching params ──
  const cookie = await sessionCookie(email, password);
  const authed = await fetch(authorizeUrl, { headers: { cookie }, redirect: "manual" });
  const authedBody = await authed.text();
  // The consent form has no `action=` attribute by design (posts back to the
  // current URL, /api/mcp/oauth/authorize?...) -- match on the form itself
  // plus the "Requesting:" scopes line instead.
  const hasConsentForm = authed.status === 200 && /<form method="POST">/.test(authedBody) && authedBody.includes("Requesting:");
  const hasClientId = authedBody.includes(`value="${clientId}"`);
  const hasRedirectUri = authedBody.includes(REDIRECT_URI.replace(/&/g, "&amp;"));
  check(who, "4 signed-in GET of the SAME authorize URL -> consent page with matching client_id/redirect_uri", hasConsentForm && hasClientId && hasRedirectUri, `status=${authed.status} form=${hasConsentForm} client=${hasClientId} redirect=${hasRedirectUri}`);

  // ── 5: omitted scope defaults to read-only end to end ──
  const { verifier: v2, challenge: c2 } = pkce();
  const params2 = authorizeParams(clientId, c2); // no scope key at all
  const noScopeAuthorize = await fetch(`${BASE}/api/mcp/oauth/authorize?${params2.toString()}`, { headers: { cookie }, redirect: "manual" });
  const noScopeBody = await noScopeAuthorize.text();
  check(who, "5a no scope param -> consent shows 'Requesting: read' only", noScopeAuthorize.status === 200 && /Requesting:\s*read\s*</.test(noScopeBody), noScopeBody.match(/Requesting:[^<]*/)?.[0] ?? "no match");
  check(who, "5b hidden scope field is exactly read (not read write)", /name="scope"\s+value="read"/.test(noScopeBody), "");

  const consentBody = new URLSearchParams(params2);
  consentBody.set("decision", "allow");
  const consentRes = await fetch(`${BASE}/api/mcp/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin: BASE },
    body: consentBody,
  });
  const loc = consentRes.headers.get("location") ?? "";
  const code = loc ? new URL(loc).searchParams.get("code") : null;
  check(who, "5c consent allow -> 302 with a code", consentRes.status === 302 && !!code, `${consentRes.status} ${loc}`);

  if (code) {
    const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: v2 });
    check(who, "5d code exchange -> token scope is exactly 'read'", t.status === 200 && t.body.scope === "read", JSON.stringify(t.body));
    const accessToken = t.body.access_token as string | undefined;
    if (accessToken) {
      const writeAttempt = await mcpCall(accessToken, "write", { domain: "deen", entity: "prayer", action: "log", patch: { prayer_name: "fajr", status: "on_time", date: "2026-10-02" } });
      check(who, "5e a write call on the read-only token is denied (insufficient_scope), nothing written", writeAttempt.isError && /write.*permission|insufficient/i.test(writeAttempt.text), writeAttempt.text);
      await revokeToken(accessToken);
    }
  }
}

async function cleanup() {
  if (registeredClientIds.length) {
    const { data: rows } = await service.from("mcp_oauth_refresh_tokens").select("access_token_id").in("client_id", registeredClientIds);
    const ids = [...new Set(((rows ?? []) as { access_token_id: string }[]).map((r) => r.access_token_id))];
    if (ids.length) await service.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).in("id", ids).is("revoked_at", null);
    await service.from("mcp_oauth_refresh_tokens").update({ rotated_at: new Date().toISOString() }).in("client_id", registeredClientIds).is("rotated_at", null);
    await service.from("mcp_oauth_clients").delete().in("client_id", registeredClientIds).eq("client_name", CLIENT_NAME);
  }
  console.log(`cleanup: revoked/burned tokens and deleted ${registeredClientIds.length} test client(s)`);
}

async function main() {
  console.log(`P4-13 login/scope check against ${BASE}`);
  try {
    for (const a of Object.values(accounts)) {
      try {
        await runAccount(a.email, a.password);
      } catch (e) {
        check(a.email.split("@")[0], "run aborted", false, e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    await cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
