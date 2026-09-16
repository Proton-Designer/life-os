import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localDateString } from "@/lib/date-utils";
import { getActiveHabitsWithStatus, getPausedHabits } from "@/lib/habits/queries";
import { HabitList } from "@/components/habits/habit-list";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { LayoutSlot, buildLayoutMap, allWidgetsHidden } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";

/**
 * The Habits page (#39/#40/#41) — the first real reader for
 * lib/habits/actions-core.ts and lib/habits/queries.ts, which had zero
 * callers before this. See migration 175's header for the schema reasoning
 * (new `identity_habits`/`habit_votes` tables, not a reshape of
 * `custom_habits` or `deen_habits`).
 *
 * `todayStr` is derived from `localDateString(now, tz)` (never a raw
 * `Date` — CLAUDE.md's hard constraint), same pattern as the Goals page —
 * passed down to the client board as a plain string, since every vote it
 * casts must be re-validated server-side against that same day.
 */
export default async function HabitsPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(new Date(), timezone);

  const [habits, pausedHabits, layout] = await Promise.all([
    getActiveHabitsWithStatus(supabase, user.id, todayStr, timezone),
    getPausedHabits(supabase, user.id),
    getPageLayout("habits"),
  ]);
  const layoutMap = buildLayoutMap(layout);

  return (
    <PageContainer>
      <PageHeader
        title="Habits"
        description="Vote once a day for who you're becoming. Up to seven identities — the database refuses an eighth."
        actions={<WidgetManagerButton domainKey="habits" />}
      />
      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="habits" variant="text" />
        </div>
      ) : null}
      <LayoutSlot layout={layoutMap} widgetKey="habit_list">
        <HabitList habits={habits} pausedHabits={pausedHabits} today={todayStr} />
      </LayoutSlot>
    </PageContainer>
  );
}
