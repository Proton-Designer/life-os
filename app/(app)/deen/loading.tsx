import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <SectionSkeleton rows={5} />
      <SectionSkeleton rows={2} />
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={1} />
    </PageContainer>
  );
}
