/**
 * ⚠️ OBSOLETE AS OF MIGRATION 112 — THIS SCRIPT CAN NO LONGER RUN.
 *
 * `112_ulm_state_after_backfill_completion.sql` did two things that between
 * them retire this file:
 *   1. It DROPPED `public._backfill_review_state_after`, the RPC this script
 *      calls. The call below now references a function that does not exist,
 *      which is also why this file fails `tsc` (TS2345 on the RPC name) —
 *      a pre-existing failure, not a regression from the R50 changes.
 *   2. It set `reviews.state_after` NOT NULL. So there can be no rows with
 *      `state_after IS NULL` left to find: the input set is empty BY
 *      CONSTRAINT, not merely by circumstance.
 *
 * KEPT DELIBERATELY, NOT DELETED. `112`'s own header names this script as a
 * prerequisite that must run before its `SET NOT NULL`. A deleted
 * prerequisite is worse than an obsolete one — it leaves that header
 * pointing at nothing and erases the record of how the backfill was actually
 * performed. Read this as history plus a worked example of the derivation,
 * and do not expect it to execute.
 *
 * The R50 targeting guards below are still correct and still enforced; they
 * simply now protect a script whose remaining job is to be read.
 *
 * ── original header follows ──────────────────────────────────────────────
 *
 * One-time (but re-runnable) backfill for `reviews.state_after`, part of
 * the `state_after` migration in the R1 draft
 * (ULM/docs/notes/r1-reviews-card-states-migration-draft.md §1) -- the
 * migration's own SQL cannot `SET NOT NULL` on this column until every
 * existing row has a value, and Postgres cannot call `ts-fsrs`, so the
 * Tier 2 rows (see below) have to be filled in from here, not from SQL.
 *
 * THIS IS NOT "MOST ROWS WERE RECOVERED FROM THE LOG, A FEW NEEDED THE
 * SCHEDULER." Where every existing review is its card's only/latest review,
 * the migration's own free SQL backfill
 * (`lead(state_before) over (partition by card_id order by reviewed_at)`)
 * recovers ZERO rows, and every value this script writes is
 * scheduler-derived rather than log-recovered. Say so plainly rather than
 * implying most were free.
 *
 * ⚠️ THIS HEADER USED TO QUOTE ROW COUNTS THAT NAMED NO DATABASE -- "28
 * reviews, 28 distinct cards... 0/28 free and 28/28 derived". Those counts
 * were measured on a scratch database, and PRODUCTION HAD ZERO REVIEWS at
 * the time. The natural reading of "28 rows, all derived" against an empty
 * table is "the backfill did not run", not "the comment is from somewhere
 * else". Removed rather than corrected, because the shape of the claim was
 * the defect: a documented row count that does not name the database and
 * the moment it was measured is unfalsifiable and will eventually be wrong
 * somewhere. If you record counts here again, name both.
 *
 * DERIVATION: the EXACT logic `rebuildSchedulerCache`'s pre-`state_after`
 * version used to derive a latest review's resulting state, before this
 * column existed -- one `computeNextState` call per row, fed only that
 * row's own real `reviewed_at` (never `now()`), using `state_before` /
 * `stability_before` / `difficulty_before` already stored on the row and
 * `reps`/`lapses` counted from that card's review history strictly BEFORE
 * this row. This makes the backfilled value traceable to a known,
 * previously-reviewed implementation, not "whatever the scheduler did that
 * night" -- see `lib/self-mastery/scheduler-cache.ts`'s git history for the
 * original `deriveLatestState` this reproduces.
 *
 * RE-RUNNABLE: only ever selects and writes rows where `state_after IS
 * NULL`. A partial failure (network drop mid-run, one bad row) leaves
 * already-written rows untouched on retry -- the WHERE clause is the
 * idempotency, not a separate "already ran" marker. Safe to run any number
 * of times; a fully-backfilled table makes every subsequent run a no-op
 * that reports 0 rows updated.
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-review-state-after.ts \
 *          --target <supabase-project-url> [--allow-production]
 * Prerequisite: the `state_after` column must already exist (nullable) --
 * apply the R1 migration's `alter table reviews add column state_after ...`
 * and its Tier 1 SQL backfill FIRST. Do not run the migration's
 * `SET NOT NULL` until this script reports 0 remaining nulls.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import { getScheduler, toFsrsCard, computeNextState, type DbFsrsState } from "../lib/self-mastery/fsrs-scheduler";

/**
 * R50: this script takes its target EXPLICITLY and refuses to guess.
 *
 * WHY THIS EXISTS. It used to load `../.env.local` and read
 * NEXT_PUBLIC_SUPABASE_URL from it. A lead set `DATABASE_URL` to an isolated
 * container, ran this, and it executed against PRODUCTION -- `DATABASE_URL`
 * is not a concept this script has, so the redirect was silently discarded.
 * No harm that time (production had 0 reviews, genuine no-op) but this script
 * WRITES to `reviews`, an append-only table. An explicit redirect that is
 * ignored is worse than no redirect: the operator did the right thing and was
 * overruled without being told.
 *
 * TRANSPORT: PostgREST via the Supabase JS client -- NOT a Postgres
 * connection. `--target` is a SUPABASE PROJECT URL (https://<ref>.supabase.co
 * or http://127.0.0.1:54321), never a `postgresql://` string. A bare Postgres
 * container cannot be targeted by this script at all; that is a real limit,
 * not an oversight, and it is why this migration's prerequisite cannot be
 * rehearsed on scratch.
 *
 * THE KEY IS NOT AN ARGUMENT. SUPABASE_SERVICE_ROLE_KEY still comes from the
 * environment, deliberately: a service-role key in argv is visible in `ps`
 * and in shell history. If the key belongs to a different project than
 * `--target`, the request fails auth -- which fails closed, the safe
 * direction.
 */
