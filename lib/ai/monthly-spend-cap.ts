import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, resolveLocalTime, addMonthsToDateString } from "@/lib/date-utils";
import { estimateMultiProviderWorstCaseCostUsd } from "./pricing";
import { getDefaultUsageStore, type UsageStore } from "./usage-log";
import type { ProviderId } from "./providers";

/**
 * Per-user, monthly, personal AI spend ceiling — enforced by `gatewayChat`
 * (lib/ai/gateway.ts) alongside, and independently of, `spend-cap.ts`'s
 * global lifetime cap on the shared operator DeepSeek balance. See that
 * file's own header for why the two are deliberately separate concerns:
 * that one protects OUR money on the shared key only; this one protects
 * the USER's own money on ANY key source (their own key spends their own
 * money just as really as the shared key spends ours), reset every
 * calendar month in the USER'S OWN timezone, not UTC.
 *
 * DEFAULT-BY-ABSENCE, NEVER UNLIMITED: `profiles.ai_monthly_spend_cap_usd`
 * (migration 181) is nullable, and NULL means "use
 * DEFAULT_MONTHLY_SPEND_CAP_USD," not "no ceiling" — matching this app's
 * founding rule that every opt-in AI setting degrades to a safe default.
 *
 * ABSENCE VS. FAILURE, same discipline as preferences.ts (the Lead's fix,
 * 2026-09-15, this same session): a profile row that genuinely can't be
 * read is NOT the same as one with a null cap. A null cap is the normal,
 * safe default. A read that errors is a failure to answer the question at
 * all, and this IS a spend cap — the exact class of check spend-cap.ts's
 * own header argues must fail CLOSED, not silently degrade to "assume
 * $10 and keep going," because that would let the one scenario a cap
 * exists to catch (overspend) slip through unnoticed during precisely the
 * window the read is broken.
 *
 * PRE-FLIGHT, WORST-CASE ESTIMATE, same shape as checkSpendCap: admission
 * is decided against `spentSoFar + thisCall'sWorstCase > capUsd`, since
 * actual cost is only known after the call completes.
 */

export const DEFAULT_MONTHLY_SPEND_CAP_USD = 10.0;

export interface MonthWindow {
  /** Inclusive UTC instant the user's local calendar month started. */
  startUtc: Date;
  /** Exclusive UTC instant the NEXT local calendar month starts. */
  endUtc: Date;
  /** "YYYY-MM" in the user's own timezone — for messages/logging, not query logic. */
  monthKey: string;
}

/** `[startUtc, endUtc)` for the local calendar month containing `now`, in `timezone`. DST-safe: each boundary is resolved independently via `resolveLocalTime`, which recomputes the UTC offset for its own instant rather than reusing one offset across the whole month. */
export function monthWindowUtc(now: Date, timezone: string): MonthWindow {
  const localDate = localDateString(now, timezone);
  const monthKey = localDate.slice(0, 7);
  const monthStartDateStr = `${monthKey}-01`;
  const nextMonthStartDateStr = addMonthsToDateString(monthStartDateStr, 1);
  return {
    startUtc: resolveLocalTime(monthStartDateStr, "00:00", timezone),
    endUtc: resolveLocalTime(nextMonthStartDateStr, "00:00", timezone),
    monthKey,
  };
}

interface ProfileCapRow {
  timezone: string | null;
  ai_monthly_spend_cap_usd: number | string | null;
}

export type MonthlySpendCapContext = { ok: true; timezone: string; capUsd: number } | { ok: false; reason: string };

/**
 * Resolves the two profile-sourced inputs the monthly cap needs. Split out
 * from `checkMonthlySpendCap` so gateway.ts and the settings-page display
 * action (`getMyMonthlySpendStatus`) share exactly one read path — the
 * display action does NOT need this to fail closed the way gatewayChat
 * does (an unreadable row there just shows a blank card, spends no money),
 * but both need the SAME timezone/cap resolution so the number a user sees
 * in Settings is the same number gatewayChat actually gates on.
 */
