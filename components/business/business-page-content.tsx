import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { buildLayoutMap, allWidgetsHidden, anyWidgetVisible } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";
import { WORK_WIDGET_KEYS } from "@/lib/page-layout/registry";
import { loadBusinessModulesData } from "@/lib/business/business-modules-data";
import { BusinessModules } from "@/components/business/business-modules";
import { loadWorkModulesData } from "@/lib/work/work-modules-data";
import { WorkModules } from "@/components/work/work-modules";

/**
 * The Business screen body. Rendered by /business AND, in domains mode, by /work/<business tab>
 * (WORK-W1): the same component, so there is one Business implementation.
 *
 * The Work modules (schedule, targets & goals, pipeline) are available here too, OFF by default: the person adds them in
 * this page's widget manager, and the choice is stored under the "business" layout, so it never touches the Work page.
 */
export async function BusinessPageContent() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const layout = await getPageLayout("business");
  const layoutMap = buildLayoutMap(layout);

  const [data, workData] = await Promise.all([
    loadBusinessModulesData(supabase, userId, now, timezone),
    // Only read Work's data when the person has actually switched one of its modules on here.
    anyWidgetVisible(layout, WORK_WIDGET_KEYS) ? loadWorkModulesData(supabase, userId, now, timezone) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Business" actions={<WidgetManagerButton domainKey="business" />} />

      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="business" variant="text" />
        </div>
      ) : null}

      <BusinessModules data={data} layout={layoutMap} />
      {workData ? <WorkModules data={workData} layout={layoutMap} /> : null}
    </PageContainer>
  );
}
