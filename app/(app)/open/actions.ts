"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { markDayStarted } from "@/lib/day-structure/day-start";

/**
 * The Start Day tap (#33) — the morning open's one write, mounted directly
 * as a Server Action on the "Start day" <form> in page.tsx (no client
 * component, no function-prop across the server/client boundary).
 *
 * IDEMPOTENT: see lib/day-structure/day-start.ts's markDayStarted for the
 * database-enforced guarantee (`day_starts` unique on (user_id,
 * local_date)) — tapping this twice on the same local day never creates a
 * second mark and never moves the first one's `woke_at`.
 *
 * Always redirects to /open/today (#36, Merged Today) whether this call
 * created today's mark or one already existed from an earlier tap this
 * session — this page's own header comment cites BOSS-VISION §6: "Start
 * Day... leads to today's shape." Tap budget: landing on /open is tap one,
 * this is tap two, and it lands directly on the day-at-a-glance screen
 * rather than a third tap being required to find it.
 */
export async function startDayAction(): Promise<void> {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const supabase = await createClient();

  await markDayStarted(supabase, user.id, timezone, new Date());
  redirect("/open/today");
}
