import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors app/(app)/fitness/workouts/page.tsx: the back link, then
// PlanWorkoutsClient's plan list — approximated as a row list since the
// client component's own internal tabs/cards aren't known statically.
export default function WorkoutsLoading() {
  return (
    <PageContainer>
      <PageHeader title="My Workouts" />
      <Skeleton className={cn("h-4 w-32", FADE_IN)} />
      <RowListSkeleton rows={3} rowHeight="h-24" />
    </PageContainer>
  );
}
