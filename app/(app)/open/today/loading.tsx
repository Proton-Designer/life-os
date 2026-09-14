import { PageContainer } from "@/components/shell/page-container";
import { PageHeaderSkeleton } from "@/components/shell/route-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors page.tsx's post-wake-mark shape (three StatTiles in a row) —
// the no-wake-mark EmptyState branch is not skeletoned separately since
// its content is tiny and static-feeling either way; matching the LARGER
// of the two real states avoids the layout shift that would matter (three
// stat tiles popping in after a bare header would be the visible jump).
export default function MergedTodayLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-border/40 bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
