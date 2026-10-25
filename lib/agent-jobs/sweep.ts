import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Lapsed leases back to pending, overdue jobs expired, old finished jobs deleted (migration 277's sweep_agent_jobs). Run with the service client once per ingestion poll. Never throws. */
export async function sweepAgentJobs(serviceClient: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await serviceClient.rpc("sweep_agent_jobs");
    return error ? 0 : Number(data) || 0;
  } catch {
    return 0;
  }
}
