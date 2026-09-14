import { SelfMasteryLibrary } from "@/components/self-mastery/self-mastery-library";

/**
 * Legacy-mode + direct-URL entry point for Self-Mastery (S6, 2026-09-14).
 *
 * WHY THIS ROUTE EXISTS, SEPARATE FROM /personal/self_mastery: that route
 * lives under app/(app)/personal/[subdomain]/, whose OWN layout.tsx
 * redirects any account in `mode: "legacy"` away from `/personal/*`
 * entirely before this page would ever render (`kept.length === 0 ->
 * redirect("/")` — see that file's own header). Ayman's own real daily
 * account is legacy mode. A legacy account therefore had NO working route
 * to Self-Mastery at all — not a hidden feature, an absent one, and
 * `components/shell/sidebar-nav.tsx` (the ONLY nav legacy accounts render)
 * had no link to it regardless, compounding the same gap from the other
 * direction. This route and the sidebar-nav.tsx entry pointing at it are
 * the fix for both halves at once.
 *
 * ADAPT, DON'T REWRITE (M5, the same convention
 * personal/[subdomain]/page.tsx already follows for Deen/Fitness):
 * composes the exact same `SelfMasteryLibrary` Server Component that
 * /personal/self_mastery renders. One data source, one UI, two doors in —
 * sidebar-nav.tsx (legacy) and any direct link/bookmark land here;
 * domains-mode's Personal tab still goes through /personal/self_mastery
 * for its subdomain-tab chrome (Faith/Fitness/Self-Mastery switcher). A
 * domains-mode account landing here directly still sees identical content,
 * just without that chrome — not a broken state, a smaller one.
 */
export default function SelfMasteryPage() {
  return <SelfMasteryLibrary />;
}
