import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiStripSkeleton, PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors app/(app)/deen/page.tsx: a 3-card hero strip (Next Prayer, Prayer
// streak, Qada backlog), then Salah/Qur'an (5/7 cols), Reflection/Habit
// Builder (4/8 cols), then the 30-day consistency Panel.
export default function DeenLoading() {
  return (
    <PageContainer>
      <PageHeader title="Deen" />
      <KpiStripSkeleton count={3} cols="md:grid-cols-2 lg:grid-cols-3" />
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <PanelSkeleton titleWidth="w-12" hasHero className="h-full">
            <RowListSkeleton rows={5} rowHeight="h-14" />
          </PanelSkeleton>
        </div>
        <div className="lg:col-span-7">
          <PanelSkeleton titleWidth="w-16" hasHero bodyHeight="h-64" className="h-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <PanelSkeleton titleWidth="w-24" bodyHeight="h-40" className="h-full" />
        </div>
        <div className="lg:col-span-8">
          <PanelSkeleton titleWidth="w-28" bodyHeight="h-40" className="h-full" />
        </div>
      </div>
      <PanelSkeleton titleWidth="w-52" hasHero bodyHeight="h-40" />
    </PageContainer>
  );
}
