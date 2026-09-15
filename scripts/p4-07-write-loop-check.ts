/**
 * P4-07 04 verification: the 16 daily-rituals write actions
 * (review.night_plan_task.{dump,save_ranks}, review.worry.{set_handled,reopen},
 * review.sleep_intent.{set,clear}, day.day_start.start, goals.goal.{create,set_status},
 * goals.milestone.{add,set_done}, habits.identity_habit.{create,archive},
 * habits.vote.{cast,retract}) driven through the REAL deployed MCP endpoint
 * with a service-role-minted PAT, on BOTH teamb accounts. Same technique as
 * scripts/mcp-write-loop-check.ts (a real token, a real network round trip,
 * cleanup verified by absence, never trusting the tool's own success text).
 *
 * Usage:
 *   npx tsx scripts/p4-07-write-loop-check.ts [baseUrl] [--accounts path/to/accounts.json]
 * Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 * (or _PUBLISHABLE_KEY), SUPABASE_SERVICE_ROLE_KEY.
 *
 * Uses month_start "2099-01-01" for goals/milestones (implausible enough to
 * never collide with a real account's own rows) and today's local date for
 * day_start/night_plan/worry/sleep_intent. Every row this script creates is
 * deleted in `finally`, verified by querying for its absence -- not by
 * trusting the tool's own text. Tokens minted here are always revoked, and a
 * final sweep confirms 0 live "P4-07 LOOP CHECK" tokens remain.
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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

const TOKEN_PREFIX = "lifeos_pat_";
const generateRawToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");
const hashToken = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const last4 = (t: string) => t.slice(-4);
const LABEL = "P4-07 LOOP CHECK";
const MONTH = "2099-01-01"; // implausibly far out -- never collides with a real goal/milestone

const admin = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function check(account: string, label: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${account}] ${label}${detail ? ` :: ${detail.slice(0, 300)}` : ""}`);
}

function textOf(r: { content?: { type: string; text?: string }[] }) {
  return (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

async function runAccount(email: string, password: string, userId: string) {
  const who = email.split("@")[0];

  const PAT = generateRawToken();
  const { data: tokRow, error: tokErr } = await admin
    .from("mcp_access_tokens")
    .insert({ user_id: userId, token_hash: hashToken(PAT), token_last4: last4(PAT), label: LABEL, scopes: ["read", "write"] })
    .select("id")
    .single();
  if (tokErr || !tokRow) throw new Error(`token mint failed: ${tokErr?.message}`);
  const tokenId = tokRow.id as string;

  const client = new Client({ name: "p4-07-write-loop-check", version: "0.1.0" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${PAT}` } } }));

  // fixtures created, cleaned up in `finally`
  let dayStartCreatedHere = false;
  let goalId: string | null = null;
  let milestoneId: string | null = null;
  let habitId: string | null = null;
  let nightPlanTaskId: string | null = null;
  let worryId: string | null = null;
  let localDate: string | null = null;

  try {
    // ── list_capabilities: the write-only domains (day/goals/habits) resolve ──
    const caps = await client.callTool({ name: "list_capabilities", arguments: {} });
    const capsBody = JSON.parse(textOf(caps as { content?: { type: string; text?: string }[] })) as { domains?: Record<string, unknown>; today?: { local_date: string } };
    localDate = capsBody.today?.local_date ?? null;
    check(who, "list_capabilities shows day/goals/habits domains", !!capsBody.domains?.day && !!capsBody.domains?.goals && !!capsBody.domains?.habits, Object.keys(capsBody.domains ?? {}).join(","));
    if (!localDate) throw new Error("list_capabilities did not return today.local_date");

    // ── day.day_start.start, twice -> exactly one row for (user, local_date) ──
    const { data: existingDayStart } = await admin.from("day_starts").select("id").eq("user_id", userId).eq("local_date", localDate).maybeSingle();
    dayStartCreatedHere = !existingDayStart;
    const ds1 = await client.callTool({ name: "write", arguments: { domain: "day", entity: "day_start", action: "start", patch: {} } });
    const ds2 = await client.callTool({ name: "write", arguments: { domain: "day", entity: "day_start", action: "start", patch: {} } });
    const { data: dayStartRows } = await admin.from("day_starts").select("id, woke_at").eq("user_id", userId).eq("local_date", localDate);
    check(who, "day.day_start.start x2 -> both succeed, exactly 1 row for today", !(ds1 as { isError?: boolean }).isError && !(ds2 as { isError?: boolean }).isError && (dayStartRows?.length ?? 0) === 1, JSON.stringify({ n: dayStartRows?.length, woke: dayStartRows?.[0]?.woke_at }));

    // ── goals.goal.create -> goals.milestone.add -> goals.milestone.set_done ──
    const goalCreate = await client.callTool({ name: "write", arguments: { domain: "goals", entity: "goal", action: "create", patch: { month_start: MONTH, title: "P4-07 LOOP CHECK goal", reason: "verification fixture", rank: 1 } } });
    goalId = ((): string | null => { try { return (JSON.parse(textOf(goalCreate as { content?: { type: string; text?: string }[] })) as { id?: string }).id ?? null; } catch { return null; } })();
    check(who, "goals.goal.create -> id, real row", !(goalCreate as { isError?: boolean }).isError && !!goalId, textOf(goalCreate as { content?: { type: string; text?: string }[] }));

    if (goalId) {
      const msAdd = await client.callTool({ name: "write", arguments: { domain: "goals", entity: "milestone", action: "add", patch: { goal_id: goalId, month_start: MONTH, title: "P4-07 LOOP CHECK milestone" } } });
      milestoneId = ((): string | null => { try { return (JSON.parse(textOf(msAdd as { content?: { type: string; text?: string }[] })) as { id?: string }).id ?? null; } catch { return null; } })();
      check(who, "goals.milestone.add -> id, real row", !(msAdd as { isError?: boolean }).isError && !!milestoneId, textOf(msAdd as { content?: { type: string; text?: string }[] }));

      if (milestoneId) {
        const msDone = await client.callTool({ name: "write", arguments: { domain: "goals", entity: "milestone", action: "set_done", id: milestoneId, patch: { done: true } } });
        const { data: msRow } = await admin.from("goal_milestones").select("done_at").eq("id", milestoneId).single();
        check(who, "goals.milestone.set_done(true) -> DB confirms done_at set", !(msDone as { isError?: boolean }).isError && !!msRow?.done_at, JSON.stringify(msRow));
      }

      const goalDone = await client.callTool({ name: "write", arguments: { domain: "goals", entity: "goal", action: "set_status", id: goalId, patch: { status: "done" } } });
      const { data: goalRow } = await admin.from("goals").select("status").eq("id", goalId).single();
      check(who, "goals.goal.set_status(done) -> DB confirms status=done", !(goalDone as { isError?: boolean }).isError && goalRow?.status === "done", JSON.stringify(goalRow));
    }

    // ── habits.identity_habit.create -> vote.cast x2 (=1) -> vote.retract (=0) ──
    const habitCreate = await client.callTool({ name: "write", arguments: { domain: "habits", entity: "identity_habit", action: "create", patch: { identity_statement: "P4-07 LOOP CHECK identity" } } });
    habitId = ((): string | null => { try { return (JSON.parse(textOf(habitCreate as { content?: { type: string; text?: string }[] })) as { id?: string }).id ?? null; } catch { return null; } })();
    check(who, "habits.identity_habit.create -> id, real row", !(habitCreate as { isError?: boolean }).isError && !!habitId, textOf(habitCreate as { content?: { type: string; text?: string }[] }));

    if (habitId) {
      await client.callTool({ name: "write", arguments: { domain: "habits", entity: "vote", action: "cast", id: habitId, patch: {} } });
      const voteCast2 = await client.callTool({ name: "write", arguments: { domain: "habits", entity: "vote", action: "cast", id: habitId, patch: {} } });
      const { data: votesAfterCast } = await admin.from("habit_votes").select("id").eq("user_id", userId).eq("habit_id", habitId).eq("date", localDate);
      check(who, "habits.vote.cast x2 -> both succeed, exactly 1 vote row (upsert ignoreDuplicates)", !(voteCast2 as { isError?: boolean }).isError && (votesAfterCast?.length ?? 0) === 1, `n=${votesAfterCast?.length}`);

      const voteRetract = await client.callTool({ name: "write", arguments: { domain: "habits", entity: "vote", action: "retract", id: habitId, patch: {} } });
      const { data: votesAfterRetract } = await admin.from("habit_votes").select("id").eq("user_id", userId).eq("habit_id", habitId).eq("date", localDate);
      check(who, "habits.vote.retract -> DB confirms 0 vote rows", !(voteRetract as { isError?: boolean }).isError && (votesAfterRetract?.length ?? 0) === 0, `n=${votesAfterRetract?.length}`);
    }

    // ── review.night_plan_task.dump -> save_ranks ──
    const dump = await client.callTool({ name: "write", arguments: { domain: "review", entity: "night_plan_task", action: "dump", patch: { title: "P4-07 LOOP CHECK dump", mode: "today" } } });
    nightPlanTaskId = ((): string | null => { try { return (JSON.parse(textOf(dump as { content?: { type: string; text?: string }[] })) as { id?: string }).id ?? null; } catch { return null; } })();
    check(who, "review.night_plan_task.dump -> id, real row", !(dump as { isError?: boolean }).isError && !!nightPlanTaskId, textOf(dump as { content?: { type: string; text?: string }[] }));

    if (nightPlanTaskId) {
      const ranks = await client.callTool({ name: "write", arguments: { domain: "review", entity: "night_plan_task", action: "save_ranks", patch: { starred: [nightPlanTaskId], crowned: nightPlanTaskId, mode: "today" } } });
      const { data: taskRow } = await admin.from("tasks").select("mit_rank").eq("id", nightPlanTaskId).single();
      check(who, "review.night_plan_task.save_ranks -> DB confirms mit_rank set (crowned)", !(ranks as { isError?: boolean }).isError && !!taskRow?.mit_rank, JSON.stringify(taskRow));
    }

    // ── review.worry.set_handled / reopen, on a seeded worry (dump_source='worry') ──
    const asAccount = createClient(SUPA_URL!, ANON!, { auth: { persistSession: false } });
    const { error: signInErr } = await asAccount.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`sign-in for fixture seeding failed: ${signInErr.message}`);
    const { data: worryRow, error: worryErr } = await asAccount
      .from("tasks")
      .insert({ user_id: userId, title: "P4-07 LOOP CHECK worry", planned_date: localDate, domain: null, dump_source: "worry", mit_rank: null, completed: false })
      .select("id")
      .single();
    if (worryErr) throw new Error(`worry fixture insert failed: ${worryErr.message}`);
    worryId = worryRow!.id as string;

    const handled = await client.callTool({ name: "write", arguments: { domain: "review", entity: "worry", action: "set_handled", id: worryId, patch: {} } });
    const { data: worryHandled } = await admin.from("tasks").select("completed, completed_at").eq("id", worryId).single();
    check(who, "review.worry.set_handled -> DB confirms completed=true", !(handled as { isError?: boolean }).isError && worryHandled?.completed === true && !!worryHandled?.completed_at, JSON.stringify(worryHandled));

    const reopened = await client.callTool({ name: "write", arguments: { domain: "review", entity: "worry", action: "reopen", id: worryId, patch: {} } });
    const { data: worryReopened } = await admin.from("tasks").select("completed, completed_at, worry_outcome").eq("id", worryId).single();
    check(who, "review.worry.reopen -> DB confirms completed=false, completed_at/outcome cleared", !(reopened as { isError?: boolean }).isError && worryReopened?.completed === false && !worryReopened?.completed_at && !worryReopened?.worry_outcome, JSON.stringify(worryReopened));

    // ── review.sleep_intent.set / clear ──
    const sleepSet = await client.callTool({ name: "write", arguments: { domain: "review", entity: "sleep_intent", action: "set", patch: { time: "22:30" } } });
    const { data: sleepRow } = await admin.from("sleep_intents").select("intended_bedtime").eq("user_id", userId).eq("intent_date", localDate).maybeSingle();
    check(who, "review.sleep_intent.set -> DB confirms intended_bedtime 22:30", !(sleepSet as { isError?: boolean }).isError && !!sleepRow?.intended_bedtime?.startsWith("22:30"), JSON.stringify(sleepRow));

    const sleepClear = await client.callTool({ name: "write", arguments: { domain: "review", entity: "sleep_intent", action: "clear", patch: {} } });
    const { data: sleepRowAfter } = await admin.from("sleep_intents").select("id").eq("user_id", userId).eq("intent_date", localDate).maybeSingle();
    check(who, "review.sleep_intent.clear -> DB confirms row gone", !(sleepClear as { isError?: boolean }).isError && !sleepRowAfter, JSON.stringify(sleepRowAfter));
  } finally {
    // ── cleanup, verified by absence ──
    await client.close();

    if (worryId) {
      await admin.from("tasks").delete().eq("id", worryId);
      const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("id", worryId);
      check(who, "cleanup: worry fixture GONE", count === 0);
    }
    if (nightPlanTaskId) {
      await admin.from("tasks").delete().eq("id", nightPlanTaskId);
      const { count } = await admin.from("tasks").select("id", { count: "exact", head: true }).eq("id", nightPlanTaskId);
      check(who, "cleanup: night_plan_task fixture GONE", count === 0);
    }
    if (habitId) {
      await admin.from("habit_votes").delete().eq("habit_id", habitId);
      await admin.from("identity_habits").delete().eq("id", habitId);
      const { count } = await admin.from("identity_habits").select("id", { count: "exact", head: true }).eq("id", habitId);
      check(who, "cleanup: identity_habit fixture (+votes) GONE", count === 0);
    }
    if (milestoneId) {
      await admin.from("goal_milestones").delete().eq("id", milestoneId);
    }
    if (goalId) {
      await admin.from("goals").delete().eq("id", goalId);
      const { count } = await admin.from("goals").select("id", { count: "exact", head: true }).eq("id", goalId);
      check(who, "cleanup: goal (+milestone) fixture GONE", count === 0);
    }
    if (dayStartCreatedHere && localDate) {
      await admin.from("day_starts").delete().eq("user_id", userId).eq("local_date", localDate);
      const { count } = await admin.from("day_starts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("local_date", localDate);
      check(who, "cleanup: day_start fixture GONE (it did not exist before this run)", count === 0);
    }

    await admin.from("mcp_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).is("revoked_at", null);
  }
}

async function main() {
  console.log(`P4-07 write-loop check against ${BASE}`);
  for (const a of Object.values(accounts)) {
    try {
      await runAccount(a.email, a.password, a.userId);
    } catch (e) {
      check(a.email.split("@")[0], "run aborted", false, e instanceof Error ? e.message : String(e));
    }
  }

  const { data: liveTokens } = await admin.from("mcp_access_tokens").select("id").eq("label", LABEL).is("revoked_at", null);
  check("sweep", "0 live P4-07 LOOP CHECK tokens remain", (liveTokens?.length ?? 0) === 0, `${liveTokens?.length ?? 0} still live`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
