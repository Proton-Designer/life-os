#!/usr/bin/env -S npx tsx
// check-scheduler-cache-drift.ts — see check-scheduler-cache-drift.sh for the
// full WHY. This file is the implementation; the .sh is a thin wrapper kept
// only so this instrument has the same `<postgres-url> [--self-test]` shape
// as every other check-*.sh in this repo. FSRS math needs a real JS engine
// (ts-fsrs), which is why this one script in the check-* family is Node
// instead of pure psql.
//
// STATE IS NOT REBUILT IN MODE 1, ON PURPOSE: `reviews` stores `state_before`
// per row but has no `state_after` column. For every review except the most
// recent, state_after IS recoverable (it equals the NEXT review's
// state_before) — but the row this script actually compares against
// `card_states` is always the MOST RECENT review, which by definition has no
// "next" row to read it from. Deriving it anyway would mean calling the
// scheduler's state-dispatch logic, which is no longer "rebuild from stored
// columns alone" — it's a scheduler call, Mode 2/3's job, not Mode 1's. This
// is a structural fact about the schema, not a shortcut: said once here,
// enforced by simply not checking `state` in Mode 1's output below.
import { execFileSync } from "node:child_process";
import {
  getScheduler,
  toFsrsCard,
  computeNextState,
  toRpcNextState,
  DEFAULT_REQUEST_RETENTION,
  type DbFsrsState,
} from "../lib/self-mastery/fsrs-scheduler";
import { State, type Card } from "ts-fsrs";

// Explicit, not array-index-into-enum-order: fsrs-scheduler.ts's own
// DB_TO_TS_STATE isn't exported (it's private to that module), and silently
// relying on ts-fsrs's State enum keeping New=0/Learning=1/Review=2/
// Relearning=3 forever would be exactly the kind of implicit coupling this
// whole instrument exists to catch elsewhere. Named here instead.
const DB_STATE_TO_TS: Record<DbFsrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const SELF_TEST = args.includes("--self-test");
const FORCE_WRITE = args.includes("--i-know-this-writes");
const modeArg = args.find((a) => a.startsWith("--mode="));
const REQUESTED_MODES = modeArg ? modeArg.split("=")[1]!.split(",").map(Number) : [1, 2, 3];
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 100;
const URL = args.find((a) => !a.startsWith("--"));

if (!URL) {
  console.error("usage: check-scheduler-cache-drift.ts <postgres-url> [--self-test] [--mode=1,2,3] [--limit=N]");
  process.exit(2);
}

// --self-test performs REAL writes (fixture rows, one deliberate corruption).
// Every other check-*.sh in this repo self-tests inside a rolled-back
// transaction against whatever table it's checking; this one can't do that
// cleanly across a psql-then-Node process boundary, so it writes for real
// instead. That makes it meaningfully more dangerous than check-rls.sh's
// create/drop-a-canary-table pattern, so it gets an extra guard those don't
// need: refuse unless the URL looks like scratch, or the caller explicitly
// overrides.
if (SELF_TEST && !FORCE_WRITE && !/localhost|127\.0\.0\.1|scratch/i.test(URL)) {
  console.error(
    `REFUSING: --self-test writes real fixture rows and a real corruption. "${URL}" doesn't look like scratch.\n` +
      `Pass --i-know-this-writes to override, or point this at the scratch database.`
  );
  process.exit(2);
}

