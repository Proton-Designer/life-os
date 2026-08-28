import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RowListSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors app/(app)/business/page.tsx: the Focus time today / Incompleted
// Tasks pair (sm:grid-cols-2), then Today's kill list / This week's goal
// (lg:grid-cols-12, 6/6).
function CompactCardSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-2xl border border-border/40 bg-card p-3", FADE_IN)}>
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className={`h-3.5 ${titleWidth}`} />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export default function BusinessLoading() {
  return (
    <PageContainer>
      <PageHeader title="Business" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CompactCardSkeleton titleWidth="w-28" />
        <CompactCardSkeleton titleWidth="w-32" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <PanelSkeleton titleWidth="w-32" hasHero hasControls>
            <RowListSkeleton rows={3} rowHeight="h-12" />
          </PanelSkeleton>
        </div>
        <div className="lg:col-span-6">
          <PanelSkeleton titleWidth="w-28" bodyHeight="h-24" />
        </div>
      </div>
    </PageContainer>
  );
}
