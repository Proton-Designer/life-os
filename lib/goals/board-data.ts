import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString } from "@/lib/date-utils";
import { listGoalsForMonth, type Goal } from "@/lib/goals/actions-core";
import { getMilestonesForMonth, monthStartFor, type GoalMilestone } from "@/lib/goals/queries";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { withoutDeenGoals } from "@/lib/goals/deen-filter";

export type GoalBoardData = {
  deenMode: boolean;
  reservedRanks: number[];
  monthStart: string;
  todayStr: string;
  goals: Goal[];
  milestones: GoalMilestone[];
};

/**
 * Everything the monthly goal board renders, as plain data: the /week step 2 section and the Home
 * "Goals" sheet (getGoalsSheetData) read it through THIS one function so the Deen-Mode filter and
 * the reserved-rank rule can't drift between the two doors. Deen Mode OFF hides goals tagged "deen"
 * (and their milestones) -- data untouched; their ranks stay reserved so the add form can't collide.
 */
export async function loadGoalBoardData(
  supabase: SupabaseClient,
  userId: string,
  profile: { timezone?: string | null; deen_mode?: boolean | null } | null,
  now: Date = new Date()
): Promise<GoalBoardData> {
  const timezone = profile?.timezone ?? "UTC";
  const todayStr = localDateString(now, timezone);
  const monthStart = monthStartFor(todayStr);
  const deenMode = isDeenModeOn(profile as Parameters<typeof isDeenModeOn>[0]);
  const [allGoals, allMilestones] = await Promise.all([
    listGoalsForMonth(supabase, userId, monthStart),
    getMilestonesForMonth(supabase, userId, monthStart),
  ]);
  const goals = withoutDeenGoals(allGoals, deenMode);
  const hiddenGoals = allGoals.filter((g) => !goals.includes(g));
  const hiddenGoalIds = new Set(hiddenGoals.map((g) => g.id));
  return {
    deenMode,
    reservedRanks: hiddenGoals.filter((g) => g.status === "active").map((g) => g.rank),
    monthStart,
    todayStr,
    goals,
    milestones: allMilestones.filter((m) => !hiddenGoalIds.has(m.goalId)),
  };
}