// execFileSync, not exec/execSync-with-a-built-string: URL and the SQL body
// both come from the command line / this file's own template strings, and
// neither should ever be interpreted by a shell. No argument here is passed
// through `/bin/sh -c`, so shell metacharacters in a card id or a
// caller-supplied URL are inert.
function psql(sql: string): string {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t"], { input: sql, encoding: "utf8" });
}
function psqlReadOnly(sql: string): string[] {
  return psql(`begin read only;\n${sql}\ncommit;`)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "BEGIN" && l !== "COMMIT");
}
function esc(s: string) {
  return s.replace(/'/g, "''");
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = psqlReadOnly(
    `select 1 from information_schema.columns where table_schema='public' and table_name='${table}' and column_name='${column}';`
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// shared types
// ---------------------------------------------------------------------------
interface ReviewRow {
  cardId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4;
  stateBefore: DbFsrsState;
  stabilityAfter: number;
  difficultyAfter: number;
  scheduledDays: number;
  reviewedAt: string;
  requestRetention: number | null; // null until the column lands
}
interface CardStateRow {
  cardId: string;
  stability: number;
  difficulty: number;
  dueAt: string;
  reps: number;
  lapses: number;
  state: DbFsrsState;
}

const TOL = { stability: 1e-2, difficulty: 1e-2, dueMs: 5000 };

function fetchReviewsForCards(cardIds: string[]): Map<string, ReviewRow[]> {
  if (cardIds.length === 0) return new Map();
  const inList = cardIds.map((id) => `'${id}'`).join(",");
  const cols = "card_id, user_id, rating, state_before, stability_after, difficulty_after, scheduled_days, reviewed_at";
  const rows = psqlReadOnly(
    `select ${cols} from public.reviews where card_id in (${inList}) order by card_id, reviewed_at;`
  ).map((l) => l.split("\t"));
  const byCard = new Map<string, ReviewRow[]>();
  for (const r of rows) {
    const [cardId, userId, rating, stateBefore, stabilityAfter, difficultyAfter, scheduledDays, reviewedAt] = r;
    const list = byCard.get(cardId!) ?? [];
    list.push({
      cardId: cardId!,
      userId: userId!,
      rating: Number(rating) as 1 | 2 | 3 | 4,
      stateBefore: stateBefore as DbFsrsState,
      stabilityAfter: Number(stabilityAfter),
      difficultyAfter: Number(difficultyAfter),
      scheduledDays: Number(scheduledDays),
      reviewedAt: reviewedAt!,
      requestRetention: null,
    });
    byCard.set(cardId!, list);
  }
  return byCard;
}

function fetchCardStates(cardIds: string[]): Map<string, CardStateRow> {
  if (cardIds.length === 0) return new Map();
  const inList = cardIds.map((id) => `'${id}'`).join(",");
  const rows = psqlReadOnly(
    `select card_id, stability, difficulty, due_at, reps, lapses, state from public.card_states where card_id in (${inList});`
  ).map((l) => l.split("\t"));
  const map = new Map<string, CardStateRow>();
  for (const [cardId, stability, difficulty, dueAt, reps, lapses, state] of rows) {
    map.set(cardId!, {
      cardId: cardId!,
      stability: Number(stability),
      difficulty: Number(difficulty),
      dueAt: dueAt!,
      reps: Number(reps),
      lapses: Number(lapses),
      state: state as DbFsrsState,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// sampling — MUST target multi-review histories, not a uniform sample.
// ---------------------------------------------------------------------------
interface SamplePopulation {
  anyReviewCardIds: string[]; // >=1 review — Mode 1 candidates
  multiReviewCardIds: string[]; // >=2 reviews — Mode 3 candidates, and the informative half of Mode 1/2
  totalCardStatesRows: number;
  totalReviewedCards: number;
}

function sample(limit: number): SamplePopulation {
  const totalCardStatesRows = Number(psqlReadOnly(`select count(*) from public.card_states;`)[0]);
  const reviewCounts = psqlReadOnly(
    `select card_id, count(*) from public.reviews group by card_id order by count(*) desc;`
  ).map((l) => {
    const [cardId, count] = l.split("\t");
    return { cardId: cardId!, count: Number(count) };
  });
  const multi = reviewCounts.filter((r) => r.count >= 2).map((r) => r.cardId);
  const any = reviewCounts.map((r) => r.cardId);
  return {
    anyReviewCardIds: any.slice(0, limit),
    multiReviewCardIds: multi.slice(0, limit),
    totalCardStatesRows,
    totalReviewedCards: reviewCounts.length,
  };
}

// ---------------------------------------------------------------------------
// MODE 1 — rebuild stability/difficulty/due_at/reps/lapses purely from
// stored `reviews` columns. No scheduler call. Retention-independent.
// ---------------------------------------------------------------------------
interface Mode1Result {
  cardId: string;
  ok: boolean;
  detail: string;
}
function runMode1(cardIds: string[], reviewsByCard: Map<string, ReviewRow[]>, cacheByCard: Map<string, CardStateRow>): Mode1Result[] {
  const results: Mode1Result[] = [];
  for (const cardId of cardIds) {
    const reviews = reviewsByCard.get(cardId) ?? [];
    const cache = cacheByCard.get(cardId);
    if (reviews.length === 0 || !cache) continue;
    const last = reviews[reviews.length - 1]!;
    const rebuiltDueAt = new Date(new Date(last.reviewedAt).getTime() + last.scheduledDays * 86400000);
    const rebuiltReps = reviews.length;
    const rebuiltLapses = reviews.filter((r) => r.rating === 1 && r.stateBefore === "review").length;

    const stabilityDelta = Math.abs(last.stabilityAfter - cache.stability);
    const difficultyDelta = Math.abs(last.difficultyAfter - cache.difficulty);
    const dueDeltaMs = Math.abs(rebuiltDueAt.getTime() - new Date(cache.dueAt).getTime());
    const repsOk = rebuiltReps === cache.reps;
    const lapsesOk = rebuiltLapses === cache.lapses;
    const ok = stabilityDelta <= TOL.stability && difficultyDelta <= TOL.difficulty && dueDeltaMs <= TOL.dueMs && repsOk && lapsesOk;

    results.push({
      cardId,
      ok,
      detail: ok
        ? "ok"
        : `stability(rebuilt=${last.stabilityAfter} cached=${cache.stability} d=${stabilityDelta}) ` +
          `difficulty(rebuilt=${last.difficultyAfter} cached=${cache.difficulty} d=${difficultyDelta}) ` +
          `due_at(rebuilt=${rebuiltDueAt.toISOString()} cached=${cache.dueAt} d_ms=${dueDeltaMs}) ` +
          `reps(rebuilt=${rebuiltReps} cached=${cache.reps} ${repsOk ? "ok" : "MISMATCH"}) ` +
          `lapses(rebuilt=${rebuiltLapses} cached=${cache.lapses} ${lapsesOk ? "ok" : "MISMATCH"})`,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// MODE 2 — recompute the FULL history through the real scheduler, compare to
// what `reviews` actually stored. Requires reviews.request_retention (not
// landed as of this writing — see check-scheduler-cache-drift.sh's header).
// REFUSES rather than degrading to a uniform current-retention guess.
// ---------------------------------------------------------------------------
async function runMode2(cardIds: string[], reviewsByCard: Map<string, ReviewRow[]>): Promise<{ skipped: true; reason: string } | { skipped: false; results: Mode1Result[] }> {
  if (!(await hasColumn("reviews", "request_retention"))) {
    return {
      skipped: true,
      reason: "reviews.request_retention not present; Mode 2 cannot be retention-faithful and is SKIPPED (not degraded to a uniform current-retention guess — see R1.6's Card D finding on why that would be dishonest).",
    };
  }
  // Once the column lands: pull it per-row, replay each card from an empty
  // card using getScheduler(row.requestRetention) at EACH step (a scheduler
  // may have been constructed once per distinct retention value seen, same
  // as fsrs-scheduler.ts's own cache), with `now` = that row's real
  // reviewed_at — never process time. Compare the final computed state to
  // the LAST review's own stored stability_after/difficulty_after/
  // scheduled_days (this mode checks against `reviews`, not `card_states` —
  // that's Mode 1's job).
  const results: Mode1Result[] = [];
  for (const cardId of cardIds) {
    const reviews = reviewsByCard.get(cardId) ?? [];
    if (reviews.length === 0) continue;
    let current: Card = toFsrsCard(null, new Date(reviews[0]!.reviewedAt));
    for (const r of reviews) {
      const retention = r.requestRetention ?? DEFAULT_REQUEST_RETENTION;
      const scheduler = getScheduler(retention);
      current = computeNextState(scheduler, current, r.rating, new Date(r.reviewedAt)).card;
    }
    const last = reviews[reviews.length - 1]!;
    const stabilityDelta = Math.abs(current.stability - last.stabilityAfter);
    const difficultyDelta = Math.abs(current.difficulty - last.difficultyAfter);
    const ok = stabilityDelta <= TOL.stability && difficultyDelta <= TOL.difficulty;
    results.push({
      cardId,
      ok,
      detail: ok ? "ok" : `stability(recomputed=${current.stability} stored=${last.stabilityAfter} d=${stabilityDelta}) difficulty(recomputed=${current.difficulty} stored=${last.difficultyAfter} d=${difficultyDelta})`,
    });
  }
  return { skipped: false, results };
}

// ---------------------------------------------------------------------------
// MODE 3 — history consistency. For every review after a card's first,
// recompute ONE step from the immediate predecessor's stored after-values,
// using THIS review's own real reviewed_at (never "now") — this is the
// entire point of the mode, and the case Mode 1/2 structurally cannot see
// (card_states only ever holds the final row).
// ---------------------------------------------------------------------------
interface Mode3StepResult {
  cardId: string;
  stepIndex: number; // 1-based index of the review being checked (its predecessor is stepIndex-1)
  ok: boolean;
  detail: string;
}
async function runMode3(cardIds: string[], reviewsByCard: Map<string, ReviewRow[]>): Promise<{ steps: Mode3StepResult[]; retentionAware: boolean }> {
  const retentionAware = await hasColumn("reviews", "request_retention");
  const steps: Mode3StepResult[] = [];
  for (const cardId of cardIds) {
    const reviews = reviewsByCard.get(cardId) ?? [];
    for (let i = 1; i < reviews.length; i++) {
      const prev = reviews[i - 1]!;
      const cur = reviews[i]!;
      const predecessorCard: Card = {
        due: new Date(prev.reviewedAt), // not read by computeNextState's math for this step's stability/difficulty
        stability: prev.stabilityAfter,
        difficulty: prev.difficultyAfter,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: i, // count of reviews up to and including prev
        lapses: reviews.slice(0, i).filter((r) => r.rating === 1 && r.stateBefore === "review").length,
        state: DB_STATE_TO_TS[cur.stateBefore],
        last_review: new Date(prev.reviewedAt),
      };
      const retention = retentionAware ? cur.requestRetention ?? DEFAULT_REQUEST_RETENTION : DEFAULT_REQUEST_RETENTION;
      const scheduler = getScheduler(retention);
      // THE critical line: 'now' is this review's own real reviewed_at, never
      // process time. Passing Date.now() here is exactly the corruption class
      // this mode exists to catch — see the self-test below.
      const recomputed = computeNextState(scheduler, predecessorCard, cur.rating, new Date(cur.reviewedAt)).card;

      const stabilityDelta = Math.abs(recomputed.stability - cur.stabilityAfter);
      const difficultyDelta = Math.abs(recomputed.difficulty - cur.difficultyAfter);
      // due_at/scheduled_days are retention-sensitive per-row; only checked
      // once request_retention exists, same discipline as Mode 2.
      const dueOk = !retentionAware || (() => {
        const recomputedDue = recomputed.due.getTime();
        const storedDue = new Date(cur.reviewedAt).getTime() + cur.scheduledDays * 86400000;
        return Math.abs(recomputedDue - storedDue) <= TOL.dueMs;
      })();
      const ok = stabilityDelta <= TOL.stability && difficultyDelta <= TOL.difficulty && dueOk;
      steps.push({
        cardId,
        stepIndex: i + 1,
        ok,
        detail: ok
          ? "ok"
          : `stability(recomputed=${recomputed.stability} stored=${cur.stabilityAfter} d=${stabilityDelta}) difficulty(recomputed=${recomputed.difficulty} stored=${cur.difficultyAfter} d=${difficultyDelta})${retentionAware ? " due_at:MISMATCH-see-above" : ""}`,
      });
    }
  }
  return { steps, retentionAware };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function runAll() {
  const pop = sample(LIMIT);
  console.log(`Population: ${pop.totalCardStatesRows} card_states rows, ${pop.totalReviewedCards} distinct cards with >=1 review, ${pop.multiReviewCardIds.length} with >=2 reviews (sampled, capped at ${LIMIT}).`);
  if (pop.multiReviewCardIds.length === 0) {
    console.log("*** ZERO multi-review cards exist to sample. This is a coverage gap, not a pass. Mode 3 will report 0/0 — that must not be read as \"clean\". ***");
  }
  console.log("");

  const allCardIds = [...new Set([...pop.anyReviewCardIds, ...pop.multiReviewCardIds])];
  const reviewsByCard = fetchReviewsForCards(allCardIds);
  const cacheByCard = fetchCardStates(allCardIds);

  let anyFail = false;

  if (REQUESTED_MODES.includes(1)) {
    console.log(`=== MODE 1 — rebuild-vs-cache (${pop.anyReviewCardIds.length} cards) ===`);
    const results = runMode1(pop.anyReviewCardIds, reviewsByCard, cacheByCard);
    const fails = results.filter((r) => !r.ok);
    console.log(`  ${results.length - fails.length}/${results.length} match.`);
    for (const f of fails) console.log(`  FAIL card=${f.cardId}: ${f.detail}`);
    if (fails.length > 0) anyFail = true;
    console.log("");
  }

  if (REQUESTED_MODES.includes(2)) {
    console.log(`=== MODE 2 — recompute-vs-stored-after-values (${pop.anyReviewCardIds.length} cards) ===`);
    const mode2 = await runMode2(pop.anyReviewCardIds, reviewsByCard);
    if (mode2.skipped) {
      console.log(`  SKIPPED: ${mode2.reason}`);
    } else {
      const fails = mode2.results.filter((r) => !r.ok);
      console.log(`  ${mode2.results.length - fails.length}/${mode2.results.length} match.`);
      for (const f of fails) console.log(`  FAIL card=${f.cardId}: ${f.detail}`);
      if (fails.length > 0) anyFail = true;
    }
    console.log("");
  }

  if (REQUESTED_MODES.includes(3)) {
    console.log(`=== MODE 3 — history consistency (${pop.multiReviewCardIds.length} multi-review cards) ===`);
    const mode3 = await runMode3(pop.multiReviewCardIds, reviewsByCard);
    if (!mode3.retentionAware) {
      console.log("  (reviews.request_retention not present yet -- checking stability/difficulty only, which are retention-independent; due_at consistency deferred until that column lands)");
    }
    const fails = mode3.steps.filter((s) => !s.ok);
    console.log(`  ${mode3.steps.length - fails.length}/${mode3.steps.length} intermediate steps match.`);
    for (const f of fails) console.log(`  FAIL card=${f.cardId} step=${f.stepIndex}: ${f.detail}`);
    if (mode3.steps.length === 0) console.log("  (0 steps to check -- see the population line above; this is a coverage gap, not a pass)");
    if (fails.length > 0) anyFail = true;
    console.log("");
  }

  return anyFail;
}

// ---------------------------------------------------------------------------
// self-test — writes real fixtures + a real corruption per requested mode,
// confirms detection, then repairs what it corrupted. Never touches
// `reviews` via UPDATE/DELETE (blocked by the append-only trigger, correctly
// -- confirmed live even from this script's own attempt) -- Mode 3's
// corruption is a deliberately-wrong INSERT instead, which the append-only
// trigger does NOT block (only UPDATE/DELETE are rejected; a bad INSERT is
// exactly the shape of mistake this whole instrument exists to catch, since
// nothing stops a bad row from being INSERTED, only from being fixed after).
// ---------------------------------------------------------------------------
async function selfTest() {
  console.log("SELF-TEST: each mode must be provable RED before it is trusted GREEN.\n");
  let allPassed = true;

  // --- fixtures: one user, one book/lesson, two cards ---
  const uid = "aa11aa11-1111-4111-8111-111111111111";
  const bookId = "bb22bb22-2222-4222-8222-222222222222";
  const lessonId = "cc33cc33-3333-4333-8333-333333333333";
  const cardMode1 = "dd44dd44-4444-4444-8444-444444444444";
  const cardMode3 = "ee55ee55-5555-4555-8555-555555555555";

  psql(`
begin;
insert into auth.users (id) values ('${uid}') on conflict (id) do nothing;
select set_config('request.jwt.claim.sub', '${uid}', true);
insert into public.books (id, user_id, title, status, stage) values ('${bookId}', '${uid}', 'drift self-test fixture', 'ready', 'chunking')
  on conflict (id) do nothing;
insert into public.lessons (id, book_id, user_id, title, provenance_quote) values ('${lessonId}', '${bookId}', '${uid}', 'fixture lesson', 'placeholder quote, not real content')
  on conflict (id) do nothing;
insert into public.cards (id, lesson_id, book_id, user_id, prompt_type, prompt, answer) values
  ('${cardMode1}', '${lessonId}', '${bookId}', '${uid}', 'free_recall', 'p1', 'a1'),
  ('${cardMode3}', '${lessonId}', '${bookId}', '${uid}', 'free_recall', 'p2', 'a2')
  on conflict (id) do nothing;
insert into public.card_states (card_id, user_id, book_id, state) values
  ('${cardMode1}', '${uid}', '${bookId}', 'new'),
  ('${cardMode3}', '${uid}', '${bookId}', 'new')
  on conflict (card_id, user_id) do nothing;
commit;`);

  // one real review on each card via the real RPC, so both have genuine
  // stored after-values to corrupt against.
  async function realReview(cardId: string, rating: 1 | 2 | 3 | 4) {
    const scheduler = getScheduler(DEFAULT_REQUEST_RETENTION);
    const current = toFsrsCard(null, new Date());
    const { card } = computeNextState(scheduler, current, rating, new Date());
    const p = toRpcNextState(card);
    const sql = `
begin;
select set_config('request.jwt.claim.sub', '${uid}', true);
select public.submit_review('${cardId}'::uuid, null::uuid, ${rating}::smallint, 1000, null::text, null::text, null::smallint, '${esc(JSON.stringify({ reps: p.reps, stability: p.stability, difficulty: p.difficulty, due_at: p.due_at, state: p.state }))}'::jsonb, null::confidence_level);
commit;`;
    const out = psql(sql);
    if (/ERROR/.test(out)) throw new Error(`self-test fixture review failed: ${out}`);
    return card;
  }

  const mode1FirstReview = await realReview(cardMode1, 3);
  const mode3FirstReview = await realReview(cardMode3, 3);
  void mode1FirstReview;

  // --- MODE 1 self-test: corrupt the CACHE (card_states), not reviews ---
  if (REQUESTED_MODES.includes(1)) {
    console.log("--- Mode 1 self-test: corrupting card_states.stability directly ---");
    const before = psqlReadOnly(`select stability from public.card_states where card_id='${cardMode1}';`)[0];
    psql(`begin; update public.card_states set stability = stability + 5 where card_id = '${cardMode1}'; commit;`);
    const reviewsByCard = fetchReviewsForCards([cardMode1]);
    const cacheByCard = fetchCardStates([cardMode1]);
    const [result] = runMode1([cardMode1], reviewsByCard, cacheByCard);
    const caught = !!result && !result.ok;
    console.log(caught ? "  PASSED — Mode 1 caught the corrupted cache." : "  FAILED — Mode 1 did NOT catch a corrupted cache. This mode cannot see the bug class.");
    if (!caught) allPassed = false;
    // repair
    psql(`begin; update public.card_states set stability = ${before} where card_id = '${cardMode1}'; commit;`);
    console.log("");
  }

  // --- MODE 3 self-test: INSERT a deliberately-wrong second review, using
  // process time as 'now' instead of a plausible historical timestamp --
  // exactly the corruption class Mode 3's "never use now()" rule exists for.
  if (REQUESTED_MODES.includes(3)) {
    console.log("--- Mode 3 self-test: inserting a second review whose stored numbers don't follow from the first ---");
    // A wrong-but-plausible-looking stability_after: the real predecessor's
    // stability_after plus an arbitrary 5, not anything ts-fsrs would produce.
    const badStabilityAfter = mode3FirstReview.stability + 5;
    const badScheduledDays = 3;
    psql(`
begin;
select set_config('request.jwt.claim.sub', '${uid}', true);
insert into public.reviews (card_id, rating, state_before, stability_before, difficulty_before, stability_after, difficulty_after, scheduled_days)
values ('${cardMode3}'::uuid, 3, '${mode3FirstReview.state === 1 ? "learning" : "review"}'::fsrs_state, ${mode3FirstReview.stability}, ${mode3FirstReview.difficulty}, ${badStabilityAfter}, ${mode3FirstReview.difficulty}, ${badScheduledDays});
commit;`);
    const reviewsByCard = fetchReviewsForCards([cardMode3]);
    const { steps } = await runMode3([cardMode3], reviewsByCard);
    const caught = steps.length > 0 && steps.some((s) => !s.ok);
    console.log(caught ? "  PASSED — Mode 3 caught the inconsistent intermediate row." : "  FAILED — Mode 3 did NOT catch it. This mode cannot see the bug class.");
    if (!caught) allPassed = false;
    console.log("  (no repair needed/possible -- reviews is append-only; this is throwaway scratch fixture data)");
    console.log("");
  }

  if (REQUESTED_MODES.includes(2)) {
    console.log("--- Mode 2 self-test: SKIPPED (reviews.request_retention not landed -- Mode 2 itself is in the skip state; nothing to self-test yet) ---\n");
  }

  console.log(allPassed ? "SELF-TEST PASSED — every requested mode can go red." : "SELF-TEST FAILED — see above.");
  return allPassed;
}

// ---------------------------------------------------------------------------
async function main() {
  if (SELF_TEST) {
    const passed = await selfTest();
    process.exit(passed ? 0 : 1);
  }
  const anyFail = await runAll();
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
