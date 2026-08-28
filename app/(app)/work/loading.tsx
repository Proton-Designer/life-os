import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors app/(app)/work/page.tsx post-restructure (batch 5, usvggmr2): a
// thin schedule strip (rounded-xl border px-3 py-2, NOT a Panel — re-read
// after this route's schedule-strip/Agenda-Pipeline-merge landed today,
// this skeleton previously mirrored the pre-restructure two-Panel shape),
// TargetsStrip, then the single "Weekly Agenda Pipeline" Panel — controls,
// no heroValue.
export default function WorkLoading() {
  return (
    <PageContainer>
      <PageHeader title="Work" />
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/40 bg-card px-3 py-2",
          FADE_IN
        )}
      >
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 min-w-0 flex-1 rounded-md" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      </div>
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border border-dashed border-border/60 px-4 py-6",
          FADE_IN
        )}
      >
        <Skeleton className="h-4 w-40" />
      </div>
      <PanelSkeleton titleWidth="w-44" hasControls bodyHeight="h-56" />
    </PageContainer>
  );
}
