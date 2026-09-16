import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";

/**
 * P3-17: `/capture`'s OWN route group, deliberately separate from
 * `app/(app)/layout.tsx`. An earlier version of this route lived under
 * `(app)` with a `pathname.startsWith("/capture")` branch that skipped
 * wrapping in `<AppShell>` — that worked on a hard page load but NOT when
 * reached via an in-app `<Link>` from Home: Next.js's App Router does not
 * re-render a shared layout across a client-side navigation between
 * siblings under it, so the AppShell chrome already rendered for Home kept
 * showing through the "swapped" page content. Confirmed live (Playwright
 * against a local dev server, both nav modes, 390px) before this fix.
 * A genuinely separate route group is the correct fix, not a workaround:
 * Next.js always treats a navigation across route-group/layout boundaries
 * as a real segment change, so this route never inherits AppShell's
 * output regardless of how it's reached.
 *
 * Auth + onboarding gating is duplicated from `app/(app)/layout.tsx`'s
 * `AuthedShell` rather than shared, because the two now diverge in exactly
 * the way that mattered here (this one never renders AppShell) — sharing
 * a helper would need a parameter for the one behavior that differs, which
 * is more indirection than two short, independently-readable gates.
 */
export default async function CaptureLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser();
  if (!user) {
    // Reached via a PWA home-screen shortcut or a deep link, not
    // necessarily an already-open session — preserve the destination via
    // `next` (lib/auth/safe-next.ts, the same mechanism P4-13 built for the
    // MCP OAuth consent flow) so signing in returns here, not to Home.
    redirect("/login?next=%2Fcapture");
  }

  const profile = await getProfile();
  if (!profile || profile.onboarding_completed === false) {
    redirect("/onboarding");
  }

  return <>{children}</>;
}
