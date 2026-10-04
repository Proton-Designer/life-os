import { PageContainer } from "@/components/shell/page-container";
import { PageHeaderSkeleton, PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

// A book's page: the title row, a summary panel, then its chapters/cards list.
export default function BookLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton withActions />
      <PanelSkeleton titleWidth="w-32" bodyHeight="h-28" />
      <PanelSkeleton titleWidth="w-24"><RowListSkeleton rows={5} rowHeight="h-12" /></PanelSkeleton>
    </PageContainer>
  );
}
