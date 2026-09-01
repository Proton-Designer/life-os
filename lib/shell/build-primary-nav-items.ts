import { Home, Compass, Briefcase, GraduationCap, type LucideIcon } from "lucide-react";
import type { AccentToken } from "@/lib/accent-tokens";
import type { NavDomainState } from "./nav-domain-state";

export interface PrimaryNavItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  accent: AccentToken;
  /** What pathname prefix counts as "this tab is active," when it differs
   * from `href` itself. Work's link jumps straight to the first subdomain
   * (`/work/<slug>`), but every `/work/*` route — any subdomain, not just
   * the first — should still show the Work tab as active. Defaults to
   * `href` when omitted (Home/Personal/School, whose href already covers
   * the whole tab). */
  activeBase?: string;
}

// The M4 four-tab rule: Home is universal, Personal/Work/School each appear
// only if the user actually selected that top-level domain during
// onboarding. Never gated on subdomain count — a tenth Work subdomain never
// adds an item here, only content inside the existing Work tab.
export function buildPrimaryNavItems(state: NavDomainState): PrimaryNavItem[] {
  const items: PrimaryNavItem[] = [{ key: "home", href: "/", label: "Home", icon: Home, accent: "info" }];

  if (state.hasPersonalGrowth) {
    items.push({ key: "personal", href: "/personal", label: "Personal", icon: Compass, accent: "deen" });
  }
  if (state.hasWork) {
    const firstWorkSubdomain = state.workSubdomains[0]?.key;
    items.push({
      key: "work",
      href: firstWorkSubdomain ? `/work/${firstWorkSubdomain}` : "/work",
      activeBase: "/work",
      label: "Work",
      icon: Briefcase,
      accent: "coop",
    });
  }
  if (state.hasSchool) {
    items.push({ key: "school", href: "/school", label: "School", icon: GraduationCap, accent: "school" });
  }

  return items;
}
