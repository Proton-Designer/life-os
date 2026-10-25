/**
 * PHASE 1 -- RESUMABLE FULL-BOOK INGESTION DRIVER.
 *
 * Drives the real `ingestion_jobs` cursor machinery IN-PROCESS -- the same
 * claim_ingestion_job -> STAGE_HANDLERS[stage] -> bracketStage ->
 * advance_ingestion_cursor sequence app/api/self-mastery/ingestion/step/
 * route.ts uses, called directly instead of over HTTP (no server can stay
 * up between device_bash invocations here). Bounded by an internal
 * wall-clock budget so ONE invocation always finishes well inside the
 * shell's 180s hard cap -- 173 chunks will not fit in one call, so this
 * script is meant to be re-run repeatedly; all state lives in the DB
 * (ingestion_jobs.cursor_chunk_index / cursor_attempt), never in this
 * process, so a fresh invocation resumes exactly where the last one left
 * off with zero extra bookkeeping.
 *
 * BUDGET DISCIPLINE: checks this account's actual spend from `ai_usage_log`
 * (the real queryable record every gatewayChat call writes to) before each
 * claim. HARD_STOP_USD is deliberately far below the $0.50 authorized
 * ceiling and the gateway's own $1.00 default cap -- this script's own
 * stopping point, checked and enforced here, not assumed from either of
 * those upstream guards.
 *
 * Usage: npx tsx scripts/ingest-drive.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { STAGE_HANDLERS } from "../lib/self-mastery/ingestion/worker-stages";
import { bracketStage, describeError } from "../lib/self-mastery/ingestion/telemetry";
import { getDevProviderBaseUrl } from "../lib/ai/dev-provider";

const USER_ID = "d3a4edfb-6ebf-4564-93d9-e5a08fb695b1";
const BOOK_ID = "9094481c-1109-4cfb-a46f-b63c7706d2c1";
const JOB_ID = "d92eb646-ef45-44b4-ade9-94c1dc41c16b";

const WALL_CLOCK_BUDGET_MS = 155_000; // leaves ~25s margin inside the 180s device_bash cap
const HARD_STOP_USD = 0.3; // well below the $0.50 authorization -- this script's own line, checked every step

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`ingest-drive: missing required env var ${name}`);
  return v;
}

async function fetchDeepSeekBalance(apiKey: string): Promise<unknown> {
  const res = await fetch("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return res.json();
}

/**
 * PROVIDER SELECTION, MADE LOUD AND FAIL-FAST -- a real reproducibility trap
 * found in an adversarial verification pass (2026-09-13): `worker-stages.ts`'s
 * `resolveIngestionProvider()` prefers `DevShimProvider` whenever
 * `getDevProviderBaseUrl()` is non-null (NODE_ENV != production AND
 * `SELF_MASTERY_DEV_PROVIDER_URL` is set) -- and that var IS set in
 * `.env.local`, which this script loads unconditionally. A plain
 * `npx tsx scripts/ingest-drive.ts` therefore selects the dev shim by
 * default and fails outright unless `scripts/dev-provider-shim.mjs` happens
 * to be running -- which it never is for a real-book production run, so the
 * one real run that worked only worked because someone manually cleared
 * `SELF_MASTERY_DEV_PROVIDER_URL` for that one invocation, undocumented and
 * unrepeatable. This function makes that choice visible and checked BEFORE
 * any real work (or spend) happens, rather than leaving the next person to
 * discover it via a wall of shim-connection-refused errors partway through
 * a 173-chunk run: it prints which provider will actually be used and why,
 * and when the dev shim would be selected, it probes the shim's port with a
 * short timeout and ABORTS immediately with an actionable message if
 * nothing answers -- this script's whole reason to exist is driving a REAL
 * production book through the REAL DeepSeek-backed gateway, so a
 * dev-shim selection that can't even reach its shim is never something to
 * silently limp through.
 */
