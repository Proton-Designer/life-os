import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton } from "@/components/shell/route-skeleton";

// Mirrors app/(app)/work/page.tsx's current shape: TargetsStrip, Weekly
// Agenda / Work schedule (lg:grid-cols-2), then Pipeline. Note: this route
// is mid-restructure this same batch (schedule strip, Agenda/Pipeline
// merge, Past section) — update this skeleton alongside that landing.
export default function WorkLoading() {
  return (
    <PageContainer>
      <PageHeader title="Work" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelSkeleton titleWidth="w-28" hasHero bodyHeight="h-40" />
        <PanelSkeleton titleWidth="w-28" hasHero hasControls bodyHeight="h-56" />
      </div>
      <PanelSkeleton titleWidth="w-16" bodyHeight="h-48" />
    </PageContainer>
  );
}
