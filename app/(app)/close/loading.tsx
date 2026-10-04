import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors /close: Account, Reflect, then the Plan stage.
export default function CloseLoading() {
  return (
    <PageContainer>
      <PageHeader title="Evening close" />
      <div className="space-y-8">
        <PanelSkeleton titleWidth="w-20" bodyHeight="h-24" />
        <PanelSkeleton titleWidth="w-24" bodyHeight="h-40" />
        <PanelSkeleton titleWidth="w-28"><RowListSkeleton rows={4} rowHeight="h-12" /></PanelSkeleton>
      </div>
    </PageContainer>
  );
}
