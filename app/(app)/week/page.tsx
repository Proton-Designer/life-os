import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PanelSkeleton } from "@/components/shell/route-skeleton";
import { InlineErrorBoundary } from "@/components/shell/inline-error-boundary";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getAuthedUser } from "@/lib/supabase/auth";
import { WeeklyReviewBody } from "@/components/weekly-review/weekly-review-body";
import { GoalsSection } from "@/components/goals/goals-section";
import { HabitsSection } from "@/components/habits/habits-section";
import { WorriesSection } from "@/components/worries/worries-section";
import { QuranLookBack } from "@/components/week/quran-look-back";
import { WeeklyGoalStep } from "@/components/week/weekly-goal-step";
import { WeekCloseButton, WeekDoneButton } from "@/components/week/week-close-button";

const STEPS = [
  { id: "lookback", title: "Look back" },
  { id: "goals", title: "Goals & milestones" },
  { id: "habits", title: "Habits: keep, pause or drop" },
  { id: "worries", title: "Worry hour" },
  { id: "weekly-goal", title: "This week's goal" },
] as const;

/**
 * The weekly reset (IA-P3a): one page, five anchored steps, in the order the plan fixes —
 * look back at the most recent COMPLETED Sun–Sat week (today excluded; Sunday is day 1 of the new
 * week) → goals & milestones → habits → worry hour → pick this week's goal. Every step is the
 * pre-existing reader/component moved here (weekly review, goal board, habit list, worry list,
 * the shared weekly-goal editor); nothing new is written by this page itself. Reachable from the
 * Home Sunday card and the Insights Week tab ("Start weekly reset"); /weekly-review, /goals,
 * /habits and /worries redirect here.
 */
export default async function WeekPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  return (
    <PageContainer>
      <PageHeader title="Weekly reset" description="Look back, sort what's open, then set the week ahead."
        actions={<WeekCloseButton />}
      />
      <nav aria-label="Reset steps" className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground">
            {i + 1} · {s.title}
          </a>
        ))}
      </nav>
      <div className="space-y-10">
        <section id="lookback" aria-labelledby="week-step-lookback" className="scroll-mt-20 space-y-3">
          <h2 id="week-step-lookback" className="text-base font-semibold">1 · Look back</h2>
          <InlineErrorBoundary label="Look back">
            <Suspense fallback={<PanelSkeleton titleWidth="w-24" bodyHeight="h-40" />}>
              <WeeklyReviewBody soFar={false} viewBasePath="/insights?tab=week" showViewSwitch={false} />
            </Suspense>
          </InlineErrorBoundary>
          <InlineErrorBoundary label="Quran look back">
            <Suspense fallback={null}>
              <QuranLookBack />
            </Suspense>
          </InlineErrorBoundary>
        </section>
        <section id="goals" aria-labelledby="week-step-goals" className="scroll-mt-20 space-y-3">
          <h2 id="week-step-goals" className="text-base font-semibold">2 · Goals &amp; milestones</h2>
          <InlineErrorBoundary label="Goals & milestones">
            <Suspense fallback={<PanelSkeleton titleWidth="w-40" bodyHeight="h-48" />}>
              <GoalsSection />
            </Suspense>
          </InlineErrorBoundary>
        </section>
        <section id="habits" aria-labelledby="week-step-habits" className="scroll-mt-20 space-y-3">
          <h2 id="week-step-habits" className="text-base font-semibold">3 · Habits: keep, pause or drop</h2>
          <InlineErrorBoundary label="Habits step">
            <Suspense fallback={<PanelSkeleton titleWidth="w-44" bodyHeight="h-40" />}>
              <HabitsSection />
            </Suspense>
          </InlineErrorBoundary>
        </section>
        <section id="worries" aria-labelledby="week-step-worries" className="scroll-mt-20 space-y-3">
          <h2 id="week-step-worries" className="text-base font-semibold">4 · Worry hour</h2>
          <InlineErrorBoundary label="Worry hour">
            <Suspense fallback={<PanelSkeleton titleWidth="w-28" bodyHeight="h-32" />}>
              <WorriesSection alwaysWorryHour />
            </Suspense>
          </InlineErrorBoundary>
        </section>
        <section id="weekly-goal" aria-labelledby="week-step-weekly-goal" className="scroll-mt-20 space-y-3">
          <h2 id="week-step-weekly-goal" className="text-base font-semibold">5 · This week&apos;s goal</h2>
          <InlineErrorBoundary label="This week's goal">
            <Suspense fallback={<PanelSkeleton titleWidth="w-36" bodyHeight="h-24" />}>
              <WeeklyGoalStep />
            </Suspense>
          </InlineErrorBoundary>
        </section>
      </div>
      <WeekDoneButton />
    </PageContainer>
  );
}
