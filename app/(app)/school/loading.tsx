import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiStripSkeleton, PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors app/(app)/school/page.tsx: a 4-card KPI strip (Due today,
// Overdue, Due this week, Completed), an optional class-cards grid, the
// Task list Panel, then This week's classes Panel.
export default function SchoolLoading() {
  return (
    <PageContainer>
      <PageHeader title="School" />
      <KpiStripSkeleton count={4} size="sm" cols="md:grid-cols-2 lg:grid-cols-4" />
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <PanelSkeleton titleWidth="w-20" hasHero hasControls>
        <RowListSkeleton rows={4} rowHeight="h-12" />
      </PanelSkeleton>
      <PanelSkeleton titleWidth="w-40" hasHero hasControls bodyHeight="h-56" />
    </PageContainer>
  );
}