function parseTarget(argv: string[]): { url: string; allowProduction: boolean } {
  const targetIdx = argv.indexOf("--target");
  const allowProduction = argv.includes("--allow-production");

  if (targetIdx === -1 || !argv[targetIdx + 1]) {
    console.error(
      "backfill-review-state-after: --target <supabase-url> is REQUIRED.\n" +
        "  This script talks PostgREST, not Postgres. Pass a Supabase project URL\n" +
        "  (https://<ref>.supabase.co, or http://127.0.0.1:54321 for a local stack).\n" +
        "  It does NOT accept a postgresql:// connection string, and it no longer\n" +
        "  reads .env.local for its target -- see R50.",
    );
    process.exit(1);
  }

  const url = argv[targetIdx + 1]!;
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    console.error(
      `backfill-review-state-after: --target got a Postgres connection string.\n` +
        `  This script reaches the database through PostgREST, so it needs a Supabase\n` +
        `  project URL instead — literally of the shape:\n` +
        `      https://<ref>.supabase.co        (a hosted project)\n` +
        `      http://127.0.0.1:54321           (a local Supabase stack)\n` +
        `  A bare Postgres container cannot be targeted at all.`,
    );
    process.exit(1);
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    console.error(`backfill-review-state-after: --target is not a valid URL: ${url}`);
    process.exit(1);
  }

  // Fail CLOSED on anything unfamiliar. A narrower rule (matching one known
  // project ref) would let a new remote environment through by default, which
  // is the wrong direction for a script that writes to an append-only table.
  const isLocal = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
  console.error(`backfill-review-state-after: TARGET HOST = ${host}${isLocal ? " (local)" : " (REMOTE)"}`);

  if (!isLocal && !allowProduction) {
    console.error(
      `backfill-review-state-after: REFUSING to run against a non-local host without --allow-production.\n` +
        `  Host: ${host}\n` +
        `  This script writes to \`reviews\`, which is append-only. If you really mean\n` +
        `  production, say so explicitly: --allow-production`,
    );
    process.exit(1);
  }

  return { url, allowProduction };
}

export interface ReviewForBackfill {
  id: string;
  card_id: string;
  rating: number;
  reviewed_at: string;
  state_before: DbFsrsState | null;
  stability_before: number | null;
  difficulty_before: number | null;
  state_after: DbFsrsState | null;
}

export type BackfillStep =
  | { id: string; action: "already-set" }
  | { id: string; action: "derive"; stateAfter: DbFsrsState }
  | { id: string; action: "error"; message: string }
  | { id: string; action: "skipped-after-earlier-error" };

/**
 * Pure per-card planning logic, exported for direct unit testing (no I/O,
 * no scratch, no PostgREST needed). Given ONE card's reviews (any order,
 * any mix of already-set and null state_after), returns the ordered plan:
 * which rows are already done, which need deriving (and their derived
 * value), and which are unreachable because an earlier row in the same
 * card's history failed to derive (its own resulting state -- and
 * therefore every later row's starting point -- is unknown, so deriving
 * past it would be a guess, not a value traceable to a known
 * implementation). `main()` below is the thin I/O wrapper around this.
 */
