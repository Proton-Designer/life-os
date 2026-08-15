import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={1} />
      <Skeleton className="h-20 w-full rounded-xl" />
    </PageContainer>
  );
}
