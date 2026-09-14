"use server";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const CONFIRMATION_PHRASE = "DELETE";

/**
 * #32: irreversible account deletion — the other half of the export route in
 * this same directory. The user must retype "DELETE" exactly, enforced HERE,
 * server-side, not just as a disabled-button affordance in
 * delete-account-section.tsx — a client-only gate is not real confirmation
 * for something unrecoverable (devtools, a stale bundle, or a scripted call
 * would all bypass a client-only check).
 *
 * Deletes via the Supabase ADMIN API (`createServiceRoleClient` — bypasses
 * RLS by design, same posture as every other service-role caller in this
 * codebase: lib/mcp/*, the ingestion worker), never a raw
 * `DELETE FROM auth.users`. This is the officially supported path and also
 * tears down Supabase's own internal auth.* bookkeeping (sessions,
 * identities, refresh tokens) — not just this schema's public tables.
 *
 * #32's own audit queried pg_constraint for every one of the 77 public
 * tables carrying a user_id column: every single one (bar one 0-row,
 * no-FK-at-all migration artifact — migration_115_orphaned_group_weight_log,
 * not a real per-user table) has `user_id` FOREIGN KEY ... REFERENCES
 * auth.users(id) ON DELETE CASCADE. Deleting the auth.users row therefore
 * cascades the account's entire footprint in ONE statement — there is no
 * per-table cleanup to hand-roll here, and hand-rolling one would only add a
 * second place that audit could drift out of sync with the schema again.
 */
export async function deleteMyAccount(confirmation: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (confirmation.trim() !== CONFIRMATION_PHRASE) {
    return { ok: false, error: `Type "${CONFIRMATION_PHRASE}" exactly to confirm.` };
  }

  const { userId } = await requireUser();

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return { ok: false, error: error.message };
  }

  // Best-effort local cookie clear — the account is already gone server-side
  // regardless of whether this succeeds (a stale cookie for a deleted user
  // fails auth on the very next request anyway), so a failure here must
  // never be reported back as the deletion itself having failed.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // see above — deletion already succeeded, this is cleanup only.
  }

  return { ok: true };
}
