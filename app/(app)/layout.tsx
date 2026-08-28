import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { getActiveWorkSession } from "@/lib/business/active-session";
import { AppShell } from "@/components/shell/app-shell";
import { saveWeeklyGoal } from "@/app/(app)/actions";
import { getWeekCalendar } from "@/app/(app)/calendar/actions";

// Split out from AppLayout and wrapped in its own <Suspense> (Opus Lead,
// batch 5 follow-up): headers() forces this subtree dynamic, and per Next's
// docs (api-reference/file-conventions/layout#interaction-with-loadingjs),
// a layout that reads runtime data directly blocks navigation until it
// finishes rendering — loading.tsx below it never gets a chance to show a
// fallback, which measured as a 413ms frozen old-screen on production after
// a revalidatePath purge. Wrapping the runtime-data-dependent part in its
// own Suspense boundary is the documented fix: the boundary commits (and the
// old screen is gone) as soon as this component suspends, not once it
// resolves. redirect() still works correctly thrown from inside a Suspense
// boundary — it aborts the render and issues the redirect either way, but
// NOT identically: once the shell has already started streaming (which it
// now can, since fallback={null} lets it commit immediately), a redirect()
// thrown after that point can no longer be a 307 — the response is already
// underway — so Next falls back to a client-side redirect instead. This is
// functionally equivalent here (nothing sensitive has rendered by then,
// the fallback is blank), but it is a real behavioural difference from the
// old blocking layout, not a non-difference — don't describe this as
// "exactly as strict" without that caveat (Opus Lead audit, batch 5).
//
// The one page this widens a real window on is /onboarding: with the old
// blocking layout, an onboarding-incomplete profile could never even start
// rendering an app route. Now it can, briefly, before AuthedShell's redirect
// fires. Every other route independently re-checks getAuthedUser() and
// redirects on its own (audited: 11/12 page.tsx do; /onboarding is the
// exception and renders only <OnboardingWizard/> — no user data, no DB read
// — so there's nothing to leak in that window), and RLS sits under every
// table regardless. Net effect for onboarding-incomplete users is a UX
// wrinkle (a possible brief flash of the target route before bouncing to
// /onboarding), not a security hole.
async function AuthedShell({ children }: { children: React.ReactNode }) {
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

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // fallback={null}: deliberately not app-shell-shaped. This is the window
  // before we know whether the visitor is even authenticated, so it must
  // render nothing resembling nav/topbar/account chrome — a blank frame is
  // strictly safer than a skeleton that looks like the signed-in app.
  // The route's own loading.tsx (with its 130ms fade-in) takes over for any
  // further wait once AuthedShell resolves and children start rendering.
  return (
    <Suspense fallback={null}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}
