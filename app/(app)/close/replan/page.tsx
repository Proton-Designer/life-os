import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getReplanData } from "../actions";
import { ClosePlanStage } from "@/components/evening-close/close-plan-stage";

/**
 * The #29 fix, second half. `/open`'s "Re-plan" link used to route to
 * `/close`, which (a) takes no `searchParams`, (b) opens on the account-
 * stage refusal gate, and (c) — decisively —
 * `app/(app)/close/plan-actions.ts`'s `planningDateFor()` hardcoded
 * `addDaysToDateString(today, 1)`, so a tap here at 7am silently planned
 * TOMORROW while today's stale plan sat untouched.
 *
 * THIS ROUTE RENDERS ONLY THE PLAN STAGE — no account gate, no reflect
 * stage. Those two stages are about closing OUT a day that already
 * happened (the three-strike rewrite gate, "did yesterday's crown happen");
 * neither means anything for "I want to re-crown today's plan right now."
 *
 * THE CLOSE IS STILL THE ONLY WRITER OF RANK. `ClosePlanStage` with
 * `mode="today"` is the exact same component and the exact same
 * `savePlanRanks` action `/close` uses — it is merely told which day
 * (`plannedDate = the user's local today, via localDateString`, no `+1`).
 * `savePlanRanks` already clears stale ranks for that `planned_date` only
 * (see that file), so replanning today clears today's crown first: no
 * index collision against `tasks_mit_rank_per_day_idx`, no second clearing
 * rule to invent.
 */
export default async function ReplanTodayPage() {
  const data = await getReplanData();
  if (data === null) redirect("/login");

  return (
    <PageContainer>
      <PageHeader title="Re-plan today" description="Today's plan, redone. Yesterday's crown is cleared the moment you finish." />
      <ClosePlanStage initialLines={data.todayLines} seeds={data.planSeeds} mode="today" />
    </PageContainer>
  );
}
