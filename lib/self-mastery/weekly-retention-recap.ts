import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate, addDaysToDateString, resolveLocalTime } from "@/lib/date-utils";
import { getMostRecentCompletedWeek } from "@/lib/weekly-review/week-range";
import { averageRetrievability, type CardStateForStrength } from "./memory-strength";
import { untypedFrom } from "./untyped-from";
import type { Database } from "@/lib/supabase/database.types";

type TypedClient = SupabaseClient<Database>;

/** `ulm_weekly_recaps` isn't in generated database.types.ts yet (migration 191 not applied at the time this file was written) -- same local escape hatch this domain's own untyped-from.ts already established for books/cards/card_states (now regenerated and typed) and other self-mastery tables still awaiting a types regen. Delete every `ulmWeeklyRecapsFrom` call site's use of it once types regenerate; swap for a plain `supabase.from("ulm_weekly_recaps")`. */
function ulmWeeklyRecapsFrom(supabase: TypedClient) {
  return untypedFrom(supabase, "ulm_weekly_recaps");
}

/**
 * Phase 2 #P2-03 — ULM's weekly recap (retention trend, strongest/weakest
 * book), one row per user per Sun-Sat week (`ulm_weekly_recaps`, migration
 * 191). PURE COMPUTATION, no AI call: unlike
 * `lib/weekly-review/weekly-narrative.ts`'s sibling artifact, there is
 * nothing expensive or failure-prone to protect with a claim-first/release
 * dance — the insert either succeeds once (first tick to reach it this
 * week) or hits the unique constraint (a later tick, or a race), and both
 * outcomes are fine to treat identically: "this week is already recorded."
 *
 * SNAPSHOT, NOT LIVE: `getSelfMasteryLibrary` (get-library.ts) already
 * computes each book's live `memoryStrength` on every page load — this
 * does NOT reuse that function (it hardcodes `requireUser()`'s
 * cookie-based client + React `cache()`, wrong shape for a service-role
 * cron iterating every user) but DOES reuse its underlying math
 * (`averageRetrievability`, memory-strength.ts) against the same
 * books/cards/card_states join, so "this week's retention" here and "right
 * now's retention" on the library page can never silently disagree in
 * method, only in WHEN they were computed. The weekly snapshot exists
 * specifically so "trend" has something fixed to compare against — a live
 * number can't have a trend against itself.
 */

interface BookRow {
  id: string;
  title: string;
}
interface CardRow {
  id: string;
  book_id: string;
}
interface CardStateRow {
  card_id: string;
  state: "new" | "learning" | "review" | "relearning";
  stability: number | null;
  difficulty: number | null;
  due_at: string | null;
  reps: number;
  lapses: number;
  last_review_at: string | null;
  learning_steps: number;
}

export interface BookRetention {
  id: string;
  title: string;
  retentionPct: number;
}

export interface LibraryRetentionSnapshot {
  /** Average retrievability across EVERY card in the library, as a 0-100 percentage — matches memory-strength.ts's "untouched counts as zero" rule, so a library with unreviewed cards reads lower, never excluded from the denominator. */
  overallRetentionPct: number;
  /** Only books with at least one REVIEWED card are candidates — a brand-new, never-opened book would trivially "win" weakest at 0% otherwise, which is a status, not an insight. Null when there are zero such candidates. */
  strongestBook: BookRetention | null;
  weakestBook: BookRetention | null;
}

/**
 * Same books/cards/card_states join as `getSelfMasteryLibrary`
 * (lib/self-mastery/get-library.ts), parameterized on an explicit client
 * (service-role compatible) instead of `requireUser()`.
 */