export async function resolveMonthlySpendCapContext(supabase: SupabaseClient, userId: string): Promise<MonthlySpendCapContext> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("timezone, ai_monthly_spend_cap_usd")
      .eq("user_id", userId)
      .maybeSingle<ProfileCapRow>();
    if (error) {
      return { ok: false, reason: `Couldn't read your AI spend settings: ${error.message}` };
    }
    if (!data) {
      // No profile row is a genuine anomaly for an authenticated user (every
      // signup creates one) rather than a normal "not chosen yet" state the
      // way an absent preferences row is — but it still isn't a MONEY
      // failure (nothing was mis-measured), so it degrades to the system
      // default + UTC rather than failing closed, matching
      // due-card-notification.ts's own fallback for the same missing-row case.
      return { ok: true, timezone: "UTC", capUsd: DEFAULT_MONTHLY_SPEND_CAP_USD };
    }
    const capUsd = data.ai_monthly_spend_cap_usd === null ? DEFAULT_MONTHLY_SPEND_CAP_USD : Number(data.ai_monthly_spend_cap_usd);
    return { ok: true, timezone: data.timezone ?? "UTC", capUsd: Number.isFinite(capUsd) && capUsd > 0 ? capUsd : DEFAULT_MONTHLY_SPEND_CAP_USD };
  } catch (e) {
    return { ok: false, reason: `Couldn't read your AI spend settings: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/**
 * `contextFailure` is true only when the FAILURE is "couldn't even resolve
 * the cap" (fails closed, see this file's header) rather than "resolved the
 * cap and it's exceeded" — gatewayChat uses this to decide whether the
 * refusal counts as `monthlyCapBlocked` (a real, named budget event a
 * caller might want to distinguish) or an ordinary unavailable-feature
 * message (a settings-read hiccup, not a budget event).
 */
export type MonthlySpendCapResult =
  | { allowed: true; capUsd: number; spentUsd: number; monthKey: string }
  | { allowed: false; reason: string; capUsd: number; spentUsd: number; monthKey: string; contextFailure?: false }
  | { allowed: false; reason: string; contextFailure: true };

export async function checkMonthlySpendCap(
  supabase: SupabaseClient,
  userId: string,
  provider: ProviderId,
  model: string,
  promptChars: number,
  maxTokens: number,
  opts: { store?: UsageStore; at?: Date } = {},
): Promise<MonthlySpendCapResult> {
  const context = await resolveMonthlySpendCapContext(supabase, userId);
  if (!context.ok) {
    // Fail CLOSED -- see this file's own header. No adapter call, nothing
    // logged (there is no usage to record for a call that never had a
    // resolved cap to check against).
    return { allowed: false, reason: context.reason, contextFailure: true };
  }

  const store = opts.store ?? getDefaultUsageStore();
  const now = opts.at ?? new Date();
  const { startUtc, endUtc, monthKey } = monthWindowUtc(now, context.timezone);
  const spentUsd = await store.monthlySpendUsdForUser(userId, startUtc, endUtc);
  const estimatedCallUsd = estimateMultiProviderWorstCaseCostUsd(provider, model, promptChars, maxTokens, now);
  const projected = spentUsd + estimatedCallUsd;

  if (projected > context.capUsd) {
    return {
      allowed: false,
      reason:
        `You've reached your AI budget for ${monthKey} ($${spentUsd.toFixed(2)} of $${context.capUsd.toFixed(2)} spent; ` +
        `this call could cost up to ~$${estimatedCallUsd.toFixed(4)} more). It resets at the start of next month, ` +
        `or you can raise the ceiling in Settings.`,
      capUsd: context.capUsd,
      spentUsd,
      monthKey,
    };
  }
  return { allowed: true, capUsd: context.capUsd, spentUsd, monthKey };
}
