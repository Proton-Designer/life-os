import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiStripSkeleton, PanelSkeleton } from "@/components/shell/route-skeleton";

// Mirrors app/(app)/insights/page.tsx: the top 3-card strip, "This week"
// area chart, Signal:Noise-by-week, a 4-card recap strip, Week over week,
// Focus Map / Signal:Noise (7/5), then Per-domain.
export default function InsightsLoading() {
  return (
    <PageContainer>
      <PageHeader title="Insights" />
      <KpiStripSkeleton count={3} cols="md:grid-cols-2 lg:grid-cols-3" />
      <PanelSkeleton titleWidth="w-20" hasHero bodyHeight="h-40" />
      <PanelSkeleton titleWidth="w-36" hasHero bodyHeight="h-40" />
      <KpiStripSkeleton count={4} cols="md:grid-cols-2 lg:grid-cols-4" />
      <PanelSkeleton titleWidth="w-32" bodyHeight="h-56" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <PanelSkeleton titleWidth="w-20" bodyHeight="h-48" />
        </div>
        <div className="lg:col-span-5">
          <PanelSkeleton titleWidth="w-24" bodyHeight="h-48" />
        </div>
      </div>
      <PanelSkeleton titleWidth="w-24" bodyHeight="h-40" />
    </PageContainer>
  );
}
