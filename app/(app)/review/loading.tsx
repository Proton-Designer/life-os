import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { RowListSkeleton } from "@/components/shell/route-skeleton";

// Mirrors ReviewClient's grouped-cards shape. The real title carries the
// reviewed date ("Review · Saturday 23 Aug"), which needs the profile's
// timezone to compute — the loading title is just "Review" rather than
// blocking the boundary on that lookup.
export default function ReviewLoading() {
  return (
    <PageContainer>
      <PageHeader title="Review" />
      <RowListSkeleton rows={4} rowHeight="h-16" />
    </PageContainer>
  );
}
