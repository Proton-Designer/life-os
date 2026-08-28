import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelSkeleton, RowListSkeleton, FADE_IN } from "@/components/shell/route-skeleton";
import { cn } from "@/lib/utils";

// Mirrors app/(app)/settings/page.tsx: the xl-only sticky section nav next
// to SettingsForm's stacked field groups, then the Notifications Panel.
export default function SettingsLoading() {
  return (
    <PageContainer>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[180px_1fr]">
        <nav className="hidden xl:block">
          <div className={cn("flex flex-col gap-2", FADE_IN)}>
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        </nav>
        <div className="flex flex-col gap-8">
          <RowListSkeleton rows={4} rowHeight="h-16" />
          <PanelSkeleton titleWidth="w-28" bodyHeight="h-24" />
        </div>
      </div>
    </PageContainer>
  );
}
