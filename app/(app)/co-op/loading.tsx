import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={5} />
    </PageContainer>
  );
}
