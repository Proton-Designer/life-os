import { Moon, Target, Dumbbell, GraduationCap, Users, type LucideIcon } from "lucide-react";
import type { Domain } from "@/lib/home/types";

// Single source of truth for domain glyphs — every IconChip/nav item that
// needs a domain icon imports from here so the mapping stays identical
// everywhere a domain is referenced.
export const DOMAIN_ICON: Record<Domain, LucideIcon> = {
  deen: Moon,
  business: Target,
  fitness: Dumbbell,
  school: GraduationCap,
  co_op: Users,
};
