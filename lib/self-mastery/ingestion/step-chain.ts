import type { SupabaseClient } from "@supabase/supabase-js";
import { untypedRpc } from "@/lib/self-mastery/untyped-from";

/**
 * Self-chaining for the ingestion step route. One poll's loop (step-loop.ts) stops after ~240 s of work. When it stopped
 * because the TIME BUDGET ran out (so work remains), the route asks the DATABASE to poke it again right away
 * (`kick_ingestion_driver`, migration 273: a pg_net POST, the same origin and request shape as the 1-minute cron) instead
 * of waiting up to a minute. pg_net is asynchronous, so this function never waits on the next run.
 *
 * Rails: chain ONLY after a 'budget' stop (the caller checks); a hop counter carried in the `x-ingestion-hop` header and
 * capped at MAX_HOPS, after which the cron resumes the work; a kill switch (INGESTION_SELF_CHAIN=off); the RPC itself
 * rate-limits (at most one kick per 20 s). A failed kick is logged, never thrown: the cron is the fallback.
 */
export const HOP_HEADER = "x-ingestion-hop";
export const MAX_HOPS = 30;

/** 0 = a poll that did not come from a kick (the cron). Malformed values count as 0; anything above the cap is clamped. */
export function parseHop(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return Math.min(n, MAX_HOPS);
}

export function chainingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.INGESTION_SELF_CHAIN !== "off";
}

/** Asks the database to kick the driver for hop `hop + 1`. Returns whether a kick was actually sent. Never throws. */
export async function kickNextHop(
  supabase: SupabaseClient,
  hop: number,
  opts: { env?: Record<string, string | undefined>; log?: (message: string) => void } = {},
): Promise<boolean> {
  const log = opts.log ?? ((m: string) => console.error(m));
  if (!chainingEnabled(opts.env)) return false;
  if (hop >= MAX_HOPS) {
    log(`[self-mastery ingestion] chain stopped at hop ${hop}: cap of ${MAX_HOPS} reached; the cron resumes the work`);
    return false;
  }
  try {
    const { data, error } = await untypedRpc<boolean>(supabase, "kick_ingestion_driver", { p_hop: hop + 1 });
    if (error) {
      log(`[self-mastery ingestion] kick_ingestion_driver failed: ${error.message}; the cron resumes the work`);
      return false;
    }
    return data === true; // false = the DB's rate guard declined (a kick was sent under 20 s ago)
  } catch (e) {
    log(`[self-mastery ingestion] kick_ingestion_driver threw: ${e instanceof Error ? e.message : String(e)}; the cron resumes the work`);
    return false;
  }
}
