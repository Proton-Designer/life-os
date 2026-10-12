import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getWeekStartDate, localDateString } from "@/lib/date-utils";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { weeklyGoalDomains } from "@/lib/domains/weekly-goal-domains";
import { showBusinessWeeklyGoal } from "@/lib/home/sector-rows";
import { WeeklyGoalsHeader, type WeeklyGoalEntry } from "@/components/shared/weekly-goals-header";
import { saveWeeklyGoal } from "@/app/(app)/actions";

/**
 * /week step 5: pick this week's goal(s) through THE shared weekly-goal editor (the same
 * WeeklyGoalsHeader Home and /calendar render, saving through the same `saveWeeklyGoal`). Weeks
 * are Sunday-start, so on the reset Sunday "this week" is the week that starts today.
 */
export async function WeeklyGoalStep() {
  const user = await getAuthedUser();
  if (!user) return null;
  const supabase = await createClient();
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const deenMode = isDeenModeOn(profile);
  const weekStart = getWeekStartDate(localDateString(new Date(), timezone));
  const domainsState = await getUserDomains();
  const domains = weeklyGoalDomains();
  const showDeen = domains.includes("deen");
  const showBusiness = showBusinessWeeklyGoal(domainsState, deenMode);

  const { data } = await supabase
    .from("weekly_goals")
    .select("domain, headline, milestones")
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .in("domain", domains);
  const rows = data ?? [];
  const entry = (domain: "deen" | "business"): WeeklyGoalEntry => {
    const row = rows.find((r) => r.domain === domain);
    if (!row) return null;
    return {
      headline: row.headline,
      milestones: (row.milestones as string[] | null) ?? [],
    };
  };

  if (!showDeen && !showBusiness) {
    return <p className="text-sm text-muted-foreground">No weekly goals to set for the areas you use.</p>;
  }
  return (
    <WeeklyGoalsHeader
      deen={entry("deen")}
      business={entry("business")}
      onSaveDeen={saveWeeklyGoal.bind(null, "deen")}
      onSaveBusiness={saveWeeklyGoal.bind(null, "business")}
      showDeen={showDeen}
      showBusiness={showBusiness}
    />
  );
}
