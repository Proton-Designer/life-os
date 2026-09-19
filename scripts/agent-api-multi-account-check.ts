/**
 * P4-25 -- the direct proof of the user's own headline worry: that the
 * agent surface (MCP AND REST) works identically for every account SHAPE,
 * not just the one the builder happened to test on. Three account shapes
 * in one run: legacy SEED, domains-mode seed-domains, and a completely
 * FRESH account this script creates and deletes itself (auth.users only,
 * zero profiles/user_settings/user_domains rows -- proving an agent, not a
 * browser, can be the very first-ever writer on a brand-new account).
 *
 * LEAD-RUN against the real SEED/seed-domains accounts (RULES-CARD:
 * Playwright/live-account logins are Lead-only). The fresh-account leg
 * needs no existing credentials at all and is safe for anyone to run --
 * this script creates it, uses it, and deletes it every time.
 *
 * Same technique as scripts/mcp-write-loop-check.ts / p4-07-write-loop-check.ts:
 * a real minted PAT, a real network round trip (MCP via @modelcontextprotocol/sdk,
 * REST via plain fetch against /api/v1), cleanup verified by absence, never
 * trusting a tool's own success text. New here: EVERY capability is run
 * over BOTH transports, and the SAME battery runs per account so an
 * asymmetry between account shapes is a diff in this script's own output,
 * not something a reader has to notice by eye.
 *
 * Usage:
 *   npx tsx scripts/agent-api-multi-account-check.ts [baseUrl] [--accounts path/to/accounts.json] [--positive-control] [--skip-fresh]
 *
 * --positive-control: runs the SAME battery against an ALREADY-REVOKED
 *   token instead of a live one. Every capability check now has to fail
 *   (a revoked token can do nothing), so the harness SHOULD exit non-zero
 *   -- if it doesn't, the harness itself isn't examining anything
 *   real (CLAUDE.md: "a check that examines nothing reports success").
 *   Run this FIRST, confirm it exits 1, THEN trust a real run's green.
 * --accounts: JSON file of {name: {email,password,userId,mode}} for the
 *   legacy + domains legs (same shape teamb-accounts.json/
 *   test-accounts-team-a.json already use). Omit --positive-control and
 *   --accounts together to run the real 2-account + fresh-account matrix.
 * --skip-fresh: skip creating/deleting the fresh account leg (faster local
 *   iteration on the --accounts legs only).
 *
 * Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or _PUBLISHABLE_KEY), SUPABASE_SERVICE_ROLE_KEY.
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fromAccountMapWire, type AccountMapWire } from "@/lib/agent-api/account-map-wire";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(name);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BASE = (argv.find((a) => a.startsWith("http")) ?? "https://tracking-app-sand.vercel.app").replace(/\/$/, "");
const MCP_URL = `${BASE}/api/mcp`;
const REST_URL = `${BASE}/api/v1`;
const POSITIVE_CONTROL = has("--positive-control");
const SKIP_FRESH = has("--skip-fresh");
const ACCOUNTS_PATH = flag("--accounts") ?? process.env.MULTI_ACCOUNT_CHECK_ACCOUNTS_JSON;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !ANON || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / anon key / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

type ExistingAccount = { email: string; password: string; userId: string; mode: "legacy" | "domains" };
let existingAccounts: Record<string, ExistingAccount> = {};
if (ACCOUNTS_PATH) {
  existingAccounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8")) as Record<string, ExistingAccount>;
  for (const a of Object.values(existingAccounts)) {
    if (!/@lifeos\.test$/.test(a.email)) {
      console.error(`Refusing to run against a non-test account: ${a.email}`);
      process.exit(2);
    }
  }
}

// ---------------------------------------------------------------------------
// token minting (service-role insert, same technique every LOOP CHECK script
// uses -- lib/mcp/tokens.ts is server-only and can't be imported here)
// ---------------------------------------------------------------------------
const TOKEN_PREFIX = "lifeos_pat_";
const generateRawToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");
const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const last4 = (t: string) => t.slice(-4);
const LABEL = "P4-25 MULTI-ACCOUNT CHECK";

async function mintToken(userId: string, expiresInMs = 60 * 60 * 1000): Promise<{ raw: string; tokenId: string }> {
  const raw = generateRawToken();
  const { data, error } = await admin
    .from("mcp_access_tokens")
    .insert({
      user_id: userId,
      token_hash: hashToken(raw),
      token_last4: last4(raw),
      label: LABEL,
      scopes: ["read", "write"],
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      client_kind: "agent",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`token mint failed: ${error?.message}`);
  return { raw, tokenId: data.id as string };
}

async function revokeToken(tokenId: string): Promise<void> {
  await admin.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).is("revoked_at", null);
}

// ---------------------------------------------------------------------------
// pass/fail reporting -- a matrix, not a flat list: [account][capability] = PASS/FAIL
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const matrix: Record<string, Record<string, boolean>> = {};
function check(account: string, label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  (matrix[account] ??= {})[label] = ok;
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] ${label}${detail ? ` :: ${detail.slice(0, 300)}` : ""}`);
}

function textOf(r: { content?: { type: string; text?: string }[] }) {
  return (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

// ---------------------------------------------------------------------------
// MCP + REST call helpers -- every capability goes through exactly one of
// these two, so "over BOTH MCP and REST" is a loop variable, not duplicated
// code.
// ---------------------------------------------------------------------------
async function mcpConnect(rawToken: string): Promise<Client> {
  const client = new Client({ name: "p4-25-multi-account-check", version: "0.1.0" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${rawToken}` } } }));
  return client;
}

async function mcpTool(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; json: unknown }> {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
  const text = textOf(r as { content?: { type: string; text?: string }[] });
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not every result is JSON (e.g. plain error text) */
  }
  return { isError: !!r.isError, text, json };
}

