import { createClient } from "@/lib/supabase/server";
import { getPriorityItems, getTodayDateString } from "@/lib/home/get-priority-items";
import { getDomainPulse } from "@/lib/home/get-domain-pulse";
import { NextUpHero } from "@/components/home/next-up-hero";
import { PulseStrip } from "@/components/home/pulse-strip";
import { PriorityList } from "@/components/home/priority-list";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Non-null: app/(app)/layout.tsx already redirects unauthenticated requests to /login.
  const userId = user!.id;
  const now = new Date();

  const [items, dateStr] = await Promise.all([
    getPriorityItems(userId, now),
    getTodayDateString(userId, now),
  ]);
  const pulse = await getDomainPulse(userId, dateStr);

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();

  // Onboarding (Phase 13) doesn't exist yet — until it does, a fresh account
  // just sees the same empty state as "all clear" with a slightly different
  // message, rather than a 404 redirect to a route that isn't built.
  const isFreshInstall = profile?.onboarding_completed === false && items.length === 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 md:py-12">
      <NextUpHero item={items[0] ?? null} now={now} />
      <PulseStrip pulse={pulse} />
      {isFreshInstall ? (
        <p className="text-sm text-muted-foreground">
          Welcome to Life OS — head into a domain tab to get started.
        </p>
      ) : (
        <PriorityList items={items} />
      )}
    </div>
  );
}
