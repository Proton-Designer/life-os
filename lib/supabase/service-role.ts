import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The service-role client — bypasses RLS entirely, same posture as every
 * other `service_role`-only caller in this schema (the worker, migration
 * backfill helpers). `claim_ingestion_job`/`advance_ingestion_cursor` (109)
 * and writes to `ingestion_job_stage_attempts` (107) are all
 * `revoke ... from public; grant ... to service_role` — there is no path to
 * call them with a user-session client, by design.
 *
 * No cookies, no session — this is worker-internal, called by a route
 * handler acting as the worker, never on behalf of a signed-in user's own
 * request. Never import this from anything that also imports
 * `lib/supabase/server.ts`'s `createClient` for the SAME request without a
 * clear reason: mixing an RLS-bypassing client into a user-facing code path
 * is exactly the kind of thing this project's own RLS-sweep incidents (058,
 * 086, 100/101) exist to prevent one layer up from.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable.");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
