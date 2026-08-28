import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { AppShell } from "@/components/shell/app-shell";
import { saveWeeklyGoal } from "@/app/(app)/actions";
import { getWeekCalendar } from "@/app/(app)/calendar/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthedUser();

  if (!user) {
    redirect("/login");
  }

  const pathname = (await headers()).get("x-pathname") ?? "";
  // getProfile and getActiveWorkSession are each a real Supabase round trip
  // and neither depends on the other — issue them together rather than
  // serially (Opus Lead, batch 5: this is the layer AppShell's own
  // Promise.all couldn't reach, since getProfile already resolved here by
  // the time AppShell runs; the round trip this actually saves is the one
  // AppShell used to pay AFTER this one). Both are cache()'d, so AppShell's
  // later calls to either hit the warm memo. Both awaited unconditionally
  // (not just on the non-onboarding branch) so neither is left as an
  // unawaited promise across the redirect("/onboarding") branch below.
  const [profile] = await Promise.all([getProfile(), getActiveWorkSession(user.id)]);

  if (!pathname.startsWith("/onboarding")) {
    // No profile row yet is equivalent to "onboarding not done" — a brand
    // new auth user has no profiles row until onboarding creates one.
    if (!profile || profile.onboarding_completed === false) {
      redirect("/onboarding");
    }
  }

  return (
    <AppShell getWeekCalendar={getWeekCalendar} onSaveDeen={saveWeeklyGoal.bind(null, "deen")} onSaveBusiness={saveWeeklyGoal.bind(null, "business")}>
      {children}
    </AppShell>
  );
}
