"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getReviewItems } from "@/lib/distractions/queries";
import { isReviewOpen, reviewDateFor } from "@/lib/distractions/plan-rules";
import type { DistractionDomain, ReviewItem } from "@/lib/distractions/types";

export type ReviewData = {
  dateLabel: string;
  groups: { domain: DistractionDomain; items: ReviewItem[] }[];
};

// Deliberately formats in UTC against a noon instant rather than the user's
// own timezone: reviewDateFor already picked the correct LOCAL calendar
// date (including its own 4am-tail logic), and re-running that string
// through timezone conversion could shift it a day in either direction.
// Duplicated from app/(app)/review/page.tsx's own copy rather than shared —
// four lines of pure formatting, and the route keeps its own independent
// path for e2e/direct-link purposes.
function formatReviewDateHeader(dateStr: string): string {
  const noon = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(noon);
}

/**
 * Backs the topbar's Review popup (ReviewDialogTrigger) — the same data
 * app/(app)/review/page.tsx fetches server-side, wrapped as a Server Action
 * so a Client Component can call it directly on dialog open, matching
 * DistractionCaptureDialog's own pattern (a "use client" component
 * importing "use server" actions at module scope — no prop-threading
 * through layout.tsx needed). Returns null if the review window has closed
 * since the topbar button became visible (a narrow race, not the normal
 * path — the button itself is already gated on isReviewOpen client-side).
 */
export async function getReviewData(): Promise<ReviewData | null> {
  const user = await getAuthedUser();
  if (!user) return null;

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const now = new Date();
  if (!isReviewOpen(now, timezone)) return null;

  const reviewDate = reviewDateFor(now, timezone);
  const supabase = await createClient();
  const groups = await getReviewItems(supabase, user.id, reviewDate);

  return { dateLabel: formatReviewDateHeader(reviewDate), groups };
}
