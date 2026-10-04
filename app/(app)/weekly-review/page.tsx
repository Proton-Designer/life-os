import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/auth";
import { weeklyReviewRedirectTarget } from "@/lib/week/reset-window";

/**
 * Retired as a screen (IA-P3a): the weekly review is the Insights "Week" tab, and the reset flow
 * (/week) takes over while its Sunday window is open. Kept as a redirect so bookmarks and old
 * links keep working; nothing was deleted.
 */
export default async function WeeklyReviewRedirect({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const profile = await getProfile();
  redirect(weeklyReviewRedirectTarget(new Date(), profile?.timezone ?? "UTC", view));
}
