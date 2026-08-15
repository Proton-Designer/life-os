import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <SectionSkeleton rows={1} />
      <SectionSkeleton rows={4} />
    </PageContainer>
  );
}
