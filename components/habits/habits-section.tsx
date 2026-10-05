import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getActiveHabitsWithStatus, getPausedHabits } from "@/lib/habits/queries";
import { HabitList } from "@/components/habits/habit-list";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getFaithPractices } from "@/lib/deen/practices";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

/** Identity habits: keep / pause / drop (moved out of /habits by IA-P3a; /week step 3). Same readers and widget layout ("habits") as before. */
export async function HabitsSection() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  // HABITS-01: Faith practices only when Deen mode is on (OFF: not read at all).
  const [habits, pausedHabits, layout, faithPractices] = await Promise.all([
    getActiveHabitsWithStatus(supabase, user.id, todayStr, timezone),
    getPausedHabits(supabase, user.id),
    getPageLayout("habits"),
    isDeenModeOn(profile) ? getFaithPractices(supabase, user.id, todayStr).catch(() => []) : Promise.resolve([]),
  ]);
  const layoutMap = buildLayoutMap(layout);

  return (
    <div className="space-y-4" data-testid="habits-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Your identities and faith practices. Keep, pause or drop. Vote once a day for who you&apos;re becoming — up to seven identities.
        </p>
        <WidgetManagerButton domainKey="habits" />
      </div>
      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="habits" variant="text" />
        </div>
      ) : null}
      <LayoutSlot layout={layoutMap} widgetKey="habit_list">
        <HabitList habits={habits} pausedHabits={pausedHabits} faithPractices={faithPractices} today={todayStr} />
      </LayoutSlot>
    </div>
  );
}
