/**
 * P4-13 integration check: the OAuth refresh grant (migration 217,
 * public.mcp_oauth_refresh_grant) and the authorize hardening, driven through
 * the REAL deployed endpoints with REAL test accounts. Lead-run; not part of
 * vitest (the fake-DB tests cannot exercise the SQL function).
 *
 * Usage:
 *   npx tsx scripts/mcp-oauth-refresh-grant-check.ts [baseUrl] [--accounts path/to/accounts.json] [--race N]
 *     baseUrl    default https://tracking-app-sand.vercel.app
 *     --accounts JSON object { "<email>": { email, password, userId, mode } } -- TEST ACCOUNTS ONLY
 *                (default: $TEAMB_ACCOUNTS_JSON, else the overnight run's teamb-accounts.json)
 *     --race N   concurrent replay-vs-refresh iterations per account (default 5)
 * Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY),
 * SUPABASE_SERVICE_ROLE_KEY (read-only verification + fixture cleanup).
 *
 * Per account it checks:
 *   A. authorize guards: consent POST without Origin -> 403; foreign resource -> invalid_target
 *   B. code exchange -> token A (+R1), expires_in 2592000, client_kind mcp_oauth
 *   C. schedule created with A via MCP scheduler_manage
 *   D. refresh R1 -> 200 B (+R2); A revoked; schedule moved A -> B; B lists it over MCP
 *   E. replay R1 -> 400 invalid_grant; B revoked; R2 burned; nothing live; schedule stays on B
 *   F. sibling R2 -> 400 invalid_grant; still nothing live
 *   G. revoked-token refresh: new chain, revoke its token (as Settings would) -> refresh 400, nothing minted
 *   H. RACE x N: fresh chain, refresh once (Q1 -> Q2), then fire refresh(Q2) and replay(Q1)
 *      SIMULTANEOUSLY -> afterwards 0 live tokens and 0 unused refresh tokens for the client
 *      (before 217 a refresh that won the race could leave a live token)
 *
 * Cleanup (finally): cancels schedules it created, revokes every access token
 * and burns every refresh token belonging to the clients it registered, then
 * deletes those client rows (cascading only this script's own codes/refresh
 * rows on test accounts). Exit code 0 only if every check passed.
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
const RACE_N = Number(flag("--race") ?? 5);
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
const REDIRECT_URI = "http://127.0.0.1:8765/p4-13-check-cb";
const CLIENT_NAME = "P4-13 refresh grant check";

let passed = 0;
let failed = 0;
function check(account: string, label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] ${label}${detail ? ` :: ${detail.slice(0, 300)}` : ""}`);
}

const registeredClientIds: string[] = [];
const createdSchedules: string[] = [];

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

function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(6).toString("hex"),
    scope: "read write",
    resource: MCP_URL,
    ...extra,
  });
}

async function consent(cookie: string, params: URLSearchParams, headers: Record<string, string> = { origin: BASE }) {
  const body = new URLSearchParams(params);
  body.set("decision", "allow");
  return fetch(`${BASE}/api/mcp/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

interface Tokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(fields: Record<string, string>): Promise<{ status: number; body: Tokens }> {
  const res = await fetch(`${BASE}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Tokens };
}

const refresh = (rt: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: rt });

/** A fresh chain: consent -> code -> tokens. */
async function newChain(cookie: string, clientId: string): Promise<Tokens> {
  const { verifier, challenge } = pkce();
  const res = await consent(cookie, authorizeParams(clientId, challenge));
  const loc = res.headers.get("location") ?? "";
  const code = loc ? new URL(loc).searchParams.get("code") : null;
  if (res.status !== 302 || !code) throw new Error(`consent -> ${res.status} ${loc}`);
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier });
  if (t.status !== 200) throw new Error(`code exchange -> ${t.status} ${JSON.stringify(t.body)}`);
  return t.body;
}

async function tokenRow(raw: string) {
  const { data } = await service
    .from("mcp_access_tokens")
    .select("id, revoked_at, client_kind, expires_at, scopes")
    .eq("token_hash", sha256(raw))
    .maybeSingle();
  return data as { id: string; revoked_at: string | null; client_kind: string; expires_at: string | null; scopes: string[] } | null;
}

async function refreshRow(raw: string) {
  const { data } = await service.from("mcp_oauth_refresh_tokens").select("id, rotated_at, access_token_id").eq("token_hash", sha256(raw)).maybeSingle();
  return data as { id: string; rotated_at: string | null; access_token_id: string } | null;
}

