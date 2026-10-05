import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { getPageLayout } from "@/app/(app)/page-layout-actions";
import { buildLayoutMap, allWidgetsHidden, anyWidgetVisible } from "@/components/page-layout/layout-slot";
import { WidgetManagerButton } from "@/components/page-layout/widget-manager-button";
import { BUSINESS_WIDGET_KEYS } from "@/lib/page-layout/registry";
import { loadWorkModulesData } from "@/lib/work/work-modules-data";
import { WorkModules } from "@/components/work/work-modules";
import { loadBusinessModulesData } from "@/lib/business/business-modules-data";
import { BusinessModules } from "@/components/business/business-modules";

/**
 * The Work (job) screen body. The Business modules (focus time, incomplete tasks, kill list, weekly goal, completed goals) are
 * available here too, OFF by default: the person adds them in this page's widget manager, and the choice is stored under the
 * "work" layout, so it never touches the Business page.
 */
export async function WorkScreen() {
  const supabase = await createClient();
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const userId = user.id;
  const now = new Date();

  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const layout = await getPageLayout("work");
  const layoutMap = buildLayoutMap(layout);

  const [data, businessData] = await Promise.all([
    loadWorkModulesData(supabase, userId, now, timezone),
    // Only read Business's data when the person has actually switched one of its modules on here.
    anyWidgetVisible(layout, BUSINESS_WIDGET_KEYS) ? loadBusinessModulesData(supabase, userId, now, timezone) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Work" actions={<WidgetManagerButton domainKey="work" />} />

      {allWidgetsHidden(layout) ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Every widget on this page is hidden. <WidgetManagerButton domainKey="work" variant="text" />
        </div>
      ) : null}

      <WorkModules data={data} layout={layoutMap} />
      {businessData ? <BusinessModules data={businessData} layout={layoutMap} /> : null}
    </PageContainer>
  );
}
