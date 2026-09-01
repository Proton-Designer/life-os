import { PageContainer } from "@/components/shell/page-container";
import { PageHeaderSkeleton, KpiStripSkeleton, PanelSkeleton } from "@/components/shell/route-skeleton";

// Generic across all three Personal subdomains — Faith/Fitness/Self-Mastery
// each have distinct real shapes (see their own composed pages' loading
// states where they exist), but loading.tsx can't branch on the
// [subdomain] param, so this is deliberately a reasonable common shape
// rather than an attempt to precisely mirror any one of them.
export default function PersonalSubdomainLoading() {
  return (
    <PageContainer>
      <PageHeaderSkeleton />
      <KpiStripSkeleton count={3} cols="md:grid-cols-2 lg:grid-cols-3" />
      <PanelSkeleton titleWidth="w-24" hasHero bodyHeight="h-48" />
    </PageContainer>
  );
}
