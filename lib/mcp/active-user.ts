import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * R4a (PROGRAM-PLAN.md) — the deliberately separate step verifyAccessToken's
 * own comment warns a caller not to skip: a locally-signed ES256 session
 * JWT bypasses GoTrue entirely, so GoTrue's own banned/deleted/disabled
 * checks never run on the mint path. This function IS that check, called
 * explicitly between "token verified" and "session minted" — never folded
 * into verifyAccessToken itself, so it stays impossible to reach the mint
 * step without having gone through it.
 *
 * FAILS CLOSED: any ambiguity (lookup error, user simply not found) is
 * treated as "not active". A false negative costs a legitimate caller one
 * retry; a false positive hands a session to an account that shouldn't have
 * one, which is the entire failure mode this function exists to prevent.
 *
 * `supabase` MUST be a service-role client — `auth.admin.getUserById` is a
 * privileged Admin API call, not something an RLS-scoped client can make.
 */
export async function isUserActive(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) return false;

  const user = data.user;
  if (user.deleted_at) return false;
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) return false;
  return true;
}
