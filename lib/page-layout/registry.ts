// WIDGET-01: the declarative registry of every built-in panel a domain
// page renders today. This is the single source of truth both this
// feature's own backend (getLayout/saveLayout, actions-core.ts) and
// WIDGET-02's picker dialog (ENG 3) read from -- adding a widget to a page
// later means adding one entry here, never editing a layout table.
//
// NOT server-only, deliberately: the picker dialog (a Client Component)
// needs `label`/`description` to render its "add a widget" list without a
// round trip, the same reasoning lib/accent-tokens.ts and lib/domain-icons.ts
// already stay plain, importable-from-either-side modules.
//
// WHAT COUNTS AS "A WIDGET" (a design decision, stated here so the two
// halves of this feature never drift on the definition): a top-level,
// independently-titled `<Panel>` (or equivalent named section) with its
// own real content. NOT page headers, top KPI-card strips, or dialogs --
// this codebase already draws that line itself (work/page.tsx's own
// comment on its schedule strip: "deliberately not a <Panel>, since
// wrapping it in one is what made it a module again"). Two pages (Habits,
// Goals) render exactly one widget each today -- registered anyway, since
// the registry's job is completeness, not judging which pages are
// "interesting enough" to configure.
//
// `defaultPosition` is a plain 0-based order within its own domain, not a
// global one -- ties are broken by registry declaration order (Array.sort
// is stable), never by widgetKey/label text, so re-ordering this file's
// own source order is itself a legitimate way to change the shipped
// default.

export interface WidgetDef {
  widgetKey: string;
  domainKey: string;
  label: string;
  description: string;
  defaultPosition: number;
  /**
   * The page no longer renders this widget. The key STAYS in the registry so saved layouts that mention it still
   * validate (findWidget / saveLayout), but the widget manager list does not offer it (getLayoutCore filters it).
   */
  retired?: boolean;
}

const HOME: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "morning_brief", label: "Morning brief", description: "An AI-written summary of what's ahead today, when one was generated overnight." },
  { widgetKey: "rhythm", label: "Your day", description: "The card for where you are in the day: morning plan and Start day, the Today strip, then Close the day." },
  { widgetKey: "weekly_reset", label: "Weekly reset", description: "On Sunday (until Monday noon) a card that opens the weekly reset, until this week's goal is set." },
  { widgetKey: "morning_routine", label: "Launch sequence", description: "Up to five \"when X, I do Y\" steps to start your day, with a 2-minute fallback and an x-of-last-7 count." },
  { widgetKey: "sleep_intent", label: "Wind-down", description: "The one-time set-up for your wake time and sleep need; it follows from your bedtime after that." },
  { widgetKey: "session_entry", label: "Start a session", description: "One tap into today's spaced-review session, when cards or questions are due." },
  { widgetKey: "weekly_goals_header", label: "This week's goals", description: "Your one-line weekly goals, editable in place." },
  { widgetKey: "domain_status", label: "Sector progress", description: "A compact status row across every domain you've turned on." },
  { widgetKey: "now", label: "Now", description: "The Night Plan's starred and crowned tasks for today, in priority order." },
  { widgetKey: "habit_checkoffs", label: "Habits today", description: "Tick off today's identity habits without opening the habits board." },
  { widgetKey: "focus", label: "Focus", description: "Today's Deep Work / Deep Study minutes and session count, plus recent distractions." },
  { widgetKey: "day_shape", label: "The day's shape", description: "A timeline of today's classes, work and focus sessions across your day." },
  { widgetKey: "mcp_widgets", label: "Agent widgets", description: "Data tiles an AI agent you connected has created for you over MCP." },
];

const SCHOOL: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "task_list", label: "Task list", description: "This week's open school tasks across every class." },
  { widgetKey: "school_today", label: "School today", description: "What's due today across your classes.", retired: true },
  { widgetKey: "deadline_risk", label: "Assessments", description: "Every upcoming assessment, grouped Soon / Upcoming / Future, with an editor." },
  { widgetKey: "course_load", label: "Course load", description: "A six-week forecast of how loaded each week ahead is." },
  { widgetKey: "practice_vs_real", label: "Practice vs. real grade", description: "How your closest practice-test score compared to the real exam.", retired: true },
  { widgetKey: "class_cards", label: "Your classes", description: "A card for every class you're taking, with its own quick actions." },
  { widgetKey: "this_weeks_classes", label: "Class schedule", description: "Your class schedule for the current week." },
];

const WORK: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "pipeline", label: "Weekly Agenda Pipeline", description: "The current target's tasks, moving from Backlog through Complete." },
];

const BUSINESS: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "focus_time", label: "Focus time today", description: "Today's Lock-In session count and minutes, with a one-tap Lock In." },
  { widgetKey: "incomplete_tasks", label: "Incomplete tasks", description: "Tasks left open from past days, grouped by date." },
  { widgetKey: "kill_list", label: "Today's kill list", description: "The three things that must get done today." },
  { widgetKey: "weekly_goal", label: "This week's goal", description: "The one outcome this week is actually about." },
  { widgetKey: "completed_goals_archive", label: "Completed goals", description: "Past weekly goals you've already finished." },
];

