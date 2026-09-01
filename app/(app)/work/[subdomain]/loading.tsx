import { PageContainer } from "@/components/shell/page-container";
import { PageHeaderSkeleton, PanelSkeleton, RowListSkeleton } from "@/components/shell/route-skeleton";

export default function WorkSubdomainLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <PanelSkeleton titleWidth="w-32" hasHero>
        <RowListSkeleton rows={4} rowHeight="h-14" />
      </PanelSkeleton>
    </PageContainer>
  );
}
