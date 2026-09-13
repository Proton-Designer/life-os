import "server-only";
import { PROVIDERS, type ProviderId } from "./providers";

/**
 * DeepSeek's `GET /user/balance` -- REAL ground truth on the account's
 * remaining dollars, as opposed to `lib/ai/usage-log.ts`'s own running total
 * (which is only as correct as every call actually being logged). Verified
 * live 2026-09-13 against the real key: `{"is_available":true,
 * "balance_infos":[{"currency":"USD","total_balance":"1.98",
 * "granted_balance":"0.00","topped_up_balance":"1.98"}]}` -- note every
 * dollar figure is a STRING, not a number.
 *
 * NOT used to gate every gateway call (see `lib/ai/spend-cap.ts`'s own
 * header for why the cap is log-based, not live-balance-based): a network
 * round trip to a third party on every request is a latency and reliability
 * cost the log-based cap doesn't pay, and DeepSeek's own balance endpoint
 * has no documented uptime/rate-limit guarantee to lean on for something
 * that gates every user-facing call. This exists for RECONCILIATION --
 * proving the log-based total hasn't drifted from reality (used directly in
 * this build's own real-API verification, before/after) -- and could later
 * back a periodic drift-check job, not an inline gate.
 */
export interface DeepSeekBalance {
  currency: string;
  totalBalanceUsd: number;
  isAvailable: boolean;
}

export async function getDeepSeekBalance(apiKey: string): Promise<DeepSeekBalance | null> {
  const provider: ProviderId = "deepseek";
  try {
    const res = await fetch(`${PROVIDERS[provider].baseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: { currency?: string; total_balance?: string }[];
    };
    const info = json.balance_infos?.[0];
    if (!info?.total_balance) return null;
    const totalBalanceUsd = Number(info.total_balance);
    if (!Number.isFinite(totalBalanceUsd)) return null;
    return { currency: info.currency ?? "USD", totalBalanceUsd, isAvailable: json.is_available ?? false };
  } catch {
    return null;
  }
}