/** Live access tokens / unused refresh tokens for one (user, client) pair. */
async function pairState(userId: string, clientId: string) {
  const { data: refreshRows } = await service.from("mcp_oauth_refresh_tokens").select("access_token_id, rotated_at").eq("user_id", userId).eq("client_id", clientId);
  const rows = (refreshRows ?? []) as { access_token_id: string; rotated_at: string | null }[];
  const ids = [...new Set(rows.map((r) => r.access_token_id))];
  const { data: toks } = ids.length
    ? await service.from("mcp_access_tokens").select("id").in("id", ids).is("revoked_at", null)
    : { data: [] as { id: string }[] };
  return { live: (toks ?? []).length, unusedRefresh: rows.filter((r) => !r.rotated_at).length };
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "p4-13-check", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    return { isError: !!r.isError, text: r.content?.[0]?.text ?? "" };
  } finally {
    await client.close();
  }
}

async function runAccount(email: string, password: string, userId: string) {
  const who = email.split("@")[0];
  const cookie = await sessionCookie(email, password);
  const clientId = await register();

  // A. authorize guards (deployed ea9b1e0)
  {
    const { challenge } = pkce();
    const noOrigin = await consent(cookie, authorizeParams(clientId, challenge), {});
    check(who, "A1 consent POST without Origin -> 403", noOrigin.status === 403, `${noOrigin.status}`);
    const badResource = await fetch(`${BASE}/api/mcp/oauth/authorize?${authorizeParams(clientId, challenge, { resource: "https://evil.example.com/api/mcp" })}`, { headers: { cookie }, redirect: "manual" });
    const loc = badResource.headers.get("location") ?? "";
    check(who, "A2 foreign resource -> redirect invalid_target", badResource.status === 302 && loc.includes("error=invalid_target"), `${badResource.status} ${loc}`);
  }

  // B. code exchange
  const t1 = await newChain(cookie, clientId);
  const A = await tokenRow(t1.access_token!);
  check(who, "B code exchange: expires_in 2592000, mcp_oauth, ~30d expiry", t1.expires_in === 2592000 && A?.client_kind === "mcp_oauth" && !!A?.expires_at && Date.parse(A.expires_at) > Date.now() + 29 * 86400_000, JSON.stringify({ expires_in: t1.expires_in, kind: A?.client_kind, exp: A?.expires_at }));

  // C. schedule under A
  const created = await mcpCall(t1.access_token!, "scheduler_manage", {
    action: "create",
    patch: { tool_name: "write", domain: "deen", entity: "prayer", action: "log", write_patch: { prayer_name: "fajr", status: "on_time", date: "2026-10-01" }, run_at: new Date(Date.now() + 14 * 86400_000).toISOString() },
  });
  let scheduleId: string | null = null;
  try {
    scheduleId = (JSON.parse(created.text) as { id?: string }).id ?? null;
  } catch {
    /* reported below */
  }
  if (scheduleId) createdSchedules.push(scheduleId);
  check(who, "C schedule created with token A", !created.isError && !!scheduleId, created.text);
  const scheduleToken = async () => (await service.from("mcp_scheduled_actions").select("token_id, status").eq("id", scheduleId!).single()).data as { token_id: string; status: string } | null;

  // D. refresh R1
  const r1 = await refresh(t1.refresh_token!);
  const B = r1.body.access_token ? await tokenRow(r1.body.access_token) : null;
  const aAfter = await tokenRow(t1.access_token!);
  const s1 = await scheduleToken();
  check(who, "D1 refresh R1 -> 200 with a new token, expires_in, same scopes", r1.status === 200 && !!B && r1.body.expires_in === 2592000 && r1.body.scope === "read write", `${r1.status} ${JSON.stringify({ ...r1.body, access_token: "<x>", refresh_token: "<x>" })}`);
  check(who, "D2 A revoked, B live mcp_oauth", !!aAfter?.revoked_at && !!B && !B.revoked_at && B.client_kind === "mcp_oauth");
  check(who, "D3 schedule moved A -> B, still active", s1?.token_id === B?.id && s1?.status === "active", JSON.stringify(s1));
  const listed = await mcpCall(r1.body.access_token!, "scheduler_manage", { action: "list" });
  check(who, "D4 B lists the schedule over MCP", !listed.isError && listed.text.includes(scheduleId ?? "missing"));

  // E. replay R1
  const replay = await refresh(t1.refresh_token!);
  const bAfter = await tokenRow(r1.body.access_token!);
  const r2Row = await refreshRow(r1.body.refresh_token!);
  const pE = await pairState(userId, clientId);
  const s2 = await scheduleToken();
  check(who, "E1 replay R1 -> 400 invalid_grant, no tokens", replay.status === 400 && replay.body.error === "invalid_grant" && !replay.body.access_token, `${replay.status} ${JSON.stringify(replay.body)}`);
  check(who, "E2 B revoked, R2 burned, nothing live for the client", !!bAfter?.revoked_at && !!r2Row?.rotated_at && pE.live === 0 && pE.unusedRefresh === 0, JSON.stringify({ bRevoked: bAfter?.revoked_at, r2: r2Row?.rotated_at, ...pE }));
  check(who, "E3 schedule stays on B (not re-pointed)", s2?.token_id === B?.id, JSON.stringify(s2));

  // F. sibling R2
  const sib = await refresh(r1.body.refresh_token!);
  const pF = await pairState(userId, clientId);
  check(who, "F sibling R2 -> 400 invalid_grant, still nothing live", sib.status === 400 && sib.body.error === "invalid_grant" && !sib.body.access_token && pF.live === 0, `${sib.status} ${JSON.stringify(sib.body)} ${JSON.stringify(pF)}`);

  // G. revoked-token refresh
  {
    const g = await newChain(cookie, clientId);
    const gTok = await tokenRow(g.access_token!);
    await service.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", gTok!.id);
    const before = await pairState(userId, clientId);
    const res = await refresh(g.refresh_token!);
    const after = await pairState(userId, clientId);
    check(who, "G refresh of a revoked token -> 400 invalid_grant, nothing minted", res.status === 400 && res.body.error === "invalid_grant" && after.live === 0 && before.live === 0, `${res.status} ${JSON.stringify(res.body)} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  // H. concurrent replay vs refresh
  let raceFailures = 0;
  const outcomes: string[] = [];
  for (let i = 0; i < RACE_N; i++) {
    const raceClient = await register();
    const q = await newChain(cookie, raceClient);
    const q1Refresh = await refresh(q.refresh_token!); // Q1 -> Q2 legitimately
    if (q1Refresh.status !== 200) {
      raceFailures++;
      outcomes.push(`setup:${q1Refresh.status}`);
      continue;
    }
    const [sibling, replayQ1] = await Promise.all([refresh(q1Refresh.body.refresh_token!), refresh(q.refresh_token!)]);
    const st = await pairState(userId, raceClient);
    outcomes.push(`${sibling.status}/${replayQ1.status}:live=${st.live},unused=${st.unusedRefresh}`);
    if (st.live !== 0 || st.unusedRefresh !== 0 || replayQ1.status !== 400) raceFailures++;
  }
  check(who, `H concurrent refresh(Q2) + replay(Q1) x${RACE_N}: never leaves a live token or unused refresh token`, raceFailures === 0, outcomes.join(" "));
}

async function cleanup() {
  const now = new Date().toISOString();
  if (createdSchedules.length) {
    await service.from("mcp_scheduled_actions").update({ status: "cancelled" }).in("id", createdSchedules);
  }
  if (registeredClientIds.length) {
    const { data: rows } = await service.from("mcp_oauth_refresh_tokens").select("access_token_id").in("client_id", registeredClientIds);
    const ids = [...new Set(((rows ?? []) as { access_token_id: string }[]).map((r) => r.access_token_id))];
    if (ids.length) await service.from("mcp_access_tokens").update({ revoked_at: now }).in("id", ids).is("revoked_at", null);
    await service.from("mcp_oauth_refresh_tokens").update({ rotated_at: now }).in("client_id", registeredClientIds).is("rotated_at", null);
    // Test-account fixtures only: the client rows this script registered (cascades their codes/refresh rows).
    await service.from("mcp_scheduled_actions").update({ status: "cancelled" }).in("token_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).neq("status", "cancelled");
    await service.from("mcp_oauth_clients").delete().in("client_id", registeredClientIds).eq("client_name", CLIENT_NAME);
  }
  console.log(`cleanup: cancelled ${createdSchedules.length} schedule(s); revoked/burned tokens and deleted ${registeredClientIds.length} test client(s)`);
}

async function main() {
  console.log(`P4-13 refresh-grant check against ${BASE} (race x${RACE_N})`);
  try {
    for (const a of Object.values(accounts)) {
      try {
        await runAccount(a.email, a.password, a.userId);
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
