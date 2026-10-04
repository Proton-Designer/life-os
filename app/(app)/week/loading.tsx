import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { PanelSkeleton, PillRowSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors /week: the title, the five step chips, then five stacked step sections.
export default function WeekLoading() {
  return (
    <PageContainer>
      <PageHeader title="Weekly reset" description="Look back, sort what's open, then set the week ahead." />
      <PillRowSkeleton count={5} widths="w-32" />
      <div className="space-y-10">
        <PanelSkeleton titleWidth="w-24" bodyHeight="h-40" />
        <PanelSkeleton titleWidth="w-40" bodyHeight="h-48" />
        <PanelSkeleton titleWidth="w-44"><RowListSkeleton rows={3} rowHeight="h-14" /></PanelSkeleton>
        <PanelSkeleton titleWidth="w-28" bodyHeight="h-32" />
        <PanelSkeleton titleWidth="w-36" bodyHeight="h-24" />
      </div>
    </PageContainer>
  );
}
