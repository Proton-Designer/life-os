import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RowListSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors app/(app)/fitness/page.tsx: the Workout Plan strip (a bordered
// row, not a Panel), Daily Log, This week (volume + week calendar), and
// Cycle Progress checks.
export default function FitnessLoading() {
  return (
    <PageContainer>
      <PageHeader title="Fitness" />
      <div className={cn("flex items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-2.5", FADE_IN)}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <PanelSkeleton titleWidth="w-20">
        <RowListSkeleton rows={3} rowHeight="h-14" />
      </PanelSkeleton>
      <PanelSkeleton titleWidth="w-16">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </PanelSkeleton>
      <PanelSkeleton titleWidth="w-40">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </PanelSkeleton>
    </PageContainer>
  );
}