export async function computeLibraryRetentionSnapshot(
  supabase: TypedClient,
  userId: string,
  now: Date,
): Promise<LibraryRetentionSnapshot> {
  const { data: bookRows, error: booksError } = await supabase
    .from("books")
    .select("id, title")
    .eq("user_id", userId)
    .returns<BookRow[]>();
  if (booksError) throw booksError;

  const books = bookRows ?? [];
  if (books.length === 0) {
    return { overallRetentionPct: 0, strongestBook: null, weakestBook: null };
  }

  const bookIds = books.map((b) => b.id);
  const { data: cardRows, error: cardsError } = await supabase
    .from("cards")
    .select("id, book_id")
    .eq("user_id", userId)
    .in("book_id", bookIds)
    .returns<CardRow[]>();
  if (cardsError) throw cardsError;

  const cardIds = (cardRows ?? []).map((c) => c.id);
  const { data: stateRows, error: statesError } =
    cardIds.length > 0
      ? await supabase
          .from("card_states")
          .select("card_id, state, stability, difficulty, due_at, reps, lapses, last_review_at, learning_steps")
          .eq("user_id", userId)
          .in("card_id", cardIds)
          .returns<CardStateRow[]>()
      : { data: [] as CardStateRow[], error: null };
  if (statesError) throw statesError;

  const stateByCardId = new Map((stateRows ?? []).map((s) => [s.card_id, s]));
  const toStrength = (row: CardStateRow): CardStateForStrength => ({
    state: row.state,
    stability: row.stability,
    difficulty: row.difficulty,
    dueAt: row.due_at,
    reps: row.reps,
    lapses: row.lapses,
    lastReviewAt: row.last_review_at,
    learningSteps: row.learning_steps,
  });

  const cardsByBookId = new Map<string, CardRow[]>();
  for (const c of cardRows ?? []) {
    const list = cardsByBookId.get(c.book_id) ?? [];
    list.push(c);
    cardsByBookId.set(c.book_id, list);
  }

  const allCardStates: (CardStateForStrength | null)[] = [];
  const bookRetentions: BookRetention[] = [];

  for (const book of books) {
    const bookCards = cardsByBookId.get(book.id) ?? [];
    let hasReviewedCard = false;
    const thisBookStates: (CardStateForStrength | null)[] = bookCards.map((c) => {
      const row = stateByCardId.get(c.id);
      allCardStates.push(row ? toStrength(row) : null);
      if (row) hasReviewedCard = true;
      return row ? toStrength(row) : null;
    });
    if (hasReviewedCard) {
      bookRetentions.push({
        id: book.id,
        title: book.title,
        retentionPct: Math.round(averageRetrievability(thisBookStates, now) * 10_000) / 100,
      });
    }
  }

  const overallRetentionPct = Math.round(averageRetrievability(allCardStates, now) * 10_000) / 100;

  let strongestBook: BookRetention | null = null;
  let weakestBook: BookRetention | null = null;
  for (const b of bookRetentions) {
    if (!strongestBook || b.retentionPct > strongestBook.retentionPct) strongestBook = b;
    if (!weakestBook || b.retentionPct < weakestBook.retentionPct) weakestBook = b;
  }

  return { overallRetentionPct, strongestBook, weakestBook };
}

export type WeeklyRetentionTrend = "up" | "down" | "flat" | "no_data";

/** >= 1 percentage point either way counts as a real trend -- sub-point drift over a week is noise, not a story. */
const TREND_EPSILON_PCT = 1;

export function computeTrend(currentPct: number, previousPct: number | null): WeeklyRetentionTrend {
  if (previousPct === null) return "no_data";
  const delta = currentPct - previousPct;
  if (delta > TREND_EPSILON_PCT) return "up";
  if (delta < -TREND_EPSILON_PCT) return "down";
  return "flat";
}

