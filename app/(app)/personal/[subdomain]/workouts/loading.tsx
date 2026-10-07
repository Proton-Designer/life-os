import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors this segment's page.tsx, which renders app/(app)/fitness/workouts/page.tsx under the Personal tab bar: the
// back link, then the plan list. Same shape as fitness/workouts/loading.tsx.
export default function PersonalWorkoutsLoading() {
  return (
    <PageContainer>
      <PageHeader title="My Workouts" />
      <Skeleton className={cn("h-4 w-32", FADE_IN)} />
      <RowListSkeleton rows={3} rowHeight="h-24" />
    </PageContainer>
  );
}
