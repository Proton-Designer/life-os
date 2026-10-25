import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, getWeekStartDate, resolveLocalTime } from "@/lib/date-utils";
import type { Database } from "@/lib/supabase/database.types";
import { gatewayChat } from "@/lib/ai/gateway";
import { getHoursByKindForRange, getEndedRecallMinutesForRange } from "@/lib/evening-close/hours-today";
import { getDistractionPareto } from "./pareto";
import { getHabitWeeklySummaries } from "./habit-summary";
import { getMostRecentCompletedWeek } from "./week-range";

type TypedClient = SupabaseClient<Database>;

/**
 * Phase 2 #P2-03 — CollegeOS's AI weekly narrative, shown on the Sunday
 * Weekly Review screen (app/(app)/weekly-review/page.tsx) on top of the
 * numbers that screen already surfaces without AI text (roadmap's own
 * framing: "the Sunday review screen already surfaces the numbers without
 * AI text"). Same claim-first idempotency shape as
 * lib/ai/morning-brief.ts's `ai_morning_briefs` (migration 182), against
 * this feature's own `collegeos_weekly_narratives` table (migration 191).
 *
 * INPUTS ARE THE SAME READERS THE PAGE ITSELF CALLS: getHoursByKindForRange,
 * getEndedRecallMinutesForRange, getDistractionPareto,
 * getHabitWeeklySummaries — all already typed `SupabaseClient<Database>`
 * (not hardcoded to a request-scoped cookie client), so unlike P2-02's
 * morning brief (which could not reuse Home's own stack for exactly that
 * reason), this narrative describes EXACTLY what the page shows, computed
 * the same way, never a parallel or approximate figure.
 *
 * WHICH PROVIDER/TIER: `gatewayChat` is called with BOTH omitted — same
 * ruling as morning-brief.ts and question-draft-generation.ts: an optional,
 * dismissible, user-requested-cadence narrative rides the user's own saved
 * preference rather than a forced-cheap override.
 */

/** `collegeos_weekly_narratives` isn't in generated database.types.ts yet (migration 191 not applied at the time this file was written) -- same local escape hatch lib/ai/morning-brief.ts / lib/ai/preferences.ts already established. Delete once types regenerate. */
function untypedFrom(supabase: TypedClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

const SYSTEM_PROMPT =
  "You write a short weekly reflection for a personal productivity app, covering school/study/focus and habits. " +
  "Reply with EXACTLY three to five sentences of plain text, no markdown, no emoji, no numbering, no preamble. " +
  "Be specific to the numbers given, warm but not saccharine, and end with one forward-looking note for the week ahead.";

function isWithinGenerationWindow(now: Date, timezone: string, todayStr: string): boolean {
  const windowStart = resolveLocalTime(todayStr, "04:00", timezone);
  const windowEnd = resolveLocalTime(todayStr, "09:00", timezone);
  return now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export interface WeeklyNarrativeInputs {
  deepWorkMinutes: number;
  deepStudyMinutes: number;
  recallMinutes: number;
  topDistraction: { label: string; count: number } | null;
  habitsVotedCount: number;
  habitsTotalCount: number;
}

export async function computeWeeklyNarrativeInputs(
  supabase: TypedClient,
  userId: string,
  weekStartDate: string,
  weekEndDateExclusive: string,
  todayStr: string,
  timezone: string,
): Promise<WeeklyNarrativeInputs> {
  const startIso = resolveLocalTime(weekStartDate, "00:00", timezone).toISOString();
  const endIso = resolveLocalTime(weekEndDateExclusive, "00:00", timezone).toISOString();

  const [hours, recallMinutes, pareto, habitSummaries] = await Promise.all([
    getHoursByKindForRange(supabase, userId, startIso, endIso, new Date()),
    getEndedRecallMinutesForRange(supabase, userId, startIso, endIso),
    getDistractionPareto(supabase, userId),
    getHabitWeeklySummaries(supabase, userId, weekStartDate, weekEndDateExclusive, todayStr, timezone),
  ]);

  const topDistraction = pareto.length > 0 ? { label: pareto[0]!.label, count: pareto[0]!.count } : null;

  return {
    deepWorkMinutes: hours.byKind.deep_work ?? 0,
    deepStudyMinutes: hours.byKind.deep_study ?? 0,
    recallMinutes,
    topDistraction,
    habitsVotedCount: habitSummaries.filter((h) => h.votesThisWeek > 0).length,
    habitsTotalCount: habitSummaries.length,
  };
}

function buildNarrativeUserMessage(inputs: WeeklyNarrativeInputs): string {
  const lines = [
    `Deep work: ${inputs.deepWorkMinutes} minutes this week.`,
    `Deep study: ${inputs.deepStudyMinutes} minutes this week.`,
    `Retrieval recall practice: ${inputs.recallMinutes} minutes this week.`,
    inputs.topDistraction
      ? `Most common distraction this week (all-time ranking): "${inputs.topDistraction.label}" (${inputs.topDistraction.count} times).`
      : "No distractions logged.",
    inputs.habitsTotalCount > 0
      ? `Habits: voted for ${inputs.habitsVotedCount} of ${inputs.habitsTotalCount} active habits at least once this week.`
      : "No active habits being tracked.",
  ];
  return lines.join(" ");
}

/** Trims a degenerate empty reply -- unlike morning-brief.ts's strict 3-line format, this is free prose, so there's no per-line reshaping to do, only a genuinely-empty-after-trim guard. */
export function normalizeNarrativeText(raw: string): string {
  return raw.trim();
}

export type GenerateWeeklyNarrativeResult = { ok: true; narrativeText: string; provider: string; model: string } | { ok: false; reason: string };

export async function generateWeeklyNarrative(
  supabase: TypedClient,
  userId: string,
  inputs: WeeklyNarrativeInputs,
): Promise<GenerateWeeklyNarrativeResult> {
  const res = await gatewayChat(
    supabase,
    userId,
    "weekly_narrative",
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildNarrativeUserMessage(inputs) },
    ],
    { maxTokens: 300 },
  );
  if (!res.ok || !res.content) {
    return { ok: false, reason: res.message ?? "No content returned." };
  }
  const narrativeText = normalizeNarrativeText(res.content);
  if (!narrativeText) {
    return { ok: false, reason: "Model reply was empty after normalization." };
  }
  return { ok: true, narrativeText, provider: res.keySource ?? "unknown", model: "" };
}