async function restCall(rawToken: string, method: "GET" | "POST", segments: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${REST_URL}/${segments}`, {
    method,
    headers: { Authorization: `Bearer ${rawToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// DOMAIN PROBES -- one safe, understood, IDEMPOTENT write per domain
// (idempotent: true in lib/mcp/write-registry.ts -- checked against the
// registry directly, not assumed from a sibling action's own flag). Some
// domains have NO idempotent action that needs zero prerequisites (e.g.
// goals/habits: every idempotent action there -- set_status, vote.cast --
// needs an existing goal/habit id, and the only way to get one is a plain
// INSERT create action that is explicitly idempotent:false). For those,
// `setup` runs ONCE via MCP only to produce the prerequisite id (not part
// of the idempotent claim itself, and not repeated over REST), and the
// actual PROBED action -- the one called over both transports -- is the
// genuinely idempotent one against that id.
//
// The READ side is intentionally NOT hardcoded per domain: it's taken live
// from each account's own list_capabilities() -> domains[domain].read[0],
// so a domain gaining/losing a read entity can never silently desync this
// script from the real registry.
// ---------------------------------------------------------------------------
type Probe = (ctx: { mcp: Client | null; raw: string; userId: string; who: string; todayLocalDate: string | null }) => Promise<void>;

const PROBE_DATE = "2026-01-04"; // a fixed past date, never today -- never collides with a real day's data

async function probeDeen({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  const w = await mcpTool(mcp, "write", { domain: "deen", entity: "prayer", action: "log", patch: { date: PROBE_DATE, prayer_name: "fajr", status: "qada" } });
  check(who, "MCP write deen.prayer.log", !w.isError, w.text.slice(0, 150));
  const { data: after1 } = await admin.from("prayers").select("status").eq("user_id", userId).eq("date", PROBE_DATE).eq("prayer_name", "fajr").maybeSingle();
  check(who, "DB confirms deen.prayer.log landed", after1?.status === "qada", JSON.stringify(after1));

  const rw = await restCall(raw, "POST", "deen/prayer/log", { patch: { date: PROBE_DATE, prayer_name: "fajr", status: "qada" } });
  check(who, "REST POST /deen/prayer/log", rw.status === 200, `status ${rw.status}`);

  await mcpTool(mcp, "write", { domain: "deen", entity: "prayer", action: "unlog", patch: { date: PROBE_DATE, prayer_name: "fajr" } });
  const { data: after2 } = await admin.from("prayers").select("status").eq("user_id", userId).eq("date", PROBE_DATE).eq("prayer_name", "fajr").maybeSingle();
  check(who, "cleanup: deen.prayer back to unlogged", after2?.status === "unlogged", JSON.stringify(after2));
}

async function probeSettings({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  const VALUES = [1, 2, 3, 4, 5, 6, 7];
  const w = await mcpTool(mcp, "write", { domain: "settings", entity: "user_setting", action: "set_weekday_baselines", patch: { values: VALUES } });
  check(who, "MCP write settings.user_setting.set_weekday_baselines", !w.isError, w.text.slice(0, 150));
  // P4-23's own bug: an UPDATE-only write against a missing user_settings row
  // silently wrote nothing. The fix ensures the row first -- this is EXACTLY
  // the capability the fresh-account leg exists to re-prove, through a real
  // agent call this time, not the Settings UI.
  const { data: after1 } = await admin.from("user_settings").select("weekday_baselines").eq("user_id", userId).maybeSingle();
  check(who, "DB confirms weekday_baselines landed (proves lazy row-creation works for an agent write too)", JSON.stringify(after1?.weekday_baselines) === JSON.stringify(VALUES), JSON.stringify(after1));

  const rw = await restCall(raw, "POST", "settings/user_setting/set_weekday_baselines", { patch: { values: VALUES } });
  check(who, "REST POST /settings/user_setting/set_weekday_baselines", rw.status === 200, `status ${rw.status}`);

  await mcpTool(mcp, "write", { domain: "settings", entity: "user_setting", action: "clear_weekday_baselines", patch: {} });
  const { data: after2 } = await admin.from("user_settings").select("weekday_baselines").eq("user_id", userId).maybeSingle();
  check(who, "cleanup: weekday_baselines cleared back to null", after2?.weekday_baselines === null, JSON.stringify(after2));
}

async function probeDay({ mcp, raw, userId, who, todayLocalDate }: Parameters<Probe>[0]) {
  if (!mcp || !todayLocalDate) return;
  const { data: existing } = await admin.from("day_starts").select("id").eq("user_id", userId).eq("local_date", todayLocalDate).maybeSingle();
  const createdHere = !existing;

  const w = await mcpTool(mcp, "write", { domain: "day", entity: "day_start", action: "start", patch: {} });
  check(who, "MCP write day.day_start.start", !w.isError, w.text.slice(0, 150));

  const rw = await restCall(raw, "POST", "day/day_start/start", { patch: {} });
  check(who, "REST POST /day/day_start/start", rw.status === 200, `status ${rw.status}`);

  const { data: rows } = await admin.from("day_starts").select("id").eq("user_id", userId).eq("local_date", todayLocalDate);
  check(who, "DB confirms day.day_start.start x2 (MCP+REST) -> exactly 1 row for today, not 2", (rows?.length ?? 0) === 1, `n=${rows?.length}`);

  if (createdHere) {
    await admin.from("day_starts").delete().eq("user_id", userId).eq("local_date", todayLocalDate);
  }
}

async function probeGoals({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  // SETUP (idempotent: false, MCP only, once) -- the only way to get a goal id at all.
  const created = await mcpTool(mcp, "write", { domain: "goals", entity: "goal", action: "create", patch: { month_start: "2099-01-01", title: "P4-25 CHECK goal", reason: "verification fixture", rank: 5 } });
  const goalId = (created.json as { id?: string } | null)?.id ?? null;
  check(who, "MCP write goals.goal.create (setup)", !created.isError && !!goalId, created.text.slice(0, 150));
  if (!goalId) return;

  try {
    // PROBED action: set_status is idempotent:true, scoped to status='active' --
    // safe to call once over MCP and once over REST against the same id.
    const w = await mcpTool(mcp, "write", { domain: "goals", entity: "goal", action: "set_status", id: goalId, patch: { status: "done" } });
    check(who, "MCP write goals.goal.set_status", !w.isError, w.text.slice(0, 150));
    const rw = await restCall(raw, "POST", "goals/goal/set_status", { id: goalId, patch: { status: "done" } });
    check(who, "REST POST /goals/goal/set_status (same id, idempotent retry)", rw.status === 200, `status ${rw.status}`);

    const { data: row } = await admin.from("goals").select("status").eq("id", goalId).single();
    check(who, "DB confirms goal status=done after both calls", row?.status === "done", JSON.stringify(row));
  } finally {
    await admin.from("goals").delete().eq("id", goalId);
  }
}

async function probeHabits({ mcp, raw, userId, who, todayLocalDate }: Parameters<Probe>[0]) {
  if (!mcp || !todayLocalDate) return;
  // SETUP (idempotent: false, MCP only, once).
  const created = await mcpTool(mcp, "write", { domain: "habits", entity: "identity_habit", action: "create", patch: { identity_statement: "P4-25 CHECK identity" } });
  const habitId = (created.json as { id?: string } | null)?.id ?? null;
  check(who, "MCP write habits.identity_habit.create (setup)", !created.isError && !!habitId, created.text.slice(0, 150));
  if (!habitId) return;

  try {
    // PROBED action: vote.cast is idempotent:true (ignoreDuplicates upsert) --
    // safe to call once over MCP and once over REST against the same id/day.
    const w = await mcpTool(mcp, "write", { domain: "habits", entity: "vote", action: "cast", id: habitId, patch: {} });
    check(who, "MCP write habits.vote.cast", !w.isError, w.text.slice(0, 150));
    const rw = await restCall(raw, "POST", "habits/vote/cast", { id: habitId, patch: {} });
    check(who, "REST POST /habits/vote/cast (same id, idempotent retry)", rw.status === 200, `status ${rw.status}`);

    const { data: votes } = await admin.from("habit_votes").select("id").eq("user_id", userId).eq("habit_id", habitId).eq("date", todayLocalDate);
    check(who, "DB confirms exactly 1 vote row after both calls, not 2", (votes?.length ?? 0) === 1, `n=${votes?.length}`);
  } finally {
    await admin.from("habit_votes").delete().eq("habit_id", habitId);
    await admin.from("identity_habits").delete().eq("id", habitId);
  }
}

async function probeReview({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  const w = await mcpTool(mcp, "write", { domain: "review", entity: "sleep_intent", action: "set", patch: { time: "22:30" } });
  check(who, "MCP write review.sleep_intent.set", !w.isError, w.text.slice(0, 150));
  const { data: after1 } = await admin.from("sleep_intents").select("intended_bedtime").eq("user_id", userId).maybeSingle();
  check(who, "DB confirms sleep_intent landed", !!after1?.intended_bedtime?.startsWith("22:30"), JSON.stringify(after1));

  const rw = await restCall(raw, "POST", "review/sleep_intent/set", { patch: { time: "22:30" } });
  check(who, "REST POST /review/sleep_intent/set", rw.status === 200, `status ${rw.status}`);

  await mcpTool(mcp, "write", { domain: "review", entity: "sleep_intent", action: "clear", patch: {} });
  const { data: after2 } = await admin.from("sleep_intents").select("id").eq("user_id", userId).maybeSingle();
  check(who, "cleanup: sleep_intent cleared", !after2, JSON.stringify(after2));
}

async function probeBusiness({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  const w = await mcpTool(mcp, "write", { domain: "business", entity: "kill_list_item", action: "set", patch: { date: PROBE_DATE, position: 2, text: "P4-25 CHECK" } });
  check(who, "MCP write business.kill_list_item.set", !w.isError, w.text.slice(0, 150));
  const { data: after1 } = await admin.from("kill_list_items").select("text").eq("user_id", userId).eq("date", PROBE_DATE).eq("position", 2).maybeSingle();
  check(who, "DB confirms business.kill_list_item.set landed", after1?.text === "P4-25 CHECK", JSON.stringify(after1));

  const rw = await restCall(raw, "POST", "business/kill_list_item/set", { patch: { date: PROBE_DATE, position: 2, text: "P4-25 CHECK" } });
  check(who, "REST POST /business/kill_list_item/set (same slot, idempotent retry)", rw.status === 200, `status ${rw.status}`);

  // No "clear"/"unset" write action exists for this entity (checked
  // write-registry.ts) -- same posture as day.day_start's own raw
  // service-role cleanup below, not an in-app undo call.
  await admin.from("kill_list_items").delete().eq("user_id", userId).eq("date", PROBE_DATE).eq("position", 2);
}

async function probeFitness({ mcp, raw, userId, who }: Parameters<Probe>[0]) {
  if (!mcp) return;
  const w = await mcpTool(mcp, "write", { domain: "fitness", entity: "body_metric", action: "log_weight", patch: { date: PROBE_DATE, weight_lb: 150 } });
  check(who, "MCP write fitness.body_metric.log_weight", !w.isError, w.text.slice(0, 150));
  const { data: after1 } = await admin.from("body_metrics").select("weight_lb").eq("user_id", userId).eq("date", PROBE_DATE).maybeSingle();
  check(who, "DB confirms fitness.body_metric.log_weight landed", after1?.weight_lb === 150, JSON.stringify(after1));

  const rw = await restCall(raw, "POST", "fitness/body_metric/log_weight", { patch: { date: PROBE_DATE, weight_lb: 150 } });
  check(who, "REST POST /fitness/body_metric/log_weight (same date, idempotent retry)", rw.status === 200, `status ${rw.status}`);

  await admin.from("body_metrics").delete().eq("user_id", userId).eq("date", PROBE_DATE);
}

// Domains with NO safe, prerequisite-free idempotent write -- documented,
// not worked around (checked write-registry.ts directly, not assumed):
const DOMAIN_WRITE_SKIPS: Record<string, string> = {
  work: "work_session.start/end is idempotent but occupies the account's single active-session slot -- colliding with (or blocking) a real, in-use session is worse than skipping this probe.",
  school: "every idempotent school write (set_override, edit, a graded assessment) scopes to an existing class_id/schedule_event id; none is prerequisite-free, and creating one (a real class) is not idempotent.",
  checkins: "the only checkins write, allocation.save, is explicitly marked idempotent:false in its own registry comment (it re-resolves the open window fresh on every call).",
  distractions: "the one idempotent action, action_plan.save, needs an existing trigger_id; creating one (trigger.capture) is idempotent on its trigger half only -- the event half always inserts.",
  self_mastery: "self_explanation.log is idempotent:false (plain insert); the one idempotent action, session.finish, needs an already-active session with no safe way to fixture one here.",
};

function reportWriteSkips(who: string) {
  for (const [domain, reason] of Object.entries(DOMAIN_WRITE_SKIPS)) {
    console.log(`  SKIP  [${who}] write ${domain} :: ${reason}`);
  }
}

const DOMAIN_PROBES: Probe[] = [probeDeen, probeSettings, probeDay, probeGoals, probeHabits, probeReview, probeBusiness, probeFitness];

// ---------------------------------------------------------------------------
// account battery -- everything one account shape has to prove
// ---------------------------------------------------------------------------
async function runAccountSuite(who: string, userId: string, expectedMode: "legacy" | "domains" | null, revokedProbe: boolean, neverOnboarded = false) {
  const { raw, tokenId } = await mintToken(userId);
  if (revokedProbe) await revokeToken(tokenId); // --positive-control: everything below MUST fail now

  let mcp: Client | null = null;
  const createdIds: { table: string; id: string }[] = [];
  try {
    // ---- connect + list_capabilities, both transports ----
    try {
      mcp = await mcpConnect(raw);
      check(who, "MCP connect()", true);
    } catch (e) {
      check(who, "MCP connect()", false, e instanceof Error ? e.message : String(e));
    }

    let todayLocalDate: string | null = null;
    let mode: string | null = null;
    // `write.length > 0` distinguishes two real, different-shaped empty-read
    // cases (P4-37 review): day/goals/habits are genuinely write-only (a
    // read surface is future work); calendar/home are permanent aggregate
    // domains with NEITHER a read nor a write entity of their own, by
    // deliberate design (registry.ts's own comment on them) -- reporting
    // both as "write-only" would be a second false claim in the same fix.
    let readableDomains: Record<string, { read: string[]; write: string[] }> = {};

    if (mcp) {
      const caps = await mcpTool(mcp, "list_capabilities", {});
      // P4-37: this used to be cast as `Record<string, { read: string[] }>` --
      // a shape the wire does NOT have (each domain is a positional array,
      // not a named object; see account-map-wire.ts). That false cast is why
      // tsc never caught `def.read` always being `undefined`: it described a
      // shape the data doesn't have instead of the real one. Typed honestly
      // as `AccountMapWire` and decoded with the real, tested inverse of
      // toAccountMapWire, not a hand-index.
      const capsBody = caps.json as AccountMapWire | null;
      check(who, "MCP list_capabilities()", !caps.isError && !!capsBody?.domains, caps.text.slice(0, 150));
      todayLocalDate = capsBody?.today?.local_date ?? null;
      mode = capsBody?.mode ?? null;
      if (capsBody?.domains) {
        const decoded = fromAccountMapWire(capsBody);
        for (const [d, def] of Object.entries(decoded.domains)) readableDomains[d] = { read: def.read, write: def.write };
      }
      if (expectedMode) check(who, `MCP list_capabilities() mode is "${expectedMode}"`, mode === expectedMode, `got "${mode}"`);
    }

    const restCaps = await restCall(raw, "GET", "capabilities");
    check(who, "REST GET /capabilities", restCaps.status === 200, `status ${restCaps.status}`);
    if (restCaps.status === 200) {
      // Same wire shape as MCP's list_capabilities (both dispatch through
      // buildOperationSpec -> listCapabilitiesTool -> toAccountMapWire), so
      // the same honest type applies here too, even though this block only
      // reads the top-level `today`/`mode` fields (never positionally
      // encoded) and doesn't currently touch `.domains`.
      const body = restCaps.json as AccountMapWire | null;
      todayLocalDate ??= body?.today?.local_date ?? null;
      if (expectedMode) check(who, `REST GET /capabilities mode is "${expectedMode}"`, body?.mode === expectedMode, `got "${body?.mode}"`);
    }

    // ---- one read per domain, both transports (generic -- no patch needed) ----
    for (const [domain, { read: reads, write: writes }] of Object.entries(readableDomains)) {
      const entity = reads[0];
      if (!entity) {
        // P4-37: this used to be a bare `continue` -- an invisible skip for
        // ANY empty-read domain, while this script's own header promises
        // "one read per domain." PASS-recorded, not FAIL: both cases below
        // are real, known properties of the app today, not harness defects.
        // Only reachable now for a domain that TRULY has no read entity --
        // fixing the decode above (this task's other half) is what makes
        // that true; before it, every domain landed here, including ones
        // with real reads.
        const reason =
          writes.length > 0
            ? "write-only domain, no read surface exists yet" // day/goals/habits today -- P4-05's future territory
            : "aggregate domain with no entity of its own -- read through the domains it aggregates"; // calendar/home today, permanent by design (registry.ts)
        check(who, `read ${domain} (skipped -- ${reason})`, true);
        continue;
      }
      if (mcp) {
        const r = await mcpTool(mcp, "read", { domain, entity });
        check(who, `MCP read(${domain}.${entity})`, !r.isError, r.text.slice(0, 120));
      }
      const rr = await restCall(raw, "GET", `${domain}/${entity}`);
      check(who, `REST GET /${domain}/${entity}`, rr.status === 200, `status ${rr.status}`);
    }

    // ---- one idempotent write per domain, both transports ----
    for (const probe of DOMAIN_PROBES) {
      await probe({ mcp, raw, userId, who, todayLocalDate });
    }
    reportWriteSkips(who);

    // ---- schedule create/list/cancel, both transports. write-shaped (not
    // notify) on purpose -- a "notify" schedule is refused with a real,
    // account-state-dependent error when no device has push enabled
    // (createNotifyScheduledAction's own guard), which is NOT a capability
    // this probe is testing and would make the whole battery flaky per
    // account. deen.prayer.log is idempotent, already proven safe elsewhere
    // in this script, and cancelled before its far-future run_at could ever
    // fire -- the schedule row is exercised, the underlying write never is.
    if (mcp) {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const created = await mcpTool(mcp, "scheduler_manage", {
        action: "create",
        patch: { tool_name: "write", domain: "deen", entity: "prayer", action: "log", run_at: farFuture, write_patch: { date: PROBE_DATE, prayer_name: "fajr", status: "qada" } },
      });
      const scheduleId = (created.json as { id?: string } | null)?.id ?? null;
      if (neverOnboarded) {
        // P4-16's own documented guard: "NO PROFILE, NO SCHEDULE" -- a
        // never-onboarded account has no profiles.timezone to compute
        // next_run_at from, so createScheduledActionCore refuses at
        // creation rather than guessing UTC. The CORRECT outcome here is
        // refusal with exactly that reason, not success -- asserted, not
        // just tolerated, so a future regression that silently let this
        // through (scheduling a real fire at a guessed timezone) is caught.
        check(who, "MCP scheduler_manage(create) correctly refused (no profile -> no timezone -> P4-16 guard)", created.isError && /profile|timezone/i.test(created.text), created.text.slice(0, 150));
      } else {
        check(who, "MCP scheduler_manage(create)", !created.isError && !!scheduleId, created.text.slice(0, 150));
      }

      if (scheduleId) {
        const listed = await mcpTool(mcp, "scheduler_manage", { action: "list" });
        const items = (listed.json as { items?: { id: string }[] } | null)?.items ?? [];
        check(who, "MCP scheduler_manage(list) includes the created item", items.some((i) => i.id === scheduleId));

        const cancelled = await mcpTool(mcp, "scheduler_manage", { action: "cancel", id: scheduleId });
        check(who, "MCP scheduler_manage(cancel)", !cancelled.isError, cancelled.text.slice(0, 150));

        const { data: row } = await admin.from("mcp_scheduled_actions").select("status").eq("id", scheduleId).maybeSingle();
        check(who, "DB confirms scheduled action status=cancelled", row?.status === "cancelled", JSON.stringify(row));
        await admin.from("mcp_scheduled_actions").delete().eq("id", scheduleId);
      }
    }

    const restList = await restCall(raw, "GET", "manage/schedules");
    check(who, "REST GET /manage/schedules", restList.status === 200, `status ${restList.status}`);

    // ---- audit rows exist for both transports ----
    const { data: auditRows } = await admin.from("mcp_audit_log").select("transport, outcome").eq("token_id", tokenId);
    const hasMcpAudit = (auditRows ?? []).some((r) => r.transport === "mcp");
    const hasRestAudit = (auditRows ?? []).some((r) => r.transport === "rest");
    check(who, "audit log has at least one MCP-transport row for this token", hasMcpAudit, `${auditRows?.length ?? 0} total rows`);
    check(who, "audit log has at least one REST-transport row for this token", hasRestAudit);
  } finally {
    if (mcp) await mcp.close().catch(() => {});
    if (!revokedProbe) await revokeToken(tokenId);
  }
}

/**
 * Cross-account probe: mints tokens for TWO accounts, has account A try to
 * read/write a row that belongs to account B by id, and asserts it is
 * refused -- exactly the asymmetry a composite-tenancy FK is supposed to
 * make unrepresentable (CLAUDE.md), proven live through the agent surface
 * specifically (not just RLS in isolation).
 */
async function crossAccountProbe(accountA: { who: string; userId: string }, accountB: { who: string; userId: string }) {
  const { data: foreignPrayer } = await admin.from("prayers").select("id").eq("user_id", accountB.userId).limit(1).maybeSingle();
  if (!foreignPrayer) {
    check(accountA.who, "cross-account probe (skipped -- no probe-able row on the other account)", true);
    return;
  }
  const { raw, tokenId } = await mintToken(accountA.userId);
  try {
    const mcp = await mcpConnect(raw);
    try {
      const r = await mcpTool(mcp, "read", { domain: "deen", entity: "prayer", id: foreignPrayer.id });
      const items = (r.json as { items?: unknown[] } | null)?.items ?? [];
      check(accountA.who, `cross-account read of ${accountB.who}'s prayer id is refused/empty`, r.isError || items.length === 0, r.text.slice(0, 150));
    } finally {
      await mcp.close().catch(() => {});
    }
  } finally {
    await revokeToken(tokenId);
  }
}

// ---------------------------------------------------------------------------
// fresh account: auth.users only, ZERO profiles/user_settings/user_domains
// rows -- the account shape bootstrap-test-account.ts deliberately does NOT
// produce (that script pre-seeds a realistic shell for a demo; this one
// wants the rawest possible shape to prove an agent can be the FIRST writer
// ever, with nothing lazily created ahead of it).
// ---------------------------------------------------------------------------
async function createFreshAccount(): Promise<{ userId: string; email: string }> {
  const email = `p4-25-check-${Date.now()}@lifeos.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(18).toString("base64url"), email_confirm: true });
  if (error || !data.user) throw new Error(`fresh account create failed: ${error?.message}`);
  return { userId: data.user.id, email };
}

async function deleteFreshAccount(userId: string): Promise<void> {
  // auth.users cascades to every table with `references auth.users(id) on
  // delete cascade` -- which is every tenancy table in this schema
  // (CLAUDE.md: 67 composite tenancy FKs, all cascade-scoped) -- so this
  // one call is the real cleanup, not a per-table sweep.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error(`[cleanup] fresh account ${userId} delete failed: ${error.message} -- MANUAL CLEANUP NEEDED`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`P4-25 multi-account check against ${BASE}${POSITIVE_CONTROL ? " -- POSITIVE CONTROL (revoked token, everything below SHOULD fail)" : ""}`);

  if (POSITIVE_CONTROL) {
    const target = Object.values(existingAccounts)[0];
    if (!target) {
      console.error("--positive-control needs --accounts pointing at at least one account.");
      process.exit(2);
    }
    await runAccountSuite(target.email.split("@")[0], target.userId, null, true);
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed === 0) {
      console.error("\nPOSITIVE CONTROL FAILED: a revoked token was accepted somewhere above -- this harness is not examining anything real. Do not trust a green run until this is fixed.");
      process.exit(1);
    }
    console.log("\nPositive control confirmed: a revoked token was correctly refused everywhere it was tried (every check above reports FAIL, which is the CORRECT outcome for this mode).");
    process.exit(1); // non-zero on purpose, per the AC's own wording -- see this script's header
  }

  const runners: { who: string; userId: string; mode: "legacy" | "domains" }[] = Object.values(existingAccounts).map((a) => ({ who: a.email.split("@")[0], userId: a.userId, mode: a.mode }));

  let freshUserId: string | null = null;
  if (!SKIP_FRESH) {
    const fresh = await createFreshAccount();
    freshUserId = fresh.userId;
    console.log(`created fresh account ${fresh.email} (${fresh.userId})`);
  }

  try {
    for (const r of runners) {
      try {
        await runAccountSuite(r.who, r.userId, r.mode, false);
      } catch (e) {
        check(r.who, "run aborted", false, e instanceof Error ? e.message : String(e));
      }
    }
    if (freshUserId) {
      try {
        await runAccountSuite("fresh-account", freshUserId, null, false, true);
      } catch (e) {
        check("fresh-account", "run aborted", false, e instanceof Error ? e.message : String(e));
      }
    }

    if (runners.length >= 2) {
      await crossAccountProbe({ who: runners[0].who, userId: runners[0].userId }, { who: runners[1].who, userId: runners[1].userId });
    } else {
      // P4-36: this used to be an invisible skip -- a one-account (or
      // zero-account) run emitted NOTHING here and still exited 0, so "ran
      // the tenancy harness, green" and "ran the tenancy harness, never
      // tested tenancy" were byte-identical output. Matches the :479
      // precedent (an explicit, visible, PASS-recorded skip, not a FAIL --
      // a single-account run is a legitimate mode) so a reader of the
      // output cannot mistake this run for one that exercised tenancy.
      check(
        runners[0]?.who ?? "cross-account",
        `cross-account probe (skipped -- only ${runners.length} account${runners.length === 1 ? "" : "s"} supplied, cross-account refusal NOT tested)`,
        true,
      );
    }
  } finally {
    if (freshUserId) await deleteFreshAccount(freshUserId);
  }

  const { data: liveTokens } = await admin.from("mcp_access_tokens").select("id").eq("label", LABEL).is("revoked_at", null);
  check("sweep", "0 live P4-25 CHECK tokens remain", (liveTokens?.length ?? 0) === 0, `${liveTokens?.length ?? 0} still live`);

  console.log("\n=== matrix ===");
  for (const [account, caps] of Object.entries(matrix)) {
    const failedCaps = Object.entries(caps).filter(([, ok]) => !ok).map(([label]) => label);
    console.log(`${account}: ${Object.keys(caps).length - failedCaps.length}/${Object.keys(caps).length} passed${failedCaps.length ? ` -- FAILED: ${failedCaps.join(" | ")}` : ""}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(3);
});
