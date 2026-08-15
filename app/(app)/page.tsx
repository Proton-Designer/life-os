import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getPriorityItems } from "@/lib/home/get-priority-items";
import { getDomainSnapshots } from "@/lib/home/get-domain-snapshots";
import { localDateString, localWeekday, getTimezoneOffsetMinutes, getWeekStartDate, addDaysToDateString } from "@/lib/date-utils";
import { NextUpHero } from "@/components/home/next-up-hero";
import { PriorityList } from "@/components/home/priority-list";
import { DomainPeekCards } from "@/components/home/domain-peek-cards";
import { WeeklySummaryStrip } from "@/components/home/weekly-summary-strip";

export default async function HomePage() {
  const supabase = await createClient();
  const user = await getAuthedUser();

  // app/(app)/layout.tsx also gates on this, but layout and page data-fetching
  // can run independently (e.g. an unauthenticated request with no session
  // cookie) — guard here too rather than assuming user is always non-null.
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const [items, snapshots] = await Promise.all([
    getPriorityItems(userId, now),
    getDomainSnapshots(userId, now),
  ]);

  const profile = await getProfile();

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
    <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-6 px-4 py-8 md:grid-cols-[minmax(0,1fr)_280px] md:py-12 lg:grid-cols-[280px_minmax(0,1fr)_280px]">
      {/* Left rail — desktop only. Deen + Business: the two domains
          DOMAIN_PRIORITY (lib/home/get-priority-items.ts) weights highest.
          self-start: grid's default stretch would otherwise pad this
          column's box to match the (usually taller) center column, leaving
          a big dead gap below these 2 cards instead of just a shorter column. */}
      <div className="hidden lg:flex lg:flex-col lg:gap-4 lg:self-start">
        <DomainPeekCards snapshots={snapshots} now={now} domains={["deen", "business"]} />
      </div>

      {/* Center column — the highest-leverage content, same relative
          position at every width: hero, nudge, priority list, then (mobile
          only) the peek-card carousel, then the weekly summary. */}
      <div className="flex flex-col gap-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <NextUpHero item={items[0] ?? null} now={now} />
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

        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:hidden">
          <DomainPeekCards snapshots={snapshots} now={now} />
        </div>

        <div className="mx-auto w-full max-w-2xl">
          <WeeklySummaryStrip snapshots={snapshots} />
        </div>
      </div>

      {/* Combined rail — tablet only (all 5 cards, one column). */}
      <div className="hidden md:flex md:flex-col md:gap-4 md:self-start lg:hidden">
        <DomainPeekCards snapshots={snapshots} now={now} />
      </div>

      {/* Right rail — desktop only. */}
      <div className="hidden lg:flex lg:flex-col lg:gap-4 lg:self-start">
        <DomainPeekCards snapshots={snapshots} now={now} domains={["fitness", "school", "co_op"]} />
      </div>
    </div>
  );
}
