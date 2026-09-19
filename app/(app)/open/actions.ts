"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
 *
 * REVALIDATE BEFORE REDIRECT, NOT AFTER (first-use trust bug, 2026-09-18):
 * `redirect()` works by THROWING — a `revalidatePath` call placed after it
 * is dead code that never runs. Without a revalidate, anyone who visited
 * /open/today earlier in the session (a real path — that page is documented
 * as reachable at any point in the day, not only as this redirect's target)
 * has it sitting in the client Router Cache from before today's wake mark
 * existed. This tap creates the mark, redirects there, and the cache serves
 * the STALE "Start day hasn't been tapped yet" empty state anyway — the
 * write is fine (idempotent, confirmed by a later read), but the screen
 * reads as "the button didn't work" on the very first thing a new user does
 * with Day Structure. Revalidates /open too: that page's own diff banner
 * also reads today's plan/wake state and is just as reachable from a stale
 * client cache on a repeat visit.
 */
export async function startDayAction(): Promise<void> {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const supabase = await createClient();

  await markDayStarted(supabase, user.id, timezone, new Date());
  revalidatePath("/open");
  revalidatePath("/open/today");
  redirect("/open/today");
}
