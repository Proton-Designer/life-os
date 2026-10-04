import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { KpiStripSkeleton, PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

export default function SelfMasteryLoading() {
  return (
    <PageContainer>
      <PageHeader title="Self-Mastery" />
      <KpiStripSkeleton count={3} size="sm" cols="md:grid-cols-3" />
      <PanelSkeleton titleWidth="w-28"><RowListSkeleton rows={4} rowHeight="h-16" /></PanelSkeleton>
    </PageContainer>
  );
}
