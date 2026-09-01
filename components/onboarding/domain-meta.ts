import { Compass, Briefcase, GraduationCap, Moon, BookOpen, Dumbbell, type LucideIcon } from "lucide-react";
import type { AccentToken } from "@/lib/accent-tokens";
import type { DomainKey, PersonalSubdomainKey } from "./types";

// Local to onboarding — deliberately not touching lib/domain-icons.ts or
// lib/accent-tokens.ts's DOMAIN_ACCENT map, both keyed to the existing
// lib/home/types.ts `Domain` union. Widening that union is T-0003, deferred
// to Phase 2. These reuse the same AccentToken/CSS-var system so the palette
// is consistent, without touching code that isn't ours to touch this phase.
interface DomainMeta {
  label: string;
  icon: LucideIcon;
  accent: AccentToken;
  description: string;
}

export const TOP_DOMAIN_META: Record<DomainKey, DomainMeta> = {
  personal_growth: {
    label: "Personal Growth",
    icon: Compass,
    accent: "deen",
    description: "Faith, self-mastery, and fitness.",
  },
  work: {
    label: "Work",
    icon: Briefcase,
    accent: "coop",
    description: "Jobs and businesses you want to track.",
  },
  school: {
    label: "School",
    icon: GraduationCap,
    accent: "school",
    description: "Classes, assignments, and deadlines.",
  },
};

export const TOP_DOMAIN_ORDER: DomainKey[] = ["personal_growth", "work", "school"];

export const PERSONAL_SUBDOMAIN_META: Record<PersonalSubdomainKey, DomainMeta> = {
  faith: {
    label: "Faith",
    icon: Moon,
    accent: "deen",
    description: "Prayer, Qur'an, reflection.",
  },
  self_mastery: {
    label: "Self-Mastery",
    icon: BookOpen,
    accent: "info",
    description: "Reading, learning, spaced review.",
  },
  fitness: {
    label: "Fitness",
    icon: Dumbbell,
    accent: "fitness",
    description: "Training plans and daily logs.",
  },
};

// Fixed walk order for asking per-subdomain questions — independent of any
// future reordering UI, matches the order these were specified in.
export const PERSONAL_SUBDOMAIN_ORDER: PersonalSubdomainKey[] = ["faith", "self_mastery", "fitness"];
