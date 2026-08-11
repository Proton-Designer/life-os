import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { getPriorityItems, getTodayDateString } from "@/lib/home/get-priority-items";
import { getDomainPulse } from "@/lib/home/get-domain-pulse";
import { localDateString, localWeekday, getTimezoneOffsetMinutes, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { NextUpHero } from "@/components/home/next-up-hero";
import { PulseStrip } from "@/components/home/pulse-strip";
import { PriorityList } from "@/components/home/priority-list";

export default async function HomePage() {
  const supabase = await createClient();
  const user = await getAuthedUser();

  // app/(app)/layout.tsx also gates on this, but layout and page data-fetching
  // can run independently (e.g. an unauthenticated request with no session
  // cookie) — guard here too rather than assuming user is always non-null.
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const [items, dateStr] = await Promise.all([
    getPriorityItems(userId, now),
    getTodayDateString(userId, now),
  ]);
  const pulse = await getDomainPulse(userId, dateStr);

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, timezone")
    .eq("user_id", userId)
    .maybeSingle();

  // Onboarding (Phase 13) doesn't exist yet — until it does, a fresh account
  // just sees the same empty state as "all clear" with a slightly different
  // message, rather than a 404 redirect to a route that isn't built.
  const isFreshInstall = profile?.onboarding_completed === false && items.length === 0;

  // Weekly planning nudge: unlocks Saturday evening, no hard lockout — just
  // a nudge until it's done, per spec. "This week" here means the upcoming
  // week (starts tomorrow, Sunday), since Saturday evening is when you plan
  // ahead for it.
  const timezone = profile?.timezone ?? "UTC";
  const isSaturdayEvening =
    localWeekday(now, timezone) === "Saturday" &&
    (now.getUTCHours() * 60 + now.getUTCMinutes() + getTimezoneOffsetMinutes(now, timezone)) % 1440 >= 18 * 60;
  let showPlanningNudge = false;
  if (isSaturdayEvening) {
    const upcomingWeekStart = addDaysToDateString(getWeekStartDate(localDateString(now, timezone)), 7);
    const { data: upcomingGoals } = await supabase
      .from("weekly_goals")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start_date", upcomingWeekStart);
    showPlanningNudge = (upcomingGoals?.length ?? 0) === 0;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <NextUpHero item={items[0] ?? null} now={now} />
      <PulseStrip pulse={pulse} />
      {showPlanningNudge && (
        <Link
          href="/weekly-planning"
          className="rounded-lg border border-accent-business/40 bg-accent-business/10 px-4 py-3 text-sm text-accent-business hover:bg-accent-business/20"
        >
          Plan next week&apos;s Deen and Business goals →
        </Link>
      )}
      {isFreshInstall ? (
        <p className="text-sm text-muted-foreground">
          Welcome to Life OS — head into a domain tab to get started.
        </p>
      ) : (
        <PriorityList items={items} />
      )}
    </div>
  );
}
