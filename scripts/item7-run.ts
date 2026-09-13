/**
 * ITEM 7's STANDALONE DRIVER — a stand-in for item 6's real driver (the
 * LifeOS lead's pg_net/cron round-trip, not built here). Purpose-built for
 * this one manual, real-book run: create a throwaway user + book, enqueue
 * an ingestion_jobs row, loop-call /api/self-mastery/ingestion/step until
 * the job reaches done/failed, and report exactly what happened against
 * `ULM/boss-handoff/12-ITEM-7-PREDICTION.md`'s committed-in-advance numbers.
 *
 * NOT part of `npm test`, not a permanent regression script — same posture
 * as ULM's own `apps/worker/src/e2e-test.ts`. Test data (user, book,
 * lessons, cards) is left in place afterward for inspection, matching the
 * `docs/research/deck-sample-*.md` convention this run is meant to extend.
 *
 * Usage: SELF_MASTERY_INGESTION_SECRET=... npx tsx scripts/item7-run.ts
 * (reads the PDF from docs/research/fixtures/ in the sibling ULM checkout,
 * reads NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/
 * SELF_MASTERY_INGESTION_SECRET from the environment / .env.local)
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import type { Database } from "../lib/supabase/database.types";

const PDF_PATH = "/Users/aymanmohammed/Desktop/ULM/docs/research/fixtures/varietiesofrelig00jameuoft.pdf";
const APP_BASE_URL = process.env.ITEM7_APP_URL ?? "http://localhost:3000";
const MAX_STEPS = 1000; // safety cap, not an expected count -- see the report's actual step count

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`item7-run: missing required env var ${name}`);
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const ingestionSecret = requireEnv("SELF_MASTERY_INGESTION_SECRET");
  const supabase = createClient<Database>(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const runStartedAt = Date.now();
  console.log(`[item7] starting ${new Date(runStartedAt).toISOString()}`);

  // --- 1. Throwaway user (left in place afterward, per the deck-sample convention) ---
  const email = `item7-james-${Date.now()}@ulm-test.local`;
  const password = crypto.randomUUID();
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) throw new Error(`item7-run: createUser failed: ${userError?.message}`);
  const userId = userData.user.id;
  console.log(`[item7] created user ${userId} (${email})`);

  // --- 1b. A real authenticated session for that user -- `books` derives its
  // own user_id from `auth.uid()` via `set_user_id_from_caller` (061), not
  // from a parent row, so it genuinely needs a caller with a real session,
  // not just service_role (service_role's auth.uid() is null). Everything
  // downstream of `books` (ingestion_jobs, source_chunks, lessons, cards) is
  // parent-derived (`set_user_id_from_book`), so service_role is correct for
  // those and used below -- this is the one insert that needs the real path.
  const anon = createClient<Database>(url, anonKey);
  const { data: sessionData, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !sessionData.session) throw new Error(`item7-run: sign-in failed: ${signInError?.message}`);
  const asUser = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- 2. Upload the real PDF ---
  const fileBytes = await readFile(PDF_PATH);
  const storagePath = `${userId}/item7-varieties-of-religious-experience.pdf`;
  const { error: uploadError } = await supabase.storage.from("books").upload(storagePath, fileBytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadError) throw new Error(`item7-run: storage upload failed: ${uploadError.message}`);
  console.log(`[item7] uploaded PDF to books/${storagePath} (${fileBytes.length} bytes)`);

  // --- 3. books row (as the real user) + ingestion_jobs row (service_role) ---
  const { data: book, error: bookError } = await asUser
    .from("books")
    .insert({
      user_id: userId,
      title: "The Varieties of Religious Experience",
      author: "William James",
      status: "processing",
      stage: "queued",
      file_path: storagePath,
      file_size_bytes: fileBytes.length,
    })
    .select("id")
    .single();
  if (bookError || !book) throw new Error(`item7-run: books insert failed: ${bookError?.message}`);
  console.log(`[item7] created book ${book.id}`);

  const { data: job, error: jobError } = await supabase
    .from("ingestion_jobs")
    .insert({ book_id: book.id, user_id: userId })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`item7-run: ingestion_jobs insert failed: ${jobError?.message}`);
  console.log(`[item7] created ingestion_jobs ${job.id}, stage defaults to 'queued'`);

  // --- 4. Drive the step loop ---
  interface StepLogEntry {
    n: number;
    elapsedMs: number;
    httpStatus: number;
    ok: boolean;
    reason?: string;
    stage: string | null;
    chunkIndex: number | null;
    nextStage?: string;
    nextChunkIndex?: number | null;
    alreadyAdvanced?: boolean;
  }
  const stepLog: StepLogEntry[] = [];
  let step = 0;
  let terminal: "done" | "failed" | "no_more_work" | "max_steps_reached" = "max_steps_reached";

  while (step < MAX_STEPS) {
    step++;
    const callStart = Date.now();
    const res = await fetch(`${APP_BASE_URL}/api/self-mastery/ingestion/step`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ingestionSecret}` },
    });
    const elapsedMs = Date.now() - callStart;
    const body = (await res.json()) as Record<string, unknown>;
    const entry: StepLogEntry = {
      n: step,
      elapsedMs,
      httpStatus: res.status,
      ok: Boolean(body.ok),
      reason: body.reason as string | undefined,
      stage: (body.stage as string | null) ?? null,
      chunkIndex: (body.chunkIndex as number | null) ?? null,
      nextStage: body.nextStage as string | undefined,
      nextChunkIndex: body.nextChunkIndex as number | null | undefined,
      alreadyAdvanced: body.alreadyAdvanced as boolean | undefined,
    };
    stepLog.push(entry);
    console.log(
      `[item7] step ${step}: ${res.status} ok=${entry.ok} stage=${entry.stage ?? "-"}/${entry.chunkIndex ?? "-"} -> ${entry.nextStage ?? entry.reason ?? "-"}/${entry.nextChunkIndex ?? "-"} (${elapsedMs}ms)`,
    );

    if (entry.reason === "no_eligible_job") {
      terminal = "no_more_work";
      break;
    }
    if (entry.nextStage === "done" || entry.nextStage === "failed") {
      terminal = entry.nextStage;
      break;
    }
    if (!entry.ok && entry.reason === "attempts_exhausted") {
      terminal = "failed";
      break;
    }
    // A single failed-but-retryable attempt (reason "stage_work_failed") is
    // expected and counted, not a loop-stopping condition -- claim_ingestion_job's
    // own lease/attempt bookkeeping governs whether a retry is eligible next call.
  }

  const runEndedAt = Date.now();
  console.log(`[item7] loop ended: ${terminal}, ${step} steps, ${Math.round((runEndedAt - runStartedAt) / 1000)}s wall clock`);

  // --- 5. Report: real outcome vs. the prediction table ---
  const { data: finalJob } = await supabase.from("ingestion_jobs").select("*").eq("id", job.id).single();
  const { data: finalBook } = await supabase.from("books").select("*").eq("id", book.id).single();
  const { data: lessons } = await supabase.from("lessons").select("id, status, rank").eq("book_id", book.id);
  const { data: attempts } = await supabase
    .from("ingestion_job_stage_attempts")
    .select("stage, chunk_index, attempt, succeeded, tokens_in, tokens_out, started_at, finished_at, error")
    .eq("job_id", job.id)
    .order("started_at", { ascending: true });

  const activeLessons = (lessons ?? []).filter((l) => l.status === "active").length;
  const archivedLessons = (lessons ?? []).filter((l) => l.status === "archived").length;
  const rejectedLessons = (lessons ?? []).filter((l) => l.status === "rejected").length;
  const rankedCandidates = (lessons ?? []).filter((l) => l.rank !== null).length;

  const byStage = new Map<string, { calls: number; succeeded: number; failed: number; tokensIn: number; tokensOut: number; totalMs: number }>();
  for (const a of attempts ?? []) {
    const key = a.stage;
    const cur = byStage.get(key) ?? { calls: 0, succeeded: 0, failed: 0, tokensIn: 0, tokensOut: 0, totalMs: 0 };
    cur.calls++;
    if (a.succeeded) cur.succeeded++;
    else cur.failed++;
    cur.tokensIn += a.tokens_in ?? 0;
    cur.tokensOut += a.tokens_out ?? 0;
    if (a.started_at && a.finished_at) cur.totalMs += new Date(a.finished_at).getTime() - new Date(a.started_at).getTime();
    byStage.set(key, cur);
  }

  const report = {
    runStartedAt: new Date(runStartedAt).toISOString(),
    runEndedAt: new Date(runEndedAt).toISOString(),
    wallClockSeconds: Math.round((runEndedAt - runStartedAt) / 1000),
    userId,
    bookId: book.id,
    jobId: job.id,
    terminal,
    stepCount: step,
    finalJobStage: finalJob?.stage,
    finalBookStatus: finalBook?.status,
    finalBookErrorMessage: finalBook?.error_message,
    lessonCounts: { active: activeLessons, archived: archivedLessons, rejected: rejectedLessons, rankedByMerge: rankedCandidates, totalRows: (lessons ?? []).length },
    perStage: Object.fromEntries(byStage),
    retries: { totalFailedAttempts: (attempts ?? []).filter((a) => !a.succeeded).length, totalAttempts: (attempts ?? []).length },
    predictionTableComparison: {
      predictedRange_active: "26-52 (of 60 targeted, §1 amendment)",
      actual_active: activeLessons,
    },
  };

  const reportPath = `/Users/aymanmohammed/Desktop/ULM/docs/research/item7-run-report-${new Date(runStartedAt).toISOString().replace(/[:.]/g, "-")}.json`;
  await writeFile(reportPath, JSON.stringify({ report, stepLog }, null, 2));
  console.log(`[item7] report written to ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("[item7] FAILED:", e);
  process.exitCode = 1;
});
