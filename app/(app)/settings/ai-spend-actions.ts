"use server";

import { requireUser } from "@/lib/supabase/auth";
import { updateProfile } from "./actions";
import {
  resolveMonthlySpendCapContext,
  monthWindowUtc,
  DEFAULT_MONTHLY_SPEND_CAP_USD,
} from "@/lib/ai/monthly-spend-cap";
import { getDefaultUsageStore } from "@/lib/ai/usage-log";

export interface MyMonthlySpendStatus {
  /** null only when the usage log itself couldn't be read (see usage-log.ts's fail-closed Infinity) -- the UI shows "unavailable," never a fabricated $0. */
  spentUsd: number | null;
  capUsd: number;
  monthKey: string;
}

/**
 * Display-only read for the Settings page's spend-ceiling card. Unlike
 * `checkMonthlySpendCap` (lib/ai/monthly-spend-cap.ts, gatewayChat's own
 * gate), this does NOT fail closed on a profile-read failure -- nothing
 * downstream of a settings-page render spends money, so a hiccup here
 * degrades to the same UTC/$10 default `resolveMonthlySpendCapContext`
 * already returns for a missing profile row, rather than erroring the whole
 * panel. See that function's own header for why the two callers can share
 * one resolution path with different failure postures.
 */
export async function getMyMonthlySpendStatus(): Promise<MyMonthlySpendStatus> {
  const { supabase, userId } = await requireUser();
  const context = await resolveMonthlySpendCapContext(supabase, userId);
  const timezone = context.ok ? context.timezone : "UTC";
  const capUsd = context.ok ? context.capUsd : DEFAULT_MONTHLY_SPEND_CAP_USD;
  const { startUtc, endUtc, monthKey } = monthWindowUtc(new Date(), timezone);
  const spentUsd = await getDefaultUsageStore().monthlySpendUsdForUser(userId, startUtc, endUtc);
  return { spentUsd: Number.isFinite(spentUsd) ? spentUsd : null, capUsd, monthKey };
}

/** `null` reverts to the system default ($10.00, DEFAULT_MONTHLY_SPEND_CAP_USD) rather than removing the cap -- there is no unlimited option, see migration 181's own header. */
export async function saveMyMonthlySpendCapUsd(capUsd: number | null): Promise<{ ok: boolean; message: string }> {
  try {
    await updateProfile({ ai_monthly_spend_cap_usd: capUsd });
    return { ok: true, message: capUsd === null ? `Reverted to the $${DEFAULT_MONTHLY_SPEND_CAP_USD.toFixed(2)} default.` : "Budget saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save that budget. Try again." };
  }
}
