import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localWeekday } from "@/lib/date-utils";
import { getOpenWorries, getHandledWorries } from "@/lib/night-plan/worries";
import { WorriesPageClient } from "@/components/worries/worries-page-client";

/**
 * The Worry List (#42) — a real surface for `captureDump({source:"worry"})`,
 * which previously had zero readers. See `lib/night-plan/worries.ts` for the
 * query-shape fix (found by kind, never by `planned_date`) and
 * `app/(app)/worries/actions.ts` for how "Handled" is represented.
 *
 * P2-12 adds the Monday Anti-Worry Hour panel on top: `isMonday` is computed
 * HERE, server-side, from the caller's own stored timezone via
 * `localWeekday` — never a raw `Date`'s own `getDay()`, which would read
 * the SERVER's day, not the user's (AGENTS.md's calendar-date rule; the
 * exact class of bug this app has shipped from before).
 *
 * Reachable today by direct URL. This track does not own `components/shell`
 * (the sidebar's nav items live there), so wiring a nav entry is a
 * coordination item for whoever does — flagged in the build report rather
 * than worked around by editing a file outside this track's ownership.
 */
export default async function WorriesPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [open, handled, profile] = await Promise.all([
    getOpenWorries(supabase, user.id),
    getHandledWorries(supabase, user.id),
    getProfile(),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const isMonday = localWeekday(new Date(), timezone) === "Monday";

  return (
    <PageContainer>
      <PageHeader title="Worries" />
      <WorriesPageClient open={open} handled={handled} isMonday={isMonday} />
    </PageContainer>
  );
}
