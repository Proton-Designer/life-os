import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, DomainStatusStripSkeleton, WeeklyGoalsHeaderSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors app/(app)/page.tsx's shape: WeeklyGoalsHeader, DomainStatusStack,
// an 8/4 Now/Focus split, then the day's-shape Panel. Real PageHeader (its
// title is static, known before any data fetch — no need to skeleton it).
export default function HomeLoading() {
  return (
    <PageContainer>
      <PageHeader title="Home" />
      <WeeklyGoalsHeaderSkeleton />
      <DomainStatusStripSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <PanelSkeleton titleWidth="w-12">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <RowListSkeleton rows={3} rowHeight="h-14" />
            </div>
          </PanelSkeleton>
        </div>
        <div className="lg:col-span-4">
          <PanelSkeleton titleWidth="w-14" bodyHeight="h-48" />
        </div>
      </div>
      <PanelSkeleton titleWidth="w-32" bodyHeight="h-40" />
    </PageContainer>
  );
}
