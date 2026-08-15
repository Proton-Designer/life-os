import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/shared/section-skeleton";
import { PageContainer } from "@/components/shell/page-container";

export default function Loading() {
  return (
    <PageContainer>
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="flex justify-between gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="size-14 shrink-0 rounded-full" />
        ))}
      </div>
      <SectionSkeleton rows={3} />
    </PageContainer>
  );
}
