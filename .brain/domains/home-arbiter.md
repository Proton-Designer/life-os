---
id: domain.home-arbiter
title: Home + Cross-Domain Arbiter
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - lib/home/**
  - app/(app)/page.tsx
related:
  - domain.deen
  - domain.fitness
  - domain.self-mastery
  - domain.business-lockin
  - domain.work-coop
  - domain.school
  - domain.widgets
  - arch.system-overview
answers:
  - "how does home decide what to show"
  - "what is the arbiter's ranking order"
  - "why does home show only one next action"
covers: "Home as the single daily entry point; the cross-domain arbiter that ranks candidates from every domain into one 'Now'"
excludes: "Per-domain data sources feeding Home (see each domain.* doc); metrics/trends (deliberately excluded from Home, see domain.insights)"
tokens_est: 1332
source_hash: 6c6c46ad1b38a66529649deda22df5f5103211af3c4da7bec0c2e1ffcaae8d47
---

# Home + Cross-Domain Arbiter

## Purpose

Home is the single daily entry point, deliberately not a dashboard: what to do right now, where am I in the day, and a doorway into domain detail. Metrics/history live in Insights, not here.

## Key concepts

| Term | Means |
|---|---|
| Candidate | The arbiter's generic ranking unit: `area`, `dueAt`, `weightTier`, `position`, `decay`, `cost`, `riskScore`/`riskConfidence`. |
| Area | `Domain \| "self_mastery"` — `Domain` itself is frozen to `deen\|business\|fitness\|school\|co_op`. |
| Comparator order (verified line-by-line) | `urgency → dueAt → weightTier → position → decay → cost → riskScore` (`lib/home/arbiter.ts:170-206`) — matches root `CLAUDE.md` and `context/PURPOSE-AND-DOMAINS.md` exactly. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Comparator | `lib/home/arbiter.ts` | `rankCandidates` (170-207), `pickPrimaryAndAlternates` (216-225) |
| Candidate mapping | `lib/home/build-candidates.ts` | PriorityItem→Candidate; Self-Mastery due-session→Candidate |
| Weight lookup | `lib/home/resolve-area-weights.ts` | Returns `{}` unconditionally for legacy mode |
| Data assembly | `lib/home/{get-priority-items,get-domain-snapshots,get-domain-pulse,get-home-extras,get-day-shape,day-ribbon,home-kpis,get-weekly-completion,compute-domain-visibility,sector-rows}.ts` (Home "Sector progress" rows + which snapshot queries run come from `sector-rows.ts`: one row per Work tab, only areas the account set up — SECTOR-01) | |
| Entrypoint | `app/(app)/page.tsx` | Composition root |

## How it works

1. One `Promise.all`: priority items, completed-today, domain snapshots, home extras, day shape, weekly-goals row, distraction triggers, in-progress items, Self-Mastery due summary, MCP widgets.
2. `resolveAreaWeights` builds the weight lookup; `selectNextActionPerDomain` picks one item per domain, then ranks cross-domain via the arbiter (still used for the Self-Mastery placement and `isFreshInstall`). `getPriorityItems` is called with `{ allKillListItems: true }` on Home (every open Kill List line for today; the default, used by notifications and the ranking above, stays ONE line, the first).
2b. **The Today panel** (was "Now"; the widget KEY is still `now`): `components/home/today-tasks.tsx` renders ONE ordered list of every task for today, built by the pure `lib/home/today-list.ts#buildTodayList`: crown, other starred plan lines, the rest of the plan (`orderPlanItems`), then ALL priority items arbiter-ranked across domains. "Today" for a priority item = what `getPriorityItems` already returns (tasks with `due_date == local today`, today's Kill List lines, today's fitness row; NO overdue, nothing after today). Prayers are never rows. Dedup by the real id links (a `task-<plan id>` priority item, a Kill List line paired through `kill_list_item_id`); the data layer already hides the common paths. A row's id is unique per ROW (`kill-list-<line id>`, not the constant "kill-list"), because the list's "completed, awaiting server confirmation" bookkeeping (`components/shared/use-row-overlay.ts`, shared with `TaskRowList`) is keyed by it. One row is in focus (a running inline timer OR a running Deep Session on that plan line, else the first pending): full brightness + a "Focus" label; every other row dims ONLY its content marked `data-dim` (title, meta, icon) to 70% (never the action buttons, which read as disabled when dimmed), back to full on hover / focus-within. Every row leaves the same way (strike, 550 ms beat, 200 ms fade + collapse, then Completed) and never comes back while the server catches up.
2c. **The "Right now" strip** (Deen Mode only, top of the Today panel, `components/home/right-now-strip.tsx`): the ONE prayer whose window contains now (`lib/home/current-prayer.ts`; "Prayed" = the same `toggleItem`, sunnah disclosure kept) and the Quran row only inside the Quran reminder window (`lib/home/quran-reminder.ts`; `user_settings.quran_reminder_start/end`, default 22:00-01:00, crosses midnight; migration 261). After midnight the row shows the PREVIOUS local date's portion and logs `{ toPage: displayed .to }` with `forDate: "yesterday"` (never `todaysPortion`: the core computes that from TODAY's date). Re-evaluated client-side once a minute from the props.
3. Render order (IA Option A; This Week's Focus is not in the stack -- it sits INSIDE the title row, `PageHeader` children, from md up: `Home | focus card | actions`, ~48px tall; under the title on a phone): InProgressBanner → morning brief → **`rhythm`** (Morning card / Today strip / Close the day / Done for today, `lib/home/rhythm-state.ts` + `rhythm-data.ts`, `components/home/rhythm/`) → Sunday `weekly_reset` card → Launch sequence (`morning_routine` slot, opt-in) / wind-down set-up (`sleep_intent` slot, opt-in) → (SessionEntryCard if it wins) → WeeklyGoalsHeader (+ Goals sheet) → Sector-progress → Now → `habit_checkoffs` (identity habits + the Faith screen's practices when Deen mode is on: `faithPractices` from `lib/deen/practices.ts`, read only when ON) → Focus → … → Day-shape ribbon → MCP widgets panel. The rhythm card flips at the wind-down start (default 21:00, the user's plan when Sleep plan is on; `isAfterWindDown`, shared with the topbar moon link). Only the active state's queries run.

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | Every domain | Deen (prayers, windowed), Business (kill list, focus minutes, Signal:Noise), School/Work (tasks due today), Fitness (one row), Self-Mastery (due-session, gated on `hasArea(..,"learning")`) |
| Depends on | Widgets | `renderWidgets` calls the real `readTool()`, inheriting MCP's own read filters |
| Feeds | Morning Open, Evening Close | Crowned/starred tasks (`mit_rank`) read back by both |

## Constraints & gotchas

- **Legacy accounts get NO weight tier at all** — `resolveAreaWeights` returns `{}` for `mode:"legacy"`, so every legacy candidate (including the owner's own real daily account) falls to the arbiter's `"important"` floor. Verified directly, not inferred.
- **Business and co_op have no weight/position entry in any mode** — a named, escalated gap (flagged to the lead 2026-09-02).
- **Five of the arbiter's seven tiers are near-always ties today**: `decay` populated only for Self-Mastery; `cost` real only for a scheduled Fitness session; `riskScore`/`riskConfidence` always null (School's risk engine isn't wired into `PriorityItem` yet). In practice only urgency/dueAt do most of the work.
- Prayers are windowed, not instants — a closed-unlogged prayer moves to Qada backlog, not the due-today list.

## Not covered here

- Each domain's own data shape → the relevant `domain.*` doc
- Insights' metrics/trends (deliberately excluded from Home) → `domain.insights`

## Unverified

- `lib/widgets/render.ts` calling the real `readTool()` was not re-verified line-by-line in this pass (verified by a separate MCP-focused pass; treated as confirmed here by cross-reference).
- Whether Home's Focus panel (session-log-based, `work_sessions`) and Insights' Focus Map (check-in-sample-based, `checkin_allocations`) can report different "focus minutes" for the same day — observed as a plausible discrepancy, not documented elsewhere as a known gap.
