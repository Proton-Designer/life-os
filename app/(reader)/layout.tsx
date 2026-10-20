import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { safeNextPath } from "@/lib/auth/safe-next";

/**
 * The focus reader's OWN route group, chromeless on purpose: a full-screen reading surface has no sidebar, topbar,
 * session pill or check-in toast. Separate from app/(app)/layout.tsx for the same reason app/(capture) is: a shared
 * layout is not re-rendered across a client-side navigation between siblings, so a pathname branch inside (app) would
 * leave the AppShell showing through. See app/(capture)/layout.tsx for the full story.
 *
 * Auth + onboarding gating is duplicated from there (two short gates beat a helper with a parameter for the one
 * behaviour that differs). A signed-out visit returns to the exact reader URL after login.
 */
export default async function ReaderLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  if (!user) {
    const pathname = safeNextPath((await headers()).get("x-pathname"));
    redirect(`/login?next=${encodeURIComponent(pathname ?? "/self-mastery")}`);
  }

  const profile = await getProfile();
  if (!profile || profile.onboarding_completed === false) {
    redirect("/onboarding");
  }

  return <>{children}</>;
}
