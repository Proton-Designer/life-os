import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getReviewItems } from "@/lib/distractions/queries";
import { isReviewOpen, reviewDateFor } from "@/lib/distractions/plan-rules";
import { ReviewClient } from "@/components/distractions/review-client";

// Formats a plain YYYY-MM-DD (already the LOCAL date reviewDateFor picked —
// see plan-rules.ts's 4am tail) into "Saturday 23 Aug". Deliberately formats
// in UTC against a noon instant rather than the user's own timezone: the
// date string is already the correct local calendar date, and re-running it
// through timezone conversion could shift it a day in either direction.
function formatReviewDateHeader(dateStr: string): string {
  const noon = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(noon);
}

export default async function ReviewPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();

  // Someone navigating here directly (not via the topbar's conditionally-
  // shown button) before 9pm/after the 4am tail gets sent home rather than
  // an empty or stale review — isReviewOpen and reviewDateFor share the
  // same window by construction (plan-rules.ts).
  if (!isReviewOpen(now, timezone)) redirect("/");

  const reviewDate = reviewDateFor(now, timezone);
  const supabase = await createClient();
  const groups = await getReviewItems(supabase, user.id, reviewDate);

  return (
    <PageContainer>
      <PageHeader title={`Review · ${formatReviewDateHeader(reviewDate)}`} />
      <ReviewClient groups={groups} />
    </PageContainer>
  );
}
