"use server";

import { createClient } from "@/lib/supabase/server";
import { localDateString } from "@/lib/date-utils";
import { getCheckinOptions } from "@/lib/checkins/get-checkin-options";
import { revalidatePath } from "next/cache";
import type { CheckinOption, CheckinTagType } from "@/lib/checkins/types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

export async function answerCheckin(
  checkinTime: string,
  tagType: CheckinTagType,
  tagLabel: string,
  tagRefId: string | null
): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("checkins").insert({
    user_id: userId,
    checkin_time: checkinTime,
    tag_type: tagType,
    tag_label: tagLabel,
    tag_ref_id: tagRefId,
    answered: true,
  });
  if (error) throw error;
  revalidatePath("/");
}

/**
 * A snooze doesn't record anything — it isn't an answer, and the spec's
 * grace period means an unanswered check-in stays answerable until the next
 * one fires regardless. The actual "remind me in 15" rescheduling is
 * client-side state (Task 10.3's scheduler), not persisted history. Kept as
 * a Server Action per the plan's interface, in case a future need arises
 * (e.g. logging snooze frequency) without changing the call site.
 */
export async function snoozeCheckin(_checkinTime: string, _minutes: 15): Promise<void> {
  await requireUser();
}

/**
 * Auto-recorded once a check-in slot's grace period has expired (a newer
 * slot has since fired). tag_type/tag_label/tag_ref_id are all null —
 * nothing was selected — which the ratio calculations already skip via
 * `answered = true` filtering regardless of tag_type.
 */
export async function recordMissedCheckin(checkinTime: string): Promise<void> {
  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("checkins").insert({
    user_id: userId,
    checkin_time: checkinTime,
    tag_type: null,
    tag_label: null,
    tag_ref_id: null,
    answered: false,
  });
  if (error) throw error;
}

/** Client-callable wrapper — CheckinScheduler (Task 10.3) can't call the server-only getCheckinOptions directly. */
export async function getCheckinOptionsForNow(nowIso: string): Promise<CheckinOption[]> {
  const { userId } = await requireUser();
  return getCheckinOptions(userId, new Date(nowIso));
}

export async function skipCheckinsToday(): Promise<void> {
  const { supabase, userId } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const today = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { error } = await supabase
    .from("profiles")
    .update({ paused_date: today })
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/");
}
