import {
  ListChecks,
  Timer,
  Target,
  TrendingUp,
  AlertTriangle,
  PieChart,
  Sunrise,
  Gauge,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { WorkSubdomainKind } from "./types";

// The Work-subdomain widget catalogue — sourced from Engineer 2's
// cross-cutting systems research (2026-09-01): the confirmed-drop-in and
// confirmed-real-gap findings recorded in DECISIONS.md D-010/D-011.
//
// "both" = preselected regardless of job/business. "job"/"business" =
// preselected only for that kind, still offered (just unchecked) for the
// other. "none" = offered, never preselected — currently only the
// identity-card ritual, cut from defaults per D-011 for reading as
// achievement/gamification framing against LifeOS's by-name anti-gamification
// stance.
export type WidgetDefault = "job" | "business" | "both" | "none";

export interface WidgetCatalogueEntry {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  defaultFor: WidgetDefault;
  source: "lifeos" | "collegeos";
}

export const WORK_WIDGET_CATALOGUE: WidgetCatalogueEntry[] = [
  {
    id: "goal_card",
    label: "Goal",
    description: "One headline goal for this subdomain, with milestones.",
    icon: Target,
    defaultFor: "both",
    source: "lifeos",
  },
  {
    id: "task_pipeline",
    label: "Task pipeline",
    description: "What's next, in progress, and done — one weekly view.",
    icon: ListChecks,
    defaultFor: "both",
    source: "lifeos",
  },
  {
    id: "kill_list",
    label: "Daily top 3",
    description: "Three priorities you protect each day, checkable.",
    icon: ListChecks,
    defaultFor: "both",
    source: "lifeos",
  },
  {
    id: "focus_time_card",
    label: "Focus sessions",
    description: "Locked-in deep work/study sessions with live elapsed time.",
    icon: Timer,
    defaultFor: "both",
    source: "lifeos",
  },
  {
    id: "deliverable_session_starter",
    label: "Deliverable session starter",
    description: "Commit to what you're producing before the timer starts.",
    icon: Sparkles,
    defaultFor: "both",
    source: "collegeos",
  },
  {
    id: "distraction_pareto",
    label: "Distraction breakdown",
    description: "What's actually pulling focus, ranked by frequency.",
    icon: PieChart,
    defaultFor: "both",
    source: "collegeos",
  },
  {
    id: "deadline_risk_widget",
    label: "Deadline radar",
    description: "Deadlines ranked by real risk of being missed, not just proximity.",
    icon: AlertTriangle,
    defaultFor: "business",
    source: "collegeos",
  },
  {
    id: "load_forecast",
    label: "Load forecast",
    description: "A 3-week-ahead view of what's piling up, with overflow warnings.",
    icon: TrendingUp,
    defaultFor: "business",
    source: "collegeos",
  },
  {
    id: "day_structure",
    label: "Day structure",
    description: "A start-of-day marker and a running clock for the day's shape.",
    icon: Sunrise,
    defaultFor: "job",
    source: "collegeos",
  },
  {
    id: "efficiency_metric",
    label: "Efficiency",
    description: "Completed work time as a share of your day.",
    icon: Gauge,
    defaultFor: "job",
    source: "collegeos",
  },
  {
    id: "identity_card_ritual",
    label: "End-of-session ritual",
    description: "A short reflect-and-close ritual when you end a session.",
    icon: Sparkles,
    // D-011: offered, never preselected.
    defaultFor: "none",
    source: "collegeos",
  },
];

export function defaultWidgetIdsFor(kind: WorkSubdomainKind): string[] {
  return WORK_WIDGET_CATALOGUE.filter((w) => w.defaultFor === "both" || w.defaultFor === kind).map((w) => w.id);
}