const DEEN: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "salah", label: "Salah", description: "Today's five prayers, logged as you pray them." },
  { widgetKey: "quran", label: "Qur'an", description: "This week's pages read, plus your current surah and juz." },
  { widgetKey: "reflection", label: "Reflection", description: "Your own daily reflection entries." },
  { widgetKey: "habit_builder", label: "Habit Builder", description: "A focused deen habit and its recent consistency." },
  { widgetKey: "prayer_consistency", label: "Prayer consistency", description: "Your on-time prayer rate over the last 30 days." },
];

const FITNESS: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "daily_log", label: "Daily Log", description: "Today's pending workout items, ready to log." },
  { widgetKey: "this_week", label: "This week", description: "This week's training volume and adherence to your plan." },
  { widgetKey: "cycle_progress", label: "Cycle Progress checks", description: "Weight/waist tracking plus your current training cycle's benchmarks." },
];

const SELF_MASTERY: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "search", label: "Search your library", description: "Semantic search across everything you've read." },
  { widgetKey: "weekly_recap", label: "Weekly retention recap", description: "How well last week's reading actually stuck." },
  { widgetKey: "overconfidence", label: "Overconfidence check", description: "How well your confidence taps have matched real outcomes." },
  { widgetKey: "fsrs_tuning", label: "Review scheduling", description: "Personalized spaced-review tuning, once you've logged enough reviews." },
  { widgetKey: "teach_back", label: "Teach-Back mode", description: "Explain a lesson in your own words and get gap feedback." },
  { widgetKey: "library", label: "Your books", description: "Every book you've added, with its own reading progress." },
];

const HABITS: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "habit_list", label: "Identity habits", description: "Vote once a day for who you're becoming." },
];

const GOALS: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "goal_board", label: "Monthly goals", description: "Your ranked, cross-domain goals for this month." },
];

const INSIGHTS: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "this_week_trend", label: "This week", description: "Your daily completion-percent trend over the last 7 days." },
  { widgetKey: "signal_noise_by_week", label: "Signal:Noise by week", description: "Other-commitments vs. wasted minutes, one bar per week." },
  { widgetKey: "week_over_week", label: "Week over week", description: "How this week compares to recent weeks." },
  { widgetKey: "focus_map", label: "Focus Map", description: "Where your time actually went today, by domain." },
  { widgetKey: "signal_noise", label: "Signal:Noise", description: "Today's split between committed time and noise." },
  { widgetKey: "per_domain", label: "Per-domain", description: "A breakdown of check-in answers by domain." },
  { widgetKey: "rescuetime", label: "RescueTime", description: "Your connected RescueTime activity, when linked." },
];

const WEEKLY_REVIEW: readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[] = [
  { widgetKey: "your_week", label: "Your week", description: "An AI-written narrative of how the week went, when one was generated." },
  { widgetKey: "review", label: "Week in review", description: "Hours, recall, efficiency, your Pareto breakdown, and habit summaries for the week." },
  { widgetKey: "course_load", label: "Course load", description: "A six-week forecast of how loaded each week ahead is." },
];

const DOMAIN_WIDGETS: readonly [string, readonly Omit<WidgetDef, "domainKey" | "defaultPosition">[]][] = [
  ["home", HOME],
  ["school", SCHOOL],
  ["work", WORK],
  ["business", BUSINESS],
  ["deen", DEEN],
  ["fitness", FITNESS],
  ["self_mastery", SELF_MASTERY],
  ["habits", HABITS],
  ["goals", GOALS],
  ["insights", INSIGHTS],
  ["weekly_review", WEEKLY_REVIEW],
];

/** Every registered domain key, in the order this file declares them. */
export const DOMAIN_KEYS: readonly string[] = DOMAIN_WIDGETS.map(([domainKey]) => domainKey);

/** The full, flattened registry -- `defaultPosition` assigned here, once, from each domain's own array order. */
export const WIDGET_REGISTRY: readonly WidgetDef[] = DOMAIN_WIDGETS.flatMap(([domainKey, widgets]) =>
  widgets.map((w, i) => ({ ...w, domainKey, defaultPosition: i }))
);

const BY_DOMAIN = new Map<string, WidgetDef[]>();
for (const w of WIDGET_REGISTRY) {
  const list = BY_DOMAIN.get(w.domainKey) ?? [];
  list.push(w);
  BY_DOMAIN.set(w.domainKey, list);
}

/** Every widget registered for one domain, in registry (default) order. Empty array for an unknown domainKey -- never throws. */
export function widgetsForDomain(domainKey: string): readonly WidgetDef[] {
  return BY_DOMAIN.get(domainKey) ?? [];
}

/** The one registry entry for (domainKey, widgetKey), or undefined -- the lookup a stored-but-retired key misses (see actions-core.ts's own header on why that's a filter, not an error). */
export function findWidget(domainKey: string, widgetKey: string): WidgetDef | undefined {
  return BY_DOMAIN.get(domainKey)?.find((w) => w.widgetKey === widgetKey);
}

/**
 * Home widgets that belong to an opt-in feature (profiles.enabled_features, RS-01): while the
 * feature is OFF the module cannot render, so the customiser must not offer to hide/reorder it.
 * Stored rows are untouched and come back with the feature.
 */
export const OPT_IN_HOME_WIDGETS: Readonly<Record<string, "morning_routine" | "sleep_plan">> = {
  morning_routine: "morning_routine",
  sleep_intent: "sleep_plan",
};
