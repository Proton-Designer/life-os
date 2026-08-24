# Distractions system — spec (Engineer A + C)

**Scope authority:** `docs/superpowers/specs/2026-08-23-overnight-session-REQUIREMENTS.md`.
If this file disagrees with that one, that one wins.

**Ayman is asleep. No questions to him — route everything to the Opus Lead.**

---

## 1. Schema — migration `041_distractions.sql` (Engineer A)

Follow `027`/`029` conventions exactly: RLS enabled, one `<table>_own_row`
policy `for all` using `(select auth.uid())`, `user_id` indexed, RPCs
`security invoker` + `set search_path = public` + explicit `grant execute`.

```sql
distraction_triggers (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain text not null check (domain in ('deen','business','school','fitness','co_op')),
  name text not null,
  description text,            -- the "short textbox to explain the trigger"
  archived boolean not null default false,
  created_at timestamptz not null default now()
)
create unique index distraction_triggers_unique_name
  on distraction_triggers (user_id, domain, lower(name)) where not archived;

distraction_events (
  id uuid pk,
  user_id uuid not null default auth.uid(),
  trigger_id uuid not null references distraction_triggers(id) on delete cascade,
  date date not null,                    -- LOCAL date, from localDateString(now, profile.timezone)
  reflection_tier int check (reflection_tier in (1,2,3)),  -- deen only, optional
  reflection_entry_id uuid references reflection_entries(id) on delete set null,
  created_at timestamptz not null default now()
)
create index distraction_events_user_date on distraction_events (user_id, date);

trigger_action_plans (
  id uuid pk,
  user_id uuid not null default auth.uid(),
  trigger_id uuid not null references distraction_triggers(id) on delete cascade,
  body text not null,
  version int not null,
  superseded_at timestamptz,
  supersede_reason text check (supersede_reason in ('followed_failed','never_followed')),
  created_at timestamptz not null default now()
)
create unique index trigger_action_plans_version on trigger_action_plans (trigger_id, version);
-- THE CURRENT PLAN is the single row for a trigger with superseded_at is null.
create unique index trigger_action_plans_one_current
  on trigger_action_plans (trigger_id) where superseded_at is null;

trigger_plan_outcomes (
  id uuid pk,
  user_id uuid not null default auth.uid(),
  trigger_id uuid not null references distraction_triggers(id) on delete cascade,
  plan_id uuid not null references trigger_action_plans(id) on delete cascade,
  date date not null,
  followed boolean not null,
  created_at timestamptz not null default now()
)
create unique index trigger_plan_outcomes_one_per_day
  on trigger_plan_outcomes (user_id, trigger_id, date);
```

`trigger_action_plans_one_current` is the important one — it makes "two live
plans for one trigger" unrepresentable rather than something the app has to
remember not to do. Superseding and inserting must therefore happen in ONE
transaction; do it in a `security invoker` plpgsql RPC
(`save_trigger_plan(p_trigger_id uuid, p_body text, p_reason text)`), not two
round trips from the action. Two round trips will violate the index the
moment anything retries.

### Deen reflection linkage — deliberately NOT a refactor

`reflection_entries` stays exactly as it is. When a Deen capture carries a
tier, the action inserts a normal `reflection_entries` row (same shape the
existing `logReflectionEntry` writes) AND a `distraction_events` row holding
that entry's id. The existing Deen Reflection module keeps reading
`reflection_entries` and lights up with no changes at all.

Do **not** migrate `reflection_entries` into the new tables. It was
considered and rejected for tonight: Engineer C is simultaneously rebuilding
the Deen reflection calendar on top of that table, and a schema move
underneath them is how we lose the night.

---

## 2. Type contract — both engineers code against this from hour one

`lib/distractions/types.ts` (Engineer A creates it first, before anything else,
and tells the Lead the moment it is committed — Engineer C is blocked on it):

```ts
export type DistractionDomain = "deen" | "business" | "school" | "fitness" | "co_op";

export type ActionPlan = {
  id: string;
  body: string;
  version: number;
  createdAtIso: string;
  /** Outcomes recorded against THIS plan version only. */
  followedCount: number;
  skippedCount: number;
  /** skippedCount >= 3 && followedCount === 0 — the review must force a rewrite. */
  mustRewrite: boolean;
};

export type TriggerSummary = {
  id: string;
  domain: DistractionDomain;
  name: string;
  description: string | null;
  /** All-time event count — this is the capture list's sort key. */
  totalCount: number;
  todayCount: number;
  lastOccurredAtIso: string | null;
  createdDate: string;          // local YYYY-MM-DD
  currentPlan: ActionPlan | null;
};

export type ReviewItem = {
  trigger: TriggerSummary;
  todayCount: number;
  /** No current plan → the review demands one, with no follow/skip question. */
  isNew: boolean;
};
```

`lib/distractions/plan-rules.ts` — pure, no React, no I/O:

```ts
export const REVIEW_AVAILABLE_HOUR = 21;   // 9 PM local
export const FORCED_REWRITE_AFTER_SKIPS = 3;
export function mustRewrite(followedCount: number, skippedCount: number): boolean;
/** Capture-list order: totalCount desc, then lastOccurredAt desc, then name asc. */
export function rankTriggersForCapture(triggers: TriggerSummary[]): TriggerSummary[];
/** Action-Plan-dialog order: lastOccurredAt desc. Excludes currentPlan === null. */
export function rankTriggersForPlanList(triggers: TriggerSummary[]): TriggerSummary[];
/** True once local time is past REVIEW_AVAILABLE_HOUR. Pure — takes `now` and tz. */
export function isReviewOpen(now: Date, timezone: string): boolean;
```

