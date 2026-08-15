import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={7} />
    </PageContainer>
  );
}
