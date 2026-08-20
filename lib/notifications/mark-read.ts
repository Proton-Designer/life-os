import { createClient } from "@/lib/supabase/server";

/**
 * Idempotent at the database, not just the action: upserts with
 * `ignoreDuplicates: true` compiles to `ON CONFLICT (user_id,
 * notification_key, date) DO NOTHING` against migration 035's unique
 * index — same discipline as confirm_workout_session (029). A
 * double-click, or two tabs marking the same notification read at once,
 * must not error and must not double-write.
 *
 * `dateStr` must already be the user's own local calendar date
 * (localDateString(now, profile.timezone) — see get-notifications.ts's
 * header for why the date, not just the key, is what makes read state
 * correct). Callers own that derivation; this function just writes
 * whatever date it's given.
 */
export async function markNotificationRead(userId: string, notificationKey: string, dateStr: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_reads")
    .upsert(
      { user_id: userId, notification_key: notificationKey, date: dateStr },
      { onConflict: "user_id,notification_key,date", ignoreDuplicates: true }
    );
  if (error) throw error;
}
