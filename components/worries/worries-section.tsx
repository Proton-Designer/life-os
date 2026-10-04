import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { localWeekday } from "@/lib/date-utils";
import { getOpenWorries, getHandledWorries } from "@/lib/night-plan/worries";
import { WorriesPageClient } from "@/components/worries/worries-page-client";

/** Open worries + the anti-worry hour (moved out of /worries by IA-P3a; /week step 4). On /week the hour is always available — the weekly reset IS the worry hour. */
export async function WorriesSection({ alwaysWorryHour = false }: { alwaysWorryHour?: boolean } = {}) {
  const user = await getAuthedUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [open, handled, profile] = await Promise.all([
    getOpenWorries(supabase, user.id),
    getHandledWorries(supabase, user.id),
    getProfile(),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const isMonday = alwaysWorryHour || localWeekday(new Date(), timezone) === "Monday";

  return (
    <div data-testid="worries-section">
      <WorriesPageClient open={open} handled={handled} isMonday={isMonday} />
    </div>
  );
}
