import { Moon, Target, Dumbbell, GraduationCap, Users, Briefcase, type LucideIcon } from "lucide-react";
import type { Domain, DisplayDomain } from "@/lib/home/types";

// Single source of truth for domain glyphs — every IconChip/nav item that
// needs a domain icon imports from here so the mapping stays identical
// everywhere a domain is referenced. Stays a plain exhaustive Record over
// the closed `Domain` union — every existing caller passes one of these 5
// real values, and keeping this a Record (not a function) means TypeScript
// still flags a forgotten member if a 6th real domain is ever added here.
export const DOMAIN_ICON: Record<Domain, LucideIcon> = {
  deen: Moon,
  business: Target,
  fitness: Dumbbell,
  school: GraduationCap,
  co_op: Users,
};

// Same icon Engineer 2 already chose for the Work top-level domain in
// onboarding's own domain-meta.ts — a user-created Work subdomain that
// hasn't been assigned anything more specific reads as "some kind of work,"
// consistent with the top-level Work icon rather than a brand-new glyph.
const FALLBACK_DOMAIN_ICON: LucideIcon = Briefcase;

/**
 * The safe lookup for anything typed `DisplayDomain` rather than `Domain`
 * (GoalCard, TaskRowList) — a bracket lookup into DOMAIN_ICON directly
 * would type-check for a widened value and return `undefined` at runtime,
 * which IconChip's required `icon` prop turns into a hard render crash, not
 * a silently-blank chip. See the DisplayDomain comment in lib/home/types.ts
 * for why this is a real trap and not a hypothetical one.
 */
export function getDomainIcon(domain: DisplayDomain): LucideIcon {
  return (DOMAIN_ICON as Record<string, LucideIcon>)[domain] ?? FALLBACK_DOMAIN_ICON;
}