Unit-test these with adversarial input, not just the happy path: zero
triggers, ties on every sort key, a plan with 3 skips AND 1 follow (must be
`false` — a plan that has ever been followed is never force-rewritten),
exactly 2 skips (false), exactly 3 (true).

---

## 3. Server actions — `app/(app)/distractions/actions.ts` (Engineer A)

```ts
logDistraction(triggerId: string, tier?: 1 | 2 | 3): Promise<void>
createTriggerAndLog(input: { domain, name, description, tier? }): Promise<{ triggerId: string }>
updateTrigger(triggerId: string, patch: { name?: string; description?: string }): Promise<void>
saveActionPlan(triggerId: string, body: string): Promise<void>
recordPlanOutcome(input: { triggerId, followed: boolean, newPlanBody?: string }): Promise<void>
```

- Every date is `localDateString(now, profile.timezone)`. Never UTC. This
  class of bug has shipped twice in this repo already.
- `recordPlanOutcome` with `followed: true` REQUIRES `newPlanBody` — throw if
  absent. Following the plan and slipping anyway means the plan is wrong; the
  UI must not be able to submit that branch without a revision.
- `recordPlanOutcome` with `followed: false` keeps the plan, unless the
  resulting counts trip `mustRewrite`, in which case `newPlanBody` is also
  required. Compute this server-side; do not trust the client's `mustRewrite`.
- `revalidatePath` the affected routes.

---

## 4. Capture popup — `components/distractions/` (Engineer A)

Trigger: a button labelled **Distractions** in the CENTRE of the topbar,
directly under the "Life OS" mark. Present on every screen.

Two-step dialog:

**Step 1 — pick a domain.** Five options, domain-tinted with the existing
`DOMAIN_ACCENT` / `DOMAIN_ICON` tokens. Order: Deen, Business, School,
Fitness, Work.

**Step 2 — pick a trigger.** Top of the panel: a `+ New trigger` button.
Below it: a search box filtering by name. Below that: every non-archived
trigger in that domain, ordered by `rankTriggersForCapture` (frequency, most
frequent at top).

- Tapping an existing trigger logs an event **and closes the dialog.** One tap.
- `+ New trigger` opens a name field plus the short description textbox
  ("explain the trigger"). Save creates the trigger, logs one event, closes.
  **No action plan is authored here** — that is the nightly review's job.
- **Deen only:** the right-hand side of step 2 additionally shows the
  Light / Moderate / Heavy control from the Deen Reflection module. It is
  OPTIONAL — logging with no tier selected is valid and must stay one tap.
  A selected tier is passed through to the action, which writes the
  `reflection_entries` row per §1.

Use `useOptimistic` for the count updates — the codebase idiom, see
`components/home/next-actions.tsx`. Do NOT call `window.location.reload()`.

---

## 5. Review — `app/(app)/review/` (Engineer A)

A **Review** button appears in the topbar to the RIGHT of the Distractions
button, and only once local time is past `REVIEW_AVAILABLE_HOUR` (9 PM).
Availability is computed from `isReviewOpen`; seed `now` from the server the
same way `next-actions.tsx` seeds `nowIso`, so first paint matches the server
render and there is no hydration mismatch.

The route lists every trigger with at least one event today, grouped by
domain, **in this order, skipping domains with no events: Deen, Business,
School, Fitness, Work.**

Per trigger:
- Name, description, today's count.
- **No current plan** (`isNew`) → a required plan textbox. No follow/skip question.
- **Has a current plan** → show the plan, then two buttons:
  - *"I didn't follow it"* → records `followed: false`, plan stands, move on.
    Except when this trips `mustRewrite`, where the textbox opens and is
    required, framed as: **"This plan has never once survived contact.
    Rewrite it smaller."**
  - *"I followed it, it happened anyway"* → the textbox opens and is
    required; saving supersedes the old plan and writes the next version.
- Superseded plans stay visible as a collapsed history under the current one.

A progress counter across the top (`4 of 7 reviewed`). The finish state shows
the resulting set of plans — the ritual ends on the payoff, not on a list of
failures.

---

## 6. Home Focus module (Engineer C)

`components/home/focus-module.tsx`. Consumes §2's contract; does not touch
Engineer A's files.

- Move the **Lock In** button to the RIGHT of the Focus content instead of
  beneath it. Keep it full-height-aligned and keep the existing active-session
  view working.
- Beneath the Focus part, in the same panel, add a **Distractions** subsection:
  the count of today's distractions, with an **Action Plan** button on its right.
- **Action Plan** opens a dialog listing triggers by `rankTriggersForPlanList`
  (most recent first), each with its current plan. Both the trigger (name,
  description) and the plan body are editable here, via `updateTrigger` and
  `saveActionPlan`.
- **Triggers with no current plan are excluded** — they are waiting on
  tonight's review. This is explicit in the requirements; do not show them
  greyed out, omit them.
- This dialog is NOT the nightly review. No follow/skip questions here.

---

## Constraints (both engineers)

- **RSC boundary** (`AGENTS.md`): never pass a plain function from a Server to
  a Client Component. Server Actions survive via `.bind(null, arg)`. `tsc` and
  vitest do NOT catch this — load the page in a real browser and read the console.
- **Shared working tree.** `git diff HEAD -- <path>` on EVERY file before
  staging; a file that is legitimately yours can already carry another
  engineer's uncommitted hunk. Read the full unfiltered `git status --short`.
  Pathspec-limit every commit: `git commit -m "..." -- <paths>`. Never
  `git add -A`, never `git stash`, never `reset --hard`.
- **`database.types.ts` is serialized through the Lead.** Ping before you
  regenerate; do not race the other engineers on it.
- **Do not touch** any file owned by another engineer (see the Lead's
  dispatch message for the ownership map).
