import Link from "next/link";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { WeeklyReviewBody } from "@/components/weekly-review/weekly-review-body";
import { cn } from "@/lib/utils";

/**
 * The Insights "Weekly review" tab (IA-P3a): the old /weekly-review content, unchanged in
 * substance, plus a "Start weekly reset" button that works any day — a missed Sunday is not
 * stranded. Rendered by /insights?tab=week.
 */
export function InsightsWeekTab({ soFar }: { soFar: boolean }) {
  return (
    <PageContainer>
      <PageHeader
        title="Insights"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-2 text-sm" role="tablist" aria-label="Insights view">
              <Link href="/insights" role="tab" aria-selected={false} className={cn("rounded-full px-3 py-1 text-muted-foreground")}>
                Overview
              </Link>
              <Link href="/insights?tab=week" role="tab" aria-selected className={cn("rounded-full bg-accent px-3 py-1")}>
                Weekly review
              </Link>
            </div>
            <Link href="/week" className="rounded-md border px-3 py-1.5 text-sm font-medium">
              Start weekly reset
            </Link>
          </div>
        }
      />
      <WeeklyReviewBody soFar={soFar} viewBasePath="/insights?tab=week" />
    </PageContainer>
  );
}
