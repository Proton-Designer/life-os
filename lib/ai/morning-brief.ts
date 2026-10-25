import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, resolveLocalTime, addDaysToDateString } from "@/lib/date-utils";
import { gatewayChat } from "./gateway";

/**
 * P2-02: a nightly, per-user, timezone-aware cron job that stores a
 * 3-line AI morning brief via `gatewayChat`, shown on Home
 * (app/(app)/page.tsx). See migration 182's own header for the
 * `ai_morning_briefs` table shape and the claim-first idempotency lock
 * this file implements against it.
 *
 * LEAN, DELIBERATELY SCOPED ANALYSIS INPUT: yesterday's completed-task
 * count + today's due-task count, from the one generic cross-domain
 * `tasks` table -- NOT Home's full HomeDataSource/getPriorityItems stack,
 * which hardcodes the request-scoped `createClient()` and has no
 * service-role-compatible construction path. Deeper cross-domain
 * synthesis (prayers, kill-list, fitness, study) is P2-03's territory
 * (weekly synthesis narratives), not duplicated here.
 *
 * WHICH PROVIDER/TIER: `gatewayChat` is called with BOTH omitted, so it
 * resolves the CALLING USER'S OWN saved preference (provider + tier) --
 * the same "correct by construction" mechanism the 2026-09-15 multi-
 * provider fix wired up (see gateway.ts's own header), NOT ingestion's
 * forced-"cheap" override (Addition A). A user who picked a flagship tier
 * for interactive features gets their brief on that same tier; this is a
 * genuinely optional, dismissible feature, not bulk background processing
 * that must protect a shared budget the way book ingestion does.
 *
 * GRACEFUL DEGRADATION: `gatewayChat` returning `ok:false` (no key, cap
 * hit, provider down) is NOT an error here -- it's the normal "this user
 * doesn't get a brief today" outcome. The claim row is released so the
 * NEXT cron tick can retry (useful if the cause was transient); Home
 * simply shows nothing when no row exists for today, indistinguishable
 * from "not generated yet" by design (see migration 182's own header).
 */

const BRIEF_WINDOW_START_LOCAL = "04:00";
/**
 * 5 hours -- wide enough to absorb several missed/late 15-minute cron
 * ticks (the SAME heartbeat #10's due-card notification already polls on,
 * see this file's dispatchNightlyMorningBriefs doc), narrow enough that a
 * genuinely missed window reads as "no brief today," never one arriving
 * at lunchtime. No per-user setting exists for this — see
 * $SD/OPEN_QUESTIONS.md's P2-02 entry for the logged assumption.
 */
const BRIEF_WINDOW_DURATION_MS = 5 * 60 * 60 * 1000;

const SYSTEM_PROMPT =
  "You write a short daily brief for a personal productivity app. Reply with EXACTLY three lines of plain text, " +
  "no markdown, no emoji, no numbering, no preamble. Line 1: one warm, specific sentence about yesterday. " +
  "Line 2: one sentence about what's ahead today; if a crowned top priority is given, name it plainly and do not invent others. Line 3: one short, genuine encouragement. " +
  "Each line under 100 characters.";