export function planCardBackfill(reviews: ReviewForBackfill[]): BackfillStep[] {
  const scheduler = getScheduler();
  const TS_TO_DB_STATE = ["new", "learning", "review", "relearning"] as const;
  const ordered = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));

  const plan: BackfillStep[] = [];
  let priorReps = 0;
  let priorLapses = 0;
  let priorLastReviewAt: string | null = null;
  let sawError = false;

  for (const row of ordered) {
    if (sawError) {
      plan.push({ id: row.id, action: "skipped-after-earlier-error" });
      continue;
    }
    if (row.state_after !== null) {
      plan.push({ id: row.id, action: "already-set" });
      priorReps += 1;
      if (row.rating === 1 && row.state_before === "review") priorLapses += 1;
      priorLastReviewAt = row.reviewed_at;
      continue;
    }
    if (row.state_before === null) {
      plan.push({ id: row.id, action: "error", message: `review ${row.id}: state_before is null -- cannot derive without it` });
      sawError = true;
      continue;
    }

    const priorSnapshot = {
      stability: row.stability_before,
      difficulty: row.difficulty_before,
      dueAt: null,
      reps: priorReps,
      lapses: priorLapses,
      state: row.state_before,
      lastReviewAt: priorLastReviewAt,
    };
    const priorCard = toFsrsCard(priorSnapshot, new Date(row.reviewed_at));
    const { card } = computeNextState(scheduler, priorCard, row.rating as 1 | 2 | 3 | 4, new Date(row.reviewed_at));
    const stateAfter = TS_TO_DB_STATE[card.state];
    plan.push({ id: row.id, action: "derive", stateAfter });

    priorReps += 1;
    if (row.rating === 1 && row.state_before === "review") priorLapses += 1;
    priorLastReviewAt = row.reviewed_at;
  }

  return plan;
}

async function main() {
  const { url } = parseTarget(process.argv.slice(2));
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(
      "backfill-review-state-after: SUPABASE_SERVICE_ROLE_KEY must be set in the environment.\n" +
        "  It is read from env rather than argv on purpose -- a service-role key passed\n" +
        "  as an argument is visible in `ps` and shell history.",
    );
    process.exit(1);
  }
  const supabase = createClient<Database>(url, serviceRoleKey);

  // Every review for every card that has at least one NULL state_after row
  // -- fetched by card, not filtered to only-null rows, because computing
  // priorReps/priorLapses/priorLastReviewAt for a null row requires walking
  // that card's FULL ordered history, not just the null rows in isolation.
  const { data: nullRows, error: nullError } = await supabase
    .from("reviews")
    .select("card_id")
    .is("state_after", null)
    .not("card_id", "is", null);
  if (nullError) throw nullError;
  const cardIdsNeedingWork = Array.from(new Set((nullRows ?? []).map((r) => r.card_id as string)));

  if (cardIdsNeedingWork.length === 0) {
    console.log("backfill-review-state-after: 0 cards with a null state_after row. Nothing to do.");
    return;
  }
  console.log(`backfill-review-state-after: ${cardIdsNeedingWork.length} card(s) have at least one null state_after row.`);

  const { data: allReviews, error: allError } = await supabase
    .from("reviews")
    .select("id, card_id, rating, reviewed_at, state_before, stability_before, difficulty_before, state_after")
    .in("card_id", cardIdsNeedingWork)
    .order("reviewed_at", { ascending: true });
  if (allError) throw allError;

  const byCard = new Map<string, ReviewForBackfill[]>();
  for (const row of allReviews ?? []) {
    const list = byCard.get(row.card_id as string) ?? [];
    list.push({
      id: row.id as string,
      card_id: row.card_id as string,
      rating: row.rating as number,
      reviewed_at: row.reviewed_at as string,
      state_before: row.state_before as DbFsrsState | null,
      stability_before: row.stability_before as number | null,
      difficulty_before: row.difficulty_before as number | null,
      state_after: row.state_after as DbFsrsState | null,
    });
    byCard.set(row.card_id as string, list);
  }

  let derived = 0;
  let skipped = 0;
  let failed = 0;

  for (const [cardId, reviews] of byCard) {
    const plan = planCardBackfill(reviews);
    for (const step of plan) {
      if (step.action === "already-set") continue;
      if (step.action === "skipped-after-earlier-error") {
        skipped++;
        continue;
      }
      if (step.action === "error") {
        console.error(`  FAILED: card ${cardId}: ${step.message}`);
        failed++;
        continue;
      }
      // step.action === "derive"
      // Via the RPC, not `.from("reviews").update()` -- `reviews` is
      // append-only (072), and PostgREST has no way to disable/re-enable
      // the trigger around a plain data update; found by this script
      // failing exactly that way against scratch, not anticipated. The RPC
      // opens and closes the door in one call (migration 111's own
      // `_backfill_review_state_after`), and its own `where state_after is
      // null` guard is the belt-and-suspenders against overwriting a value
      // another run already wrote.
      const { error: updateError } = await supabase.rpc("_backfill_review_state_after", {
        p_id: step.id,
        p_state_after: step.stateAfter,
      });
      if (updateError) {
        console.error(`  FAILED: card ${cardId} review ${step.id}: write error`, updateError);
        failed++;
        continue;
      }
      console.log(`  card ${cardId} review ${step.id}: state_after = ${step.stateAfter}`);
      derived++;
    }
  }

  console.log(`backfill-review-state-after: derived ${derived}, skipped ${skipped} (due to an earlier failure in the same card), failed ${failed}.`);
  if (failed > 0) {
    console.error("Non-zero failures -- do NOT run `alter table reviews alter column state_after set not null` until this reports 0 remaining nulls on a clean run.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