async function checkProviderSelection(): Promise<void> {
  const devUrl = getDevProviderBaseUrl();
  if (!devUrl) {
    console.log(`[ingest-drive] PROVIDER: GatewayLlmProvider (real, gateway-routed, spend-capped) -- SELF_MASTERY_DEV_PROVIDER_URL is unset or NODE_ENV=production.`);
    return;
  }

  console.log(`[ingest-drive] PROVIDER: DevShimProvider would be selected -- SELF_MASTERY_DEV_PROVIDER_URL=${devUrl} is set and NODE_ENV != production.`);
  console.log(`[ingest-drive] Probing ${devUrl} for a live dev-provider-shim...`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(devUrl, { signal: controller.signal }).catch((e) => {
      throw e;
    });
    clearTimeout(timeout);
    console.log(`[ingest-drive] Shim answered -- proceeding against DevShimProvider. If a REAL book run was intended, this is the wrong provider: stop now and re-run with SELF_MASTERY_DEV_PROVIDER_URL unset.`);
  } catch {
    console.log(
      [
        "",
        "!!! ABORTING: SELF_MASTERY_DEV_PROVIDER_URL is set but nothing answered at that address. !!!",
        `!!! This run would select DevShimProvider (dev shim) and fail on its first real-model call, exactly the trap that broke the last production run's reproducibility. !!!`,
        "!!! Fix one of the two ways, then re-run: !!!",
        "!!!   (a) driving a REAL book through DeepSeek (the normal case for this script): unset SELF_MASTERY_DEV_PROVIDER_URL in .env.local, or !!!",
        "!!!   (b) actually testing against the dev shim: start it first (node scripts/dev-provider-shim.mjs). !!!",
        "",
      ].join("\n"),
    );
    process.exitCode = 2;
    throw new Error("ingest-drive: provider selection would fail (dev shim unreachable) -- aborted before any real work or spend.");
  }
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const deepseekKey = requireEnv("DEEPSEEK_API_KEY");
  const supabase = createClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  await checkProviderSelection();

  const invocationStart = Date.now();
  console.log(`[ingest-drive] invocation starting ${new Date(invocationStart).toISOString()}`);

  const { data: costRow } = await supabase.from("ai_usage_log").select("cost_usd").eq("user_id", USER_ID);
  const spendBefore = (costRow ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  console.log(`[ingest-drive] cumulative ai_usage_log spend for this account so far: $${spendBefore.toFixed(6)} (hard stop at $${HARD_STOP_USD})`);
  if (spendBefore >= HARD_STOP_USD) {
    console.log(`\n!!! HARD STOP: cumulative spend $${spendBefore.toFixed(6)} already at/over $${HARD_STOP_USD} before this invocation did anything. Stopping. Report to Lead immediately. !!!`);
    process.exitCode = 2;
    return;
  }

  // Self-reclaim our OWN job's lease if it's still held from a previous
  // invocation in this same script's run -- claim_ingestion_job's 6-minute
  // lease exists to recover a job from a CRASHED worker; this script is the
  // only caller that will ever touch JOB_ID (checked below), so a lease
  // left over from the last device_bash call is never a concurrent
  // worker's in-flight claim, only this script's own previous, already-
  // finished process. Scoped to exactly JOB_ID -- never touches any other
  // row in the table.
  const { data: preClaimJob } = await supabase.from("ingestion_jobs").select("stage, leased_until").eq("id", JOB_ID).single();
  if (preClaimJob && preClaimJob.stage !== "done" && preClaimJob.stage !== "failed" && preClaimJob.leased_until) {
    await supabase.from("ingestion_jobs").update({ leased_until: null }).eq("id", JOB_ID);
    console.log(`[ingest-drive] reclaimed this invocation's own job lease (was held until ${preClaimJob.leased_until})`);
  }

  let steps = 0;
  let terminal: "done" | "failed" | "no_more_work" | "budget_exhausted" | "hard_stop" = "budget_exhausted";
  const perStage = new Map<string, { calls: number; failed: number }>();

  while (Date.now() - invocationStart < WALL_CLOCK_BUDGET_MS) {
    const { data: job, error: claimError } = await supabase.rpc("claim_ingestion_job");
    if (claimError) throw new Error(`ingest-drive: claim_ingestion_job failed: ${claimError.message}`);
    if (!job || job.id === null) {
      terminal = "no_more_work";
      break;
    }
    if (job.id !== JOB_ID) {
      // Should never happen (this is the only eligible row in the table),
      // but never silently work on the wrong account's job.
      throw new Error(`ingest-drive: claimed job ${job.id} does not match expected ${JOB_ID} -- refusing to proceed on an unexpected job`);
    }
    if (job.stage === "done" || job.stage === "failed") {
      terminal = job.stage;
      break;
    }

    const handler = STAGE_HANDLERS[job.stage];
    if (!handler) throw new Error(`ingest-drive: no handler for stage "${job.stage}"`);

    const expectedStage = job.stage;
    const expectedChunkIndex = job.cursor_chunk_index;
    const expectedAttempt = job.cursor_attempt;
    const stageKey = expectedStage;
    const tally = perStage.get(stageKey) ?? { calls: 0, failed: 0 };

    let work;
    try {
      work = await bracketStage(
        supabase,
        { jobId: job.id, stage: expectedStage, chunkIndex: expectedChunkIndex, attempt: expectedAttempt },
        () => handler({ job, supabase }),
      );
    } catch (e) {
      tally.failed++;
      perStage.set(stageKey, tally);
      const errorMessage = describeError(e);
      console.log(`[ingest-drive] step ${steps + 1}: ${expectedStage}/${expectedChunkIndex ?? "-"} attempt ${expectedAttempt} FAILED: ${errorMessage}`);
      if (job.cursor_attempt >= job.max_attempts) {
        await supabase
          .from("ingestion_jobs")
          .update({ stage: "failed", last_error: `${expectedStage} (chunk ${expectedChunkIndex}): exhausted ${job.max_attempts} attempts -- last error: ${errorMessage}` })
          .eq("id", job.id);
        console.log(`[ingest-drive] !!! attempts exhausted at ${expectedStage}/${expectedChunkIndex} -- job marked failed. STOPPING. Report this to the Lead. !!!`);
        terminal = "failed";
        steps++;
        break;
      }
      steps++;
      // Same single-actor lease reclaim as the pre-loop check above, so a
      // transient failure (network blip, etc.) can retry within THIS
      // invocation's wall-clock budget instead of sitting idle until the
      // 6-minute lease naturally expires.
      await supabase.from("ingestion_jobs").update({ leased_until: null }).eq("id", job.id);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // brief pause, not a hot loop against a possibly-still-failing call
      continue; // retryable -- next claim picks it back up
    }

    tally.calls++;
    perStage.set(stageKey, tally);
    steps++;

    const { error: advanceError } = await supabase.rpc("advance_ingestion_cursor", {
      p_job_id: job.id,
      p_expected_stage: expectedStage,
      p_expected_chunk_index: expectedChunkIndex as number,
      p_expected_attempt: expectedAttempt,
      p_next_stage: work.nextStage,
      p_next_chunk_index: work.nextChunkIndex as number,
    });
    if (advanceError) throw new Error(`ingest-drive: advance_ingestion_cursor failed: ${advanceError.message}`);

    console.log(
      `[ingest-drive] step ${steps}: ${expectedStage}/${expectedChunkIndex ?? "-"} -> ${work.nextStage}/${work.nextChunkIndex ?? "-"} tokensIn=${work.tokensIn ?? "-"} tokensOut=${work.tokensOut ?? "-"}`,
    );

    if (work.nextStage === "done") {
      terminal = "done";
      break;
    }

    // Budget check every 5 steps (not every step) -- ai_usage_log query cost is trivial
    // but no need to hammer it more than that; a real overshoot between checks is bounded
    // by at most 5 stage calls, each individually cheap relative to $0.30.
    if (steps % 5 === 0) {
      const { data: costCheck } = await supabase.from("ai_usage_log").select("cost_usd").eq("user_id", USER_ID);
      const spendNow = (costCheck ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
      if (spendNow >= HARD_STOP_USD) {
        console.log(`\n!!! HARD STOP: cumulative spend $${spendNow.toFixed(6)} reached the $${HARD_STOP_USD} line mid-run at step ${steps}. Stopping immediately. Report to Lead. !!!`);
        terminal = "hard_stop";
        break;
      }
    }
  }

  const invocationEnd = Date.now();

  // --- Progress report ---
  const { data: job } = await supabase.from("ingestion_jobs").select("*").eq("id", JOB_ID).single();
  const { data: book } = await supabase.from("books").select("*").eq("id", BOOK_ID).single();
  const { count: chunkCount } = await supabase.from("source_chunks").select("id", { count: "exact", head: true }).eq("book_id", BOOK_ID);
  const { data: lessons } = await supabase.from("lessons").select("id, status").eq("book_id", BOOK_ID);
  const { count: cardCount } = await supabase.from("cards").select("id", { count: "exact", head: true }).eq("book_id", BOOK_ID);
  const { count: sectionCount } = await supabase.from("book_sections").select("id", { count: "exact", head: true }).eq("book_id", BOOK_ID);
  const { data: costRowsAfter } = await supabase.from("ai_usage_log").select("cost_usd").eq("user_id", USER_ID);
  const spendAfter = (costRowsAfter ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  const lessonsByStatus = { active: 0, archived: 0, rejected: 0 } as Record<string, number>;
  for (const l of lessons ?? []) lessonsByStatus[l.status] = (lessonsByStatus[l.status] ?? 0) + 1;

  console.log("\n=== PROGRESS AFTER THIS INVOCATION ===");
  console.log(`terminal: ${terminal}, steps this invocation: ${steps}, wall clock this invocation: ${Math.round((invocationEnd - invocationStart) / 1000)}s`);
  console.log(`job: stage=${job?.stage} cursor_chunk_index=${job?.cursor_chunk_index} cursor_attempt=${job?.cursor_attempt} last_error=${job?.last_error ?? "-"}`);
  console.log(`book: status=${book?.status} stage=${book?.stage} progress_pct=${book?.progress_pct} page_count=${book?.page_count} lesson_count=${book?.lesson_count}`);
  console.log(`chunks (source_chunks rows): ${chunkCount ?? 0}`);
  console.log(`lessons: ${JSON.stringify(lessonsByStatus)} (total ${(lessons ?? []).length})`);
  console.log(`cards: ${cardCount ?? 0}`);
  console.log(`book_sections rows: ${sectionCount ?? 0}`);
  console.log(`per-stage calls this invocation: ${JSON.stringify(Object.fromEntries(perStage))}`);
  console.log(`cumulative ai_usage_log spend: $${spendAfter.toFixed(6)} (was $${spendBefore.toFixed(6)} at invocation start)`);

  if (terminal === "done" || terminal === "failed" || terminal === "hard_stop") {
    const balance = await fetchDeepSeekBalance(deepseekKey);
    console.log(`DeepSeek balance now: ${JSON.stringify(balance)}`);
  }

  if (terminal === "hard_stop") process.exitCode = 2;
  if (terminal === "failed") process.exitCode = 3;
}

main().catch((err) => {
  console.error("[ingest-drive] FAILED:", err);
  process.exit(1);
});
