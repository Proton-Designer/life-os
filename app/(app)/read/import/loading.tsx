import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

export default function ReadImportLoading() {
  return (
    <PageContainer>
      <PageHeader title="Import to read" />
      <PanelSkeleton titleWidth="w-28"><RowListSkeleton rows={2} rowHeight="h-12" /></PanelSkeleton>
    </PageContainer>
  );
}