async function claimNarrativeSlot(supabase: TypedClient, userId: string, weekStart: string): Promise<boolean> {
  const { error } = await untypedFrom(supabase, "collegeos_weekly_narratives").insert({ user_id: userId, week_start: weekStart });
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return true;
}

async function releaseNarrativeSlot(supabase: TypedClient, userId: string, weekStart: string): Promise<void> {
  const { error } = await untypedFrom(supabase, "collegeos_weekly_narratives").delete().eq("user_id", userId).eq("week_start", weekStart).is("narrative_text", null); // only a claim never filled: an agent-written narrative (migration 275) has text and stays
  if (error) throw error;
}

async function fillNarrativeSlot(
  supabase: TypedClient,
  userId: string,
  weekStart: string,
  result: { narrativeText: string; provider: string; model: string },
  now: Date,
): Promise<void> {
  const { error } = await untypedFrom(supabase, "collegeos_weekly_narratives")
    .update({ narrative_text: result.narrativeText, provider: result.provider, model: result.model, generated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .is("narrative_text", null); // fill only the empty claim: an agent-written narrative that landed after the claim wins
  if (error) throw error;
}

export interface DispatchWeeklyNarrativesResult {
  usersChecked: number;
  generated: number;
}

/**
 * The per-user loop — same claim-first shape as
 * `dispatchNightlyMorningBriefs`. Only fires on the Sunday the week just
 * ended, inside the same [04:00, 09:00) local window the morning brief and
 * ULM weekly recap both use — ready before a typical wake time. One user's
 * failure (a thrown query or an unexpected exception outside gatewayChat's
 * normal ok:false path) is caught and logged, and the claim is best-effort
 * released, rather than allowed to abort the batch for every other user or
 * leave that user's week permanently wedged behind a claimed-but-never-
 * filled row.
 */
export async function dispatchCollegeOsWeeklyNarratives(supabase: TypedClient, now: Date): Promise<DispatchWeeklyNarrativesResult> {
  const { data: profileRows, error: profileError } = await supabase.from("profiles").select("user_id, timezone");
  if (profileError) throw profileError;
  const profiles = (profileRows ?? []) as { user_id: string; timezone: string | null }[];

  let generated = 0;
  for (const profile of profiles) {
    const timezone = profile.timezone ?? "UTC";
    const todayStr = localDateString(now, timezone);
    if (getWeekStartDate(todayStr) !== todayStr) continue; // not this user's local Sunday
    if (!isWithinGenerationWindow(now, timezone, todayStr)) continue;

    const weekRange = getMostRecentCompletedWeek(todayStr);

    try {
      if (!(await claimNarrativeSlot(supabase, profile.user_id, weekRange.startDate))) continue;

      const inputs = await computeWeeklyNarrativeInputs(
        supabase,
        profile.user_id,
        weekRange.startDate,
        weekRange.endDateExclusive,
        todayStr,
        timezone,
      );
      const result = await generateWeeklyNarrative(supabase, profile.user_id, inputs);

      if (!result.ok) {
        await releaseNarrativeSlot(supabase, profile.user_id, weekRange.startDate);
        continue;
      }

      await fillNarrativeSlot(supabase, profile.user_id, weekRange.startDate, result, now);
      generated++;
    } catch (e) {
      console.error(`[collegeos-weekly-narrative] failed for user ${profile.user_id}:`, e instanceof Error ? e.message : e);
      try {
        await releaseNarrativeSlot(supabase, profile.user_id, weekRange.startDate);
      } catch {
        // Already logged the primary failure above; a release failure on
        // top of it is not worth a second error path here.
      }
    }
  }

  return { usersChecked: profiles.length, generated };
}

/** The Weekly Review page's own read — RLS-scoped, no service role needed. Null for every indistinguishable-by-design reason (not yet generated, no key, cap hit, provider failure), same posture as getMorningBriefForToday. */
export async function getCollegeOsWeeklyNarrative(supabase: TypedClient, userId: string, weekStart: string): Promise<string | null> {
  const { data, error } = await untypedFrom(supabase, "collegeos_weekly_narratives")
    .select("narrative_text")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle()
    .returns<{ narrative_text: string | null } | null>();
  if (error || !data) return null;
  return data.narrative_text;
}