function isWithinGenerationWindow(now: Date, timezone: string, todayStr: string): boolean {
  const windowStart = resolveLocalTime(todayStr, "04:00", timezone);
  const windowEnd = resolveLocalTime(todayStr, "09:00", timezone);
  return now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export interface DispatchUlmWeeklyRecapsResult {
  usersChecked: number;
  recorded: number;
}

/**
 * The per-user loop. Only fires on the Sunday the week just ended (today IS
 * a week-start day, per `getWeekStartDate`), inside the same
 * [04:00, 09:00) local window `lib/ai/morning-brief.ts` uses for its own
 * nightly job — ready before a typical wake time, without inventing a
 * second per-user timing setting. One user's failure (a thrown query
 * error) is caught and logged rather than aborting the whole batch — pure
 * computation for every OTHER user has no reason to depend on one user's
 * row succeeding.
 */
export async function dispatchUlmWeeklyRecaps(supabase: TypedClient, now: Date): Promise<DispatchUlmWeeklyRecapsResult> {
  const { data: profileRows, error: profileError } = await supabase.from("profiles").select("user_id, timezone");
  if (profileError) throw profileError;
  const profiles = (profileRows ?? []) as { user_id: string; timezone: string | null }[];

  let recorded = 0;
  for (const profile of profiles) {
    const timezone = profile.timezone ?? "UTC";
    const todayStr = localDateString(now, timezone);
    if (getWeekStartDate(todayStr) !== todayStr) continue; // not a Sunday for this user
    if (!isWithinGenerationWindow(now, timezone, todayStr)) continue;

    const weekRange = getMostRecentCompletedWeek(todayStr);

    try {
      const snapshot = await computeLibraryRetentionSnapshot(supabase, profile.user_id, now);
      const previousWeekStart = addDaysToDateString(weekRange.startDate, -7);
      const { data: previousRow } = await ulmWeeklyRecapsFrom(supabase)
        .select("overall_retention_pct")
        .eq("user_id", profile.user_id)
        .eq("week_start", previousWeekStart)
        .maybeSingle()
        .returns<{ overall_retention_pct: number | string } | null>();
      const previousPct = previousRow ? Number(previousRow.overall_retention_pct) : null;
      const trend = computeTrend(snapshot.overallRetentionPct, previousPct);

      const { error: insertError } = await ulmWeeklyRecapsFrom(supabase).insert({
        user_id: profile.user_id,
        week_start: weekRange.startDate,
        overall_retention_pct: snapshot.overallRetentionPct,
        trend,
        strongest_book_id: snapshot.strongestBook?.id ?? null,
        strongest_book_title: snapshot.strongestBook?.title ?? null,
        weakest_book_id: snapshot.weakestBook?.id ?? null,
        weakest_book_title: snapshot.weakestBook?.title ?? null,
      });
      if (insertError) {
        if (isUniqueViolation(insertError)) continue; // already recorded this week
        throw insertError;
      }
      recorded++;
    } catch (e) {
      console.error(`[ulm-weekly-recap] failed for user ${profile.user_id}:`, e instanceof Error ? e.message : e);
    }
  }

  return { usersChecked: profiles.length, recorded };
}

export interface UlmWeeklyRecap {
  weekStart: string;
  overallRetentionPct: number;
  trend: WeeklyRetentionTrend;
  strongestBook: { title: string } | null;
  weakestBook: { title: string } | null;
}

/** Self-Mastery's own read (RLS-scoped select-own, no service role needed). Null when nothing has been generated for that week yet (first week ever, or a tick was missed) -- the UI simply shows nothing, same graceful-absence posture as every other AI/cron-fed panel in this app. */
export async function getUlmWeeklyRecap(supabase: TypedClient, userId: string, weekStart: string): Promise<UlmWeeklyRecap | null> {
  const { data, error } = await ulmWeeklyRecapsFrom(supabase)
    .select("week_start, overall_retention_pct, trend, strongest_book_title, weakest_book_title")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle()
    .returns<{ week_start: string; overall_retention_pct: number | string; trend: string; strongest_book_title: string | null; weakest_book_title: string | null } | null>();
  if (error || !data) return null;
  return {
    weekStart: data.week_start,
    overallRetentionPct: Number(data.overall_retention_pct),
    trend: data.trend as WeeklyRetentionTrend,
    strongestBook: data.strongest_book_title ? { title: data.strongest_book_title } : null,
    weakestBook: data.weakest_book_title ? { title: data.weakest_book_title } : null,
  };
}
