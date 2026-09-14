import { redirect } from "next/navigation";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/supabase/auth";
import { getOpenWorries, getHandledWorries } from "@/lib/night-plan/worries";
import { WorryList } from "@/components/worries/worry-list";

/**
 * The Worry List (#42) — a real surface for `captureDump({source:"worry"})`,
 * which previously had zero readers. See `lib/night-plan/worries.ts` for the
 * query-shape fix (found by kind, never by `planned_date`) and
 * `app/(app)/worries/actions.ts` for how "Handled" is represented.
 *
 * Reachable today by direct URL. This track does not own `components/shell`
 * (the sidebar's nav items live there), so wiring a nav entry is a
 * coordination item for whoever does — flagged in the build report rather
 * than worked around by editing a file outside this track's ownership.
 */
export default async function WorriesPage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [open, handled] = await Promise.all([
    getOpenWorries(supabase, user.id),
    getHandledWorries(supabase, user.id),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Worries" />
      <WorryList open={open} handled={handled} />
    </PageContainer>
  );
}
