import { BookOpen, ListTodo, Sprout, type LucideIcon } from "lucide-react";
import { DOMAIN_ACCENT, type AccentToken } from "@/lib/accent-tokens";
import { DOMAIN_ICON } from "@/lib/domain-icons";
import type { PlanArea } from "@/lib/plan/plan-behavior";

/**
 * The leading icon chip of a plan row in Home's Today list, so plan rows and priority rows read as one list (their titles
 * start at the same x). The user's plan areas map onto the app's domain glyphs where one exists (Business -> Business,
 * School -> School, Work -> Work, Fitness -> Fitness, Faith -> Deen); Self-Mastery and Personal growth have no domain glyph,
 * and a line with no area gets a neutral one.
 */
export function planAreaChip(area: PlanArea | null): { icon: LucideIcon; accent: AccentToken } {
  switch (area) {
    case "business":
      return { icon: DOMAIN_ICON.business, accent: DOMAIN_ACCENT.business };
    case "school":
      return { icon: DOMAIN_ICON.school, accent: DOMAIN_ACCENT.school };
    case "work":
      return { icon: DOMAIN_ICON.co_op, accent: DOMAIN_ACCENT.co_op };
    case "body":
      return { icon: DOMAIN_ICON.fitness, accent: DOMAIN_ACCENT.fitness };
    case "faith":
      return { icon: DOMAIN_ICON.deen, accent: DOMAIN_ACCENT.deen };
    case "learning":
      return { icon: BookOpen, accent: "info" };
    case "personal_growth":
      return { icon: Sprout, accent: "info" };
    default:
      return { icon: ListTodo, accent: "neutral" };
  }
}
