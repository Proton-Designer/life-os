import { redirect } from "next/navigation";
import { getAuthedUser, getProfile } from "@/lib/supabase/auth";
import { isDeenModeOn } from "@/lib/deen/deen-mode";
import { getUserDomains } from "@/lib/domains/get-user-domains";
import { computeNavDomainState } from "@/lib/shell/nav-domain-state";
import { buildCaptureAreaConfig } from "@/lib/capture/areas";
import { CapturePageClient } from "@/components/capture/capture-page-client";

/**
 * P3-17: a dedicated, mobile-first capture route, living in its own
 * `(capture)` route group with its own layout (see that file's header for
 * why) — no AppShell, no nav/topbar/kill-list/calendar queries. The whole
 * point of a fast-capture entry point is that this is the only thing that
 * has to load, whether reached from a PWA home-screen shortcut
 * (public/manifest.json) or the "Open full page" link in GlobalCaptureSheet.
 *
 * Re-checks auth itself even though the layout already redirected an
 * unauthenticated visitor before this ever renders — same defense-in-depth
 * every page.tsx in `app/(app)/` also does on top of its own layout gate.
 */
export default async function CapturePage() {
  const user = await getAuthedUser();
  if (!user) redirect("/login");
  const profile = await getProfile();
  const timezone = profile?.timezone ?? "UTC";
  const deenMode = isDeenModeOn(profile);
  const userDomains = await getUserDomains();
  const nav = userDomains.mode === "domains" ? computeNavDomainState(userDomains.domains, userDomains.subdomains, deenMode) : null;
  return <CapturePageClient timezone={timezone} deenMode={deenMode} areas={buildCaptureAreaConfig(userDomains.mode, nav)} />;
}