function isWithinBriefWindow(now: Date, timezone: string, briefDate: string): boolean {
  const windowStart = resolveLocalTime(briefDate, BRIEF_WINDOW_START_LOCAL, timezone);
  const windowEnd = new Date(windowStart.getTime() + BRIEF_WINDOW_DURATION_MS);
  return now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * `ai_morning_briefs` isn't in generated database.types.ts yet (migration
 * 182 not applied at the time this file was written) -- same local escape
 * hatch lib/ai/preferences.ts already established for the identical
 * reason (see that file's own header). Delete once types regenerate.
 */
function untypedFrom(supabase: SupabaseClient, table: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(table);
}

export interface NightlyBriefInputs {
  tasksCompletedYesterday: number;
  tasksDueToday: number;
  /**
   * Last night's plan for TODAY (tasks.planned_date = today, ranked by mit_rank): the crown first, then the starred
   * ones. The night plan is the one thing the user DECIDED, so the brief leads with it instead of a bare task count.
   * Empty when no plan was made (the brief then says nothing about it, never scolds).
   */
  plannedTitles: string[];
}

const MAX_PLANNED_IN_BRIEF = 3;
const MAX_TITLE_CHARS = 80;

/**
 * Direct, lean queries against `tasks` (domain-generic: school, co_op,
 * business, etc. all share this one table -- database.types.ts:3225) --
 * see this file's own header for why Home's heavier per-domain stack
 * isn't reused here.
 */
export async function computeNightlyBriefInputs(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  timezone: string,
): Promise<NightlyBriefInputs> {
  const todayStr = localDateString(now, timezone);
  const yesterdayStr = addDaysToDateString(todayStr, -1);
  const yesterdayStartIso = resolveLocalTime(yesterdayStr, "00:00", timezone).toISOString();
  const todayStartIso = resolveLocalTime(todayStr, "00:00", timezone).toISOString();

  const [{ count: completedYesterday }, { count: dueToday }, { data: planned }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("completed", true)
      .gte("completed_at", yesterdayStartIso)
      .lt("completed_at", todayStartIso),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("completed", false)
      .eq("due_date", todayStr),
    supabase
      .from("tasks")
      .select("title, mit_rank")
      .eq("user_id", userId)
      .eq("planned_date", todayStr)
      .not("mit_rank", "is", null)
      .order("mit_rank", { ascending: true })
      .limit(MAX_PLANNED_IN_BRIEF),
  ]);

  const plannedTitles = ((planned ?? []) as { title: string | null }[])
    .map((t) => (t.title ?? "").trim().slice(0, MAX_TITLE_CHARS))
    .filter((t) => t.length > 0);
  return { tasksCompletedYesterday: completedYesterday ?? 0, tasksDueToday: dueToday ?? 0, plannedTitles };
}

function buildBriefUserMessage(inputs: NightlyBriefInputs): string {
  const yesterdayLine =
    inputs.tasksCompletedYesterday > 0
      ? `Yesterday they completed ${inputs.tasksCompletedYesterday} task${inputs.tasksCompletedYesterday === 1 ? "" : "s"}.`
      : "Yesterday they didn't complete any tracked tasks.";
  const todayLine =
    inputs.tasksDueToday > 0
      ? `Today they have ${inputs.tasksDueToday} task${inputs.tasksDueToday === 1 ? "" : "s"} due.`
      : "Today they have nothing due yet.";
  // The night plan, when there is one: first title is the crown (the single most important thing), the rest are starred.
  const [crown, ...others] = inputs.plannedTitles;
  const planLine = crown
    ? ` Last night they planned today's priorities. The most important one (the crown) is: "${crown}".` +
      (others.length > 0 ? ` The others are: ${others.map((t) => `"${t}"`).join(", ")}.` : "")
    : "";
  return `${yesterdayLine} ${todayLine}${planLine}`;
}

/** At most 3 non-empty lines, trimmed -- a model that returns more (or fewer, with blank lines) must never break Home's rendering or silently show a 10-line wall of text. */
export function normalizeBriefText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join("\n");
}

export type GenerateMorningBriefResult = { ok: true; briefText: string; provider: string; model: string } | { ok: false; reason: string };

/**
 * Calls `gatewayChat` with provider/tier OMITTED (see this file's own
 * header). Does NOT write to `ai_morning_briefs` itself -- the caller
 * (`dispatchNightlyMorningBriefs`) owns the claim/fill/release sequence,
 * so this function stays a pure "ask the model" step, independently
 * testable without a fake claim table.
 */
export async function generateMorningBrief(
  supabase: SupabaseClient,
  userId: string,
  inputs: NightlyBriefInputs,
): Promise<GenerateMorningBriefResult> {
  const res = await gatewayChat(
    supabase,
    userId,
    "morning_brief",
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildBriefUserMessage(inputs) },
    ],
    { maxTokens: 150 },
  );
  if (!res.ok || !res.content) {
    return { ok: false, reason: res.message ?? "No content returned." };
  }
  const briefText = normalizeBriefText(res.content);
  if (!briefText) {
    return { ok: false, reason: "Model reply had no usable lines after normalization." };
  }
  // res.keySource proves a real call happened; provider/model aren't on
  // GatewayChatResult itself (only in the usage log), so re-derive them is
  // unnecessary -- gatewayChat's own usage-log row is the durable record of
  // exactly which provider/model this call used. Store what the record
  // needs for display (a source note), not a duplicate of that ledger.
  return { ok: true, briefText, provider: res.keySource ?? "unknown", model: "" };
}

async function claimBriefSlot(supabase: SupabaseClient, userId: string, briefDate: string): Promise<boolean> {
  const { error } = await untypedFrom(supabase, "ai_morning_briefs").insert({ user_id: userId, brief_date: briefDate });
  if (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  return true;
}

async function releaseBriefSlot(supabase: SupabaseClient, userId: string, briefDate: string): Promise<void> {
  // Only a claim that was never filled: a brief an agent wrote in between (migration 274, provider 'mcp') has text and stays.
  const { error } = await untypedFrom(supabase, "ai_morning_briefs").delete().eq("user_id", userId).eq("brief_date", briefDate).is("brief_text", null);
  if (error) throw error;
}

async function fillBriefSlot(supabase: SupabaseClient, userId: string, briefDate: string, result: { briefText: string; provider: string; model: string }, now: Date): Promise<void> {
  const { error } = await untypedFrom(supabase, "ai_morning_briefs")
    .update({ brief_text: result.briefText, provider: result.provider, model: result.model, generated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("brief_date", briefDate)
    // Fill only the empty claim: if an agent wrote today's brief after we claimed, its text wins (zero rows updated is fine).
    .is("brief_text", null);
  if (error) throw error;
}

export interface NightlyBriefDispatchResult {
  usersChecked: number;
  generated: number;
}

/**
 * The per-user loop -- same shape as
 * `dispatchDueCardNotifications` (lib/notifications/due-card-notification.ts):
 * claim-first (INSERT before the expensive step), release on any failure.
 * Polled by the SAME 15-minute pg_cron heartbeat as #10's own dispatch
 * (Lead's own instruction, INSTRUCTIONS.md §6/§11 "cron wired consistently
 * with existing jobs") via app/api/cron/nightly-morning-brief/route.ts --
 * a second `net.http_post` inside the SAME `cron.job` command, not a new
 * parallel schedule; the Lead applies that registration (operator state,
 * not a migration).
 */
export async function dispatchNightlyMorningBriefs(supabase: SupabaseClient, now: Date): Promise<NightlyBriefDispatchResult> {
  const { data: profileRows, error: profileError } = await supabase.from("profiles").select("user_id, timezone");
  if (profileError) throw profileError;
  const profiles = (profileRows ?? []) as { user_id: string; timezone: string | null }[];

  let generated = 0;
  for (const profile of profiles) {
    const timezone = profile.timezone ?? "UTC";
    const briefDate = localDateString(now, timezone);

    if (!isWithinBriefWindow(now, timezone, briefDate)) continue;

    // THE LOCK: claim before doing anything else that could race a
    // concurrent tick or spend money. A false return means someone else
    // already holds it (a real prior generation today, or a concurrent
    // tick that won) -- skip without ever calling gatewayChat.
    if (!(await claimBriefSlot(supabase, profile.user_id, briefDate))) continue;

    const inputs = await computeNightlyBriefInputs(supabase, profile.user_id, now, timezone);
    const result = await generateMorningBrief(supabase, profile.user_id, inputs);

    if (!result.ok) {
      // No key, cap hit, or a genuine provider failure -- all release the
      // claim so tomorrow's tick (or a later tick today, still inside the
      // window) can try again. Not an error: see this file's own header.
      await releaseBriefSlot(supabase, profile.user_id, briefDate);
      continue;
    }

    await fillBriefSlot(supabase, profile.user_id, briefDate, result, now);
    generated++;
  }

  return { usersChecked: profiles.length, generated };
}

/**
 * Home's own read (app/(app)/page.tsx) -- RLS-scoped (select-own policy,
 * migration 182), no service role needed. Returns null for every
 * indistinguishable-by-design reason: not yet generated today, no key,
 * cap hit, or a provider failure -- Home renders nothing in all of them.
 */
export async function getMorningBriefForToday(supabase: SupabaseClient, userId: string, now: Date, timezone: string): Promise<string | null> {
  const todayStr = localDateString(now, timezone);
  const { data, error } = await untypedFrom(supabase, "ai_morning_briefs")
    .select("brief_text")
    .eq("user_id", userId)
    .eq("brief_date", todayStr)
    .maybeSingle()
    .returns<{ brief_text: string | null } | null>();
  if (error || !data) return null;
  return data.brief_text;
}
