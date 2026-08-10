# Life OS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Apply superpowers:test-driven-development discipline within each task** — write the test before the implementation for every piece of business logic. Given this plan's scale (full-stack app, ~20 tasks), each task below specifies exact schema/interfaces/acceptance criteria rather than hand-written failing-test-code for every trivial CRUD field; convert each task's "Acceptance criteria" into real test code first, watch it fail, then implement. This is a deliberate scoping decision, documented per [[feedback-overnight-autonomous-mode]] — the author of this plan (Opus lead) is not present to clarify further.

**Goal:** Ship a fully working, deployed "Life OS" PWA — desktop web + mobile-responsive — implementing the full design spec (`docs/superpowers/specs/2026-08-09-life-os-design.md`) end to end: 5 domain screens, unified Home, universal Pulse Check-ins, weekly planning, Insights, Settings, real Supabase auth/DB, push notifications, deployed live on Vercel.

**Architecture:** Next.js 15 App Router (TypeScript) on Vercel. Supabase for Postgres + Auth (`@supabase/ssr` cookie-based sessions) + Edge Functions (scheduled push dispatch via `pg_cron`). Server Components for reads, Server Actions for writes, revalidated per-path. Tailwind CSS + shadcn/ui for components, dark-first custom theme. Manual service worker (no PWA framework plugin — more reliable with App Router) + Web Push via VAPID keys.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), `web-push` (Edge Function), Playwright (E2E verification), Vercel CLI (deploy).

## Global Constraints

- Single real user via Supabase Auth (email + password) — not multi-tenant, but real auth is required since the app is deployed to a public URL. No sign-up UI needed beyond a one-time seed; login screen only.
- RLS enabled on every table, policy `auth.uid() = user_id`, as defense-in-depth even for a single user.
- `NEXT_PUBLIC_*` env vars are the only ones ever imported into client components. `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN` are server-only / CLI-only — grep for accidental client-side imports before every commit that touches env usage.
- Week boundary: Sunday–Saturday, everywhere "weekly" applies. Day boundary: midnight local time (per spec's "Time & Calendar Fundamentals").
- Dark-first theme only for v1 (no light mode toggle) — near-black base (`#0a0a0c`), oxblood/ember radial accent (`#2b0e13` range), per-domain accent colors: Deen/Fitness = amber/gold, Business/Signal = emerald, School = blue, Noise = red.
- Mobile nav = floating glass island (Home, Deen, Business, School, More→{Fitness, Co-op}), compact/short height. Desktop nav = top bar, all 6 links.
- Every mutation (task complete, prayer marked, check-in answered, etc.) must work from Home inline where the spec says so — do not require a domain-page visit for actions the spec marks as Home-inline.
- Commit after every task using the repo's existing convention (see `git log` — plain, descriptive, no marketing language). Never `git push --force`, never skip hooks.

---

## Phase 0: Project Scaffolding

### Task 0.1: Initialize Next.js project + Tailwind + shadcn/ui

**Files:**
- Create: entire Next.js project structure at repo root (`app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `tailwind.config.ts`, `components.json`)
- Modify: `.gitignore` (add `.vercel/`, `*.tsbuildinfo`)

**Interfaces:**
- Produces: `app/layout.tsx` root layout, `lib/utils.ts` (shadcn `cn()` helper), Tailwind theme tokens matching the palette in Global Constraints.

- [ ] **Step 1:** Run `npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm` (accept overwrite prompts only for files this repo doesn't already have — do not overwrite `docs/`, `.env.local`, `PROJECT_STATUS.md`, `.git`).
- [ ] **Step 2:** Run `npx shadcn@latest init` — choose the "neutral" base color (will be overridden by custom tokens next).
- [ ] **Step 3:** In `app/globals.css`, define the dark theme CSS variables: background `#0a0a0c`, an oxblood radial-gradient background layer, and CSS custom properties for `--accent-deen` (amber `#e0a030`), `--accent-business` (emerald `#4caf7d`), `--accent-school` (blue `#6aa9ff`), `--accent-noise` (red `#e85050`). Set `html { color-scheme: dark }` and force dark as the only theme (no light variant needed for v1 per Global Constraints).
- [ ] **Step 4:** Verify `npm run dev` starts and serves the default page at `localhost:3000` with the dark background visible (manual check, not automated — this task has no business logic to unit test).
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with Tailwind, shadcn/ui, and dark theme tokens"
```

### Task 0.2: Supabase client setup (browser + server)

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`
- Test: `lib/supabase/__tests__/client.test.ts`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local`.
- Produces: `createClient()` (browser, from `lib/supabase/client.ts`), `createClient()` (server, from `lib/supabase/server.ts`, async, reads cookies via `next/headers`), `updateSession(request)` (from `lib/supabase/middleware.ts`) — all three follow the standard `@supabase/ssr` Next.js App Router pattern.

- [ ] **Step 1:** Run `npm install @supabase/supabase-js @supabase/ssr`.
- [ ] **Step 2:** Implement `lib/supabase/client.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```
- [ ] **Step 3:** Implement `lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // called from a Server Component; middleware refreshes the session instead
          }
        },
      },
    }
  )
}
```
- [ ] **Step 4:** Implement `lib/supabase/middleware.ts` + root `middleware.ts` following the standard Supabase SSR session-refresh pattern (`supabase.auth.getUser()` inside `updateSession`, matcher excluding static assets).
- [ ] **Step 5:** Write `lib/supabase/__tests__/client.test.ts` asserting `createClient()` throws a clear error if `NEXT_PUBLIC_SUPABASE_URL` is unset (guards against silent misconfiguration). Run it, confirm it fails without the env guard, add the guard, confirm it passes.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Supabase SSR client setup for browser, server, and middleware"
```

---

## Phase 1: Database Schema

### Task 1.1: Core schema migration

**Files:**
- Create via Supabase MCP `apply_migration` tool (name: `001_core_schema`) — do not hand-write a SQL file separately, apply directly so `list_migrations` reflects it.
- Test: after applying, run `mcp__plugin_supabase_supabase__list_tables` and confirm all tables below exist with RLS enabled.

**Interfaces:**
- Produces: every table below, each with `user_id uuid references auth.users not null default auth.uid()` and an RLS policy `user_id = auth.uid()` for `select`, `insert`, `update`, `delete`.

- [ ] **Step 1:** Before writing SQL, run `mcp__plugin_supabase_supabase__list_tables` to confirm the project is currently empty of app tables (only Supabase's own `auth`/`storage` schemas).
- [ ] **Step 2:** Apply this migration via `mcp__plugin_supabase_supabase__apply_migration`:

```sql
-- Profile / settings (one row per user)
create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text,
  prayer_calc_method text not null default 'MWL',
  asr_madhab text not null default 'standard', -- 'standard' | 'hanafi'
  location_lat double precision,
  location_lng double precision,
  location_label text,
  timezone text not null default 'America/Chicago',
  qada_owed integer not null default 0,
  pin_lock_enabled boolean not null default false,
  pin_hash text,
  checkin_window_start time not null default '08:00',
  checkin_window_end time not null default '22:00',
  checkin_interval_minutes integer not null default 120,
  traveling_mode boolean not null default false,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "profiles_own_row" on profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Salah tracking
create table prayers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  prayer_name text not null check (prayer_name in ('fajr','dhuhr','asr','maghrib','isha')),
  status text not null default 'pending' check (status in ('pending','on_time','qada','missed')),
  logged_at timestamptz,
  unique (user_id, date, prayer_name)
);
alter table prayers enable row level security;
create policy "prayers_own_row" on prayers for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Adhkar (morning/evening two-checkbox log)
create table adhkar_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  period text not null check (period in ('morning','evening')),
  completed boolean not null default false,
  unique (user_id, date, period)
);
alter table adhkar_logs enable row level security;
create policy "adhkar_logs_own_row" on adhkar_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Custom habits shared by Deen (custom dhikr) and Fitness (daily habits)
create table custom_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  domain text not null check (domain in ('deen','fitness')),
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table custom_habits enable row level security;
create policy "custom_habits_own_row" on custom_habits for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references custom_habits on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  completed boolean not null default false,
  unique (habit_id, date)
);
alter table habit_logs enable row level security;
create policy "habit_logs_own_row" on habit_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Qur'an
create table quran_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  pages_read integer not null check (pages_read > 0),
  surah text,
  juz integer,
  created_at timestamptz not null default now()
);
alter table quran_sessions enable row level security;
create policy "quran_sessions_own_row" on quran_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Weekly goals: Deen + Business only (per spec's lean weekly planning ritual)
create table weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  week_start_date date not null,
  domain text not null check (domain in ('deen','business')),
  headline text not null,
  milestones jsonb not null default '[]'::jsonb,
  quran_page_target integer,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, week_start_date, domain)
);
alter table weekly_goals enable row level security;
create policy "weekly_goals_own_row" on weekly_goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Business kill list (resets daily, no carry-over)
create table kill_list_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  text text not null,
  position integer not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table kill_list_items enable row level security;
create policy "kill_list_items_own_row" on kill_list_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fitness: workout schedule (recurring weekly pattern) + logs
create table workout_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0 = Sunday
  workout_name text not null,
  time time,
  unique (user_id, day_of_week)
);
alter table workout_schedule enable row level security;
create policy "workout_schedule_own_row" on workout_schedule for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  date date not null,
  workout_name text not null,
  source text not null check (source in ('scheduled','adhoc')),
  completed boolean not null default true,
  created_at timestamptz not null default now()
);
alter table workout_logs enable row level security;
create policy "workout_logs_own_row" on workout_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- School + Co-op: tasks and schedule (recurring classes/meetings + one-off events + exceptions)
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  domain text not null check (domain in ('school','co_op')),
  title text not null,
  due_date date,
  due_time time,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table tasks enable row level security;
create policy "tasks_own_row" on tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table schedule_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  domain text not null check (domain in ('school','co_op')),
  title text not null,
  is_recurring boolean not null default false,
  day_of_week integer check (day_of_week between 0 and 6),
  event_time time,
  event_date date, -- for one-off events
  cancelled_on date, -- single-date exception: this recurring event is cancelled on this date
  created_at timestamptz not null default now()
);
alter table schedule_events enable row level security;
create policy "schedule_events_own_row" on schedule_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Universal Pulse Check-ins
create table checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  checkin_time timestamptz not null,
  tag_type text not null check (tag_type in ('kill_list','workout','deen','school','co_op','other_work','noise')),
  tag_label text, -- snapshot of the referenced item's label at log time (per spec: check-ins don't retroactively change)
  tag_ref_id uuid,
  answered boolean not null default true, -- false = auto-recorded as missed/excluded (see Task 10.x)
  created_at timestamptz not null default now()
);
alter table checkins enable row level security;
create policy "checkins_own_row" on checkins for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Web Push subscriptions (one user may have multiple devices)
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "push_subscriptions_own_row" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 3:** Run `mcp__plugin_supabase_supabase__get_advisors` (type: `security`) and resolve any flagged issues (e.g., missing RLS) before moving on — do not proceed to Phase 2 with unresolved security advisor warnings.
- [ ] **Step 4:** Run `mcp__plugin_supabase_supabase__generate_typescript_types` and save output to `lib/supabase/database.types.ts`.
- [ ] **Step 5: Commit**

```bash
git add lib/supabase/database.types.ts
git commit -m "Add core Supabase schema (all domain tables, RLS policies) and generated types"
```

---

## Phase 2: Auth

### Task 2.1: Login page + session-gated layout

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`, `app/(app)/layout.tsx` (session-gated group layout wrapping all authenticated routes)
- Test: `app/login/__tests__/actions.test.ts`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/server.ts` (Task 0.2).
- Produces: Server Action `signIn(formData: FormData): Promise<{ error: string | null }>` in `app/login/actions.ts`. `app/(app)/layout.tsx` redirects to `/login` if `supabase.auth.getUser()` returns no user — every later domain-screen task assumes this gate already exists and does not re-check auth itself.

- [ ] **Step 1:** Write `app/login/actions.ts`:
```ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })
  if (error) return { error: error.message }
  redirect('/')
}
```
- [ ] **Step 2:** Build `app/login/page.tsx` — a simple centered card (dark theme, no domain chrome) with email/password fields bound to the `signIn` action, matching the visual direction from Global Constraints.
- [ ] **Step 3:** Build `app/(app)/layout.tsx`: server component, calls `supabase.auth.getUser()`, redirects to `/login` if null, otherwise renders `{children}` wrapped by the shared shell (shell itself built in Task 3.1 — for this task, a placeholder `<div>{children}</div>` is acceptable since Task 3.1 replaces it).
- [ ] **Step 4:** In the Supabase dashboard is not accessible from here — instead use `mcp__plugin_supabase_supabase__execute_sql` to create the one real user directly:
```sql
-- Run once. Replace the email; a temporary password is fine, change it via Settings later.
select auth.users; -- confirm no existing user first
```
Then use Supabase's admin auth API (via a one-off Node script using `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, never committed) to call `supabase.auth.admin.createUser({ email, password, email_confirm: true })`. Record the login email (not password) in `PROJECT_STATUS.md`'s progress log.
- [ ] **Step 5:** Write `app/login/__tests__/actions.test.ts` mocking `createClient` to assert `signIn` returns `{ error: message }` on failure and calls `redirect('/')` on success. Run, confirm fails, implement (already done in step 1), confirm passes.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Supabase auth login flow and session-gated app layout"
```

---

## Phase 3: App Shell

### Task 3.1: Desktop top nav + mobile floating glass island

**Files:**
- Create: `components/shell/top-nav.tsx`, `components/shell/mobile-island.tsx`, `components/shell/app-shell.tsx`
- Modify: `app/(app)/layout.tsx` (wrap children in `<AppShell>`)
- Test: `components/shell/__tests__/mobile-island.test.tsx`

**Interfaces:**
- Produces: `<AppShell>{children}</AppShell>` — renders `<TopNav>` on `md:` breakpoint and up, `<MobileIsland>` below it, both reading the active route via `usePathname()`.

- [ ] **Step 1:** Build `components/shell/top-nav.tsx`: fixed top bar, links to `/`, `/deen`, `/business`, `/fitness`, `/school`, `/co-op`, active-state underline in the current route's domain accent color, hidden below `md:` breakpoint (`hidden md:flex`).
- [ ] **Step 2:** Build `components/shell/mobile-island.tsx`: fixed bottom, centered, `backdrop-filter: blur(18px) saturate(180%)`, translucent `rgba(40,42,54,0.55)` background, pill `border-radius: 999px`, 5 icons — Home, Deen (🕌), Business (💼), School (🎓), More (⋯) — each ~40px touch target, visible only below `md:` breakpoint. Tapping "More" opens a small sheet/popover (`components/shell/more-sheet.tsx`) linking to `/fitness` and `/co-op`. Keep the island's vertical padding tight (`py-2`) — the spec explicitly flagged an earlier version as too tall.
- [ ] **Step 3:** Write `components/shell/__tests__/mobile-island.test.tsx` (React Testing Library) asserting: exactly 5 top-level nav targets render, tapping "More" reveals Fitness and Co-op links, and the active route gets an `aria-current="page"` attribute. Run, confirm fails (component doesn't exist yet in test's expected shape), implement to pass.
- [ ] **Step 4:** Build `components/shell/app-shell.tsx` composing both, and wire it into `app/(app)/layout.tsx` in place of the Task 2.1 placeholder div.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add desktop top nav and mobile floating glass island nav"
```

---

## Phase 4: Home Screen

### Task 4.1: Unified priority data aggregator

**Files:**
- Create: `lib/home/get-priority-items.ts`, `lib/home/types.ts`
- Test: `lib/home/__tests__/get-priority-items.test.ts`

**Interfaces:**
- Produces:
```ts
type PriorityItem = {
  id: string
  domain: 'deen' | 'business' | 'fitness' | 'school' | 'co_op'
  title: string
  dueAt: Date | null
  urgencyBucket: 'right_now' | 'later_today'
  completed: boolean
  actionType: 'toggle_prayer' | 'toggle_kill_list' | 'toggle_task' | 'toggle_habit' | 'toggle_adhkar'
  actionRefId: string
}
async function getPriorityItems(userId: string, now: Date): Promise<PriorityItem[]>
```
- Consumes: `createClient()` (server), reads from `prayers`, `kill_list_items`, `tasks`, `workout_schedule`/`workout_logs`, `adhkar_logs` for the current date.

- [ ] **Step 1:** Write `lib/home/__tests__/get-priority-items.test.ts` with a fake Supabase client (dependency-injected, not the real network client) covering: (a) an unprayed prayer due within 30 minutes lands in `right_now`; (b) a task due today with no time lands in `later_today`; (c) a completed prayer is excluded entirely (spec: Home shows what's actionable, not a full history); (d) when two items tie on `dueAt`, sort order is Deen > Business > School/Co-op > Fitness (per spec's resolved tie-break decision). Run, confirm it fails (function doesn't exist).
- [ ] **Step 2:** Implement `getPriorityItems` to satisfy all four assertions — pull today's unfinished prayers/adhkar, today's incomplete kill-list items (rolled into one item per spec, not exploded), today's incomplete school/co-op tasks due today, today's scheduled-but-unlogged workout; compute `urgencyBucket` from `dueAt` vs. `now` (within 2 hours = `right_now`); apply the fixed tie-break order from Global Constraints.
- [ ] **Step 3:** Run the test file, confirm all pass.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add unified Home priority-item aggregator with urgency bucketing and tie-break order"
```

### Task 4.2: Home page UI — hero, pulse rings, time-grouped list

**Files:**
- Create: `app/(app)/page.tsx`, `components/home/next-up-hero.tsx`, `components/home/pulse-strip.tsx`, `components/home/priority-list.tsx`, `app/(app)/actions.ts` (inline toggle Server Actions)
- Test: Playwright E2E in `e2e/home.spec.ts` (added in Phase 16, referenced here for interface only)

**Interfaces:**
- Consumes: `getPriorityItems` (Task 4.1).
- Produces: `toggleItem(item: PriorityItem): Promise<void>` Server Action in `app/(app)/actions.ts`, dispatching to the correct table update based on `actionType`/`actionRefId` — this is the single mutation entrypoint every inline checkbox on Home calls, and it's reused by domain pages for the same items.

- [ ] **Step 1:** Implement `app/(app)/actions.ts`'s `toggleItem` with a switch on `actionType` covering all 5 cases (update `prayers.status`, `kill_list_items.completed`, `tasks.completed`, `habit_logs.completed` upsert, `adhkar_logs.completed`), each scoped by the authenticated user from `supabase.auth.getUser()` (never trust a client-passed `userId`).
- [ ] **Step 2:** Build `components/home/next-up-hero.tsx`: takes the single soonest item from `getPriorityItems`, renders the amber-glow hero card from the spec's mockup (label = domain + relative time, title, one-tap action button calling `toggleItem`).
- [ ] **Step 3:** Build `components/home/pulse-strip.tsx`: 4 rings (Deen, Business, Fitness, School — Co-op folded into School's ring per the spec's resolved ambiguity), each a `conic-gradient` ring showing today's completion fraction for that domain, tapping navigates to the domain route.
- [ ] **Step 4:** Build `components/home/priority-list.tsx`: renders `right_now` items under a "Right now" heading and `later_today` items under "Later today," each row inline-checkable via `toggleItem`, domain tag chip colored per Global Constraints palette. No item cap (uncapped per spec).
- [ ] **Step 5:** Assemble `app/(app)/page.tsx` as a Server Component calling `getPriorityItems`, rendering hero + pulse strip + list, with an empty-state ("You're all clear ✓") when the list is empty and a distinct first-run empty state when the user has zero data across all domains (`onboarding_completed = false` on `profiles`).
- [ ] **Step 6:** Manual check: `npm run dev`, sign in, confirm the Home page renders without runtime errors (automated E2E coverage lands in Phase 16 once more of the app exists to exercise).
- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Build Home screen: Next Up hero, domain pulse rings, time-grouped priority list"
```

---

## Phase 5: Deen Domain

### Task 5.1: Deen schema actions + page

**Files:**
- Create: `app/(app)/deen/page.tsx`, `app/(app)/deen/actions.ts`, `components/deen/prayer-row.tsx`, `components/deen/adhkar-strip.tsx`, `components/deen/quran-card.tsx`, `components/deen/qada-counter.tsx`, `components/deen/traveling-toggle.tsx`
- Test: `app/(app)/deen/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `markPrayer(date: string, prayerName: string, status: 'on_time'|'qada'|'missed')`, `toggleAdhkar(date: string, period: 'morning'|'evening')`, `logQuranSession(pages: number, surah?: string, juz?: number)`, `adjustQadaBacklog(delta: number)`, `setTravelingMode(enabled: boolean)` — all Server Actions in `app/(app)/deen/actions.ts`.

- [ ] **Step 1:** Write `app/(app)/deen/__tests__/actions.test.ts` covering: `markPrayer` upserts into `prayers` keyed on `(user_id, date, prayer_name)`; Friday's `dhuhr` mark also is what displays as "Jummah" in the UI (label-only distinction — confirm the action doesn't require a separate `jummah` status value, per spec: "Jummah replaces Dhuhr tracking on Fridays," not a parallel record); `adjustQadaBacklog(-1)` decrements `profiles.qada_owed` and floors at 0. Run, confirm failure.
- [ ] **Step 2:** Implement all five actions in `app/(app)/deen/actions.ts` per the interfaces above, each scoped to the authenticated user.
- [ ] **Step 3:** Run tests, confirm pass.
- [ ] **Step 4:** Build the components: `prayer-row.tsx` (5 rows, Friday relabels Dhuhr's row title to "Jummah"), `adhkar-strip.tsx` (2 chips), `quran-card.tsx` (current surah/juz, this-week pages vs. `weekly_goals.quran_page_target`, streak computed client-side from `quran_sessions` dates), `qada-counter.tsx` (increment/decrement buttons), `traveling-toggle.tsx` (single switch, no auto qasr/jam' logic per spec).
- [ ] **Step 5:** Assemble `app/(app)/deen/page.tsx` (Server Component fetching today's prayers/adhkar/profile, passing to the client components above).
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Build Deen domain: prayers, adhkar, Qur'an tracking, qada backlog, traveling toggle"
```

---

## Phase 6: Business Domain

### Task 6.1: Kill list + weekly goal actions

**Files:**
- Create: `app/(app)/business/page.tsx`, `app/(app)/business/actions.ts`, `components/business/kill-list.tsx`, `components/business/weekly-goal-card.tsx`, `components/business/sn-ratio-card.tsx`
- Test: `app/(app)/business/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `setKillListItem(date: string, position: 0|1|2, text: string)`, `toggleKillListItem(id: string)`, `getWeeklySignalNoiseRatio(userId: string, weekStart: Date): Promise<{ signal: number, noise: number, display: string }>` (exported also for reuse by Insights in Phase 12) in `app/(app)/business/actions.ts` / `lib/business/sn-ratio.ts`.

- [ ] **Step 1:** Write tests for `getWeeklySignalNoiseRatio` covering the two edge cases resolved in the spec: zero Noise → `display: "All Signal"` (not divide-by-zero); zero check-ins at all that week → `display: "No data"`. Also assert a normal case (8 signal, 2 noise → `display: "4.0 : 1"`, "Other work" check-ins excluded from both counts). Run, confirm fails.
- [ ] **Step 2:** Implement `lib/business/sn-ratio.ts`'s `getWeeklySignalNoiseRatio`, querying `checkins` where `tag_type in ('kill_list')` as signal and `tag_type = 'noise'` as noise, `answered = true` only (missed check-ins are `answered = false` and excluded per spec).
- [ ] **Step 3:** Implement `setKillListItem`/`toggleKillListItem` in `app/(app)/business/actions.ts` — `setKillListItem` upserts by `(user_id, date, position)`, no carry-over logic (each day starts empty; yesterday's incomplete items are simply not queried for today).
- [ ] **Step 4:** Build `components/business/kill-list.tsx` (3 slots, add/edit/complete, matches the spec's mockup), `weekly-goal-card.tsx` (headline text + milestone bullets, editable, reads/writes `weekly_goals` where `domain = 'business'`), `sn-ratio-card.tsx` (renders the `display` string from `getWeeklySignalNoiseRatio`, links to `/insights?domain=business`).
- [ ] **Step 5:** Assemble `app/(app)/business/page.tsx`.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Build Business domain: daily kill list, weekly goal, Signal:Noise ratio card"
```

---

## Phase 7: Fitness Domain

### Task 7.1: Habits + workout schedule

**Files:**
- Create: `app/(app)/fitness/page.tsx`, `app/(app)/fitness/actions.ts`, `components/fitness/habit-list.tsx`, `components/fitness/workout-week-grid.tsx`
- Test: `app/(app)/fitness/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `addHabit(name: string)`, `toggleHabit(habitId: string, date: string)`, `removeHabit(habitId: string)`, `setWorkoutSchedule(dayOfWeek: number, workoutName: string | null, time: string | null)`, `logWorkout(date: string, workoutName: string, source: 'scheduled'|'adhoc')` in `app/(app)/fitness/actions.ts`.

- [ ] **Step 1:** Write tests asserting: a habit added mid-week (`created_at` after some prior dates) does not appear as "incomplete" in a weekly-consistency calculation for days before its creation (per spec's resolved decision) — this means the consistency calculator (also in this file) must accept a habit's `created_at` and only count days from then forward. Run, confirm fails.
- [ ] **Step 2:** Implement the actions and a `calculateWeeklyConsistency(habits, logs, weekStart)` helper honoring that rule.
- [ ] **Step 3:** Build `habit-list.tsx` (add/edit/remove/toggle) and `workout-week-grid.tsx` (7-cell week strip, each cell editable via a small popover to assign a workout name + optional time; "Rest" is just a workout name with no special-cased logic). An ad-hoc workout can always be logged regardless of what's scheduled that day, and still counts toward the weekly total (per spec).
- [ ] **Step 4:** Assemble `app/(app)/fitness/page.tsx`.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Build Fitness domain: habit checkmarks and workout schedule grid"
```

---

## Phase 8: School Domain

### Task 8.1: Tasks + class schedule

**Files:**
- Create: `app/(app)/school/page.tsx`, `app/(app)/school/actions.ts`, `components/school/task-list.tsx`, `components/school/schedule-view.tsx` (shared, reused by Co-op in Task 9.1 as `components/shared/domain-schedule-view.tsx`)
- Test: `app/(app)/school/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `addTask(domain: 'school'|'co_op', title: string, dueDate?: string, dueTime?: string)`, `toggleTask(id: string)`, `removeTask(id: string)`, `addScheduleEvent(...)`, `cancelScheduleOccurrence(eventId: string, date: string)` (single-date exception, per spec) — written generically enough in `lib/tasks/actions-core.ts` that both School (8.1) and Co-op (9.1) call the same underlying functions with a different `domain` argument, rather than duplicating logic.

- [ ] **Step 1:** Write tests for `cancelScheduleOccurrence`: asserts it sets `cancelled_on` on the specific date without deleting or modifying the recurring `schedule_events` row (per spec's resolved decision to support one-off exceptions without touching the recurring pattern).
- [ ] **Step 2:** Implement `lib/tasks/actions-core.ts` with the domain-generic functions, then thin `app/(app)/school/actions.ts` wrappers that pin `domain: 'school'`.
- [ ] **Step 3:** Build `components/school/task-list.tsx` and the shared `components/shared/domain-schedule-view.tsx` (week strip of recurring classes/meetings, respecting `cancelled_on` exceptions, plus one-off `event_date` entries).
- [ ] **Step 4:** Assemble `app/(app)/school/page.tsx`.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Build School domain and shared task/schedule primitives for reuse by Co-op"
```

### Task 9.1: Co-op domain (reuses Task 8.1's shared primitives)

**Files:**
- Create: `app/(app)/co-op/page.tsx`, `app/(app)/co-op/actions.ts`

**Interfaces:**
- Consumes: `lib/tasks/actions-core.ts` from Task 8.1, `components/shared/domain-schedule-view.tsx`.

- [ ] **Step 1:** Write thin `app/(app)/co-op/actions.ts` wrappers pinning `domain: 'co_op'`.
- [ ] **Step 2:** Assemble `app/(app)/co-op/page.tsx` reusing `task-list` and `domain-schedule-view` components. Empty state when no active rotation: "No active co-op — nothing scheduled" (per spec — tab stays permanent, no hiding/relabeling).
- [ ] **Step 3:** Manual check: add a co-op task, confirm it doesn't appear on the School page and vice versa (domain scoping works).
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Build Co-op domain reusing School's shared task/schedule primitives"
```

---

## Phase 9: Universal Pulse Check-in Engine

### Task 10.1: Check-in prompt generation logic

**Files:**
- Create: `lib/checkins/get-checkin-options.ts`, `lib/checkins/types.ts`
- Test: `lib/checkins/__tests__/get-checkin-options.test.ts`

**Interfaces:**
- Produces:
```ts
type CheckinOption = { tagType: CheckinTagType, refId: string | null, label: string, primary: boolean }
async function getCheckinOptions(userId: string, now: Date): Promise<CheckinOption[]>
```
`primary: true` options render in the main prompt; `primary: false` options (School/Co-op when not otherwise active) render under "Something else."

- [ ] **Step 1:** Write tests: (a) if a workout is scheduled for the current time window, its option is `primary: true` and appears first; (b) all 3 kill-list items (if set) appear as individual `primary: true` options, each carrying that item's exact current text as `label` (this becomes the `tag_label` snapshot when chosen — per spec, later edits to the kill-list item must not retroactively change historical check-ins); (c) `other_work` and `noise` are always present and always `primary: true`; (d) School/Co-op options are always `primary: false`. Run, confirm fails.
- [ ] **Step 2:** Implement `getCheckinOptions` to satisfy all four cases.
- [ ] **Step 3:** Run tests, confirm pass.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add context-aware check-in option generator (kill list, scheduled workout, other/noise)"
```

### Task 10.2: Check-in prompt UI + answer/snooze/skip actions

**Files:**
- Create: `components/checkin/checkin-prompt.tsx`, `app/(app)/checkin/actions.ts`
- Test: `app/(app)/checkin/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `answerCheckin(checkinTime: string, tagType: CheckinTagType, tagLabel: string, tagRefId: string | null)`, `snoozeCheckin(checkinTime: string, minutes: 15)`, `skipCheckinsToday()` (writes a `profiles`-scoped flag or a `checkin_pauses` row for today — pick the simpler of the two: add a `paused_date date` column to `profiles` rather than a new table, since only "today" needs pausing per spec) — Server Actions in `app/(app)/checkin/actions.ts`.

- [ ] **Step 1:** Add `paused_date date` column to `profiles` via `apply_migration` (`002_checkin_pause`).
- [ ] **Step 2:** Write tests: `answerCheckin` inserts a `checkins` row with `answered = true` and the exact `tagLabel` passed in (snapshot, not a live join to `kill_list_items`); `skipCheckinsToday` sets `profiles.paused_date = today`. Run, confirm fails.
- [ ] **Step 3:** Implement both actions.
- [ ] **Step 4:** Build `components/checkin/checkin-prompt.tsx`: modal/sheet rendered from Home when a check-in is due (see Task 10.3 for the scheduling trigger), listing `getCheckinOptions` results, single-tap-select, "Something else" expansion for `primary: false` options, a "Remind me in 15" button, one-tap "Skip today" link.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add check-in prompt UI with answer/snooze/skip-today actions"
```

### Task 10.3: Client-side check-in scheduling trigger

**Files:**
- Create: `components/checkin/checkin-scheduler.tsx` (client component mounted in `AppShell`)
- Test: `components/checkin/__tests__/checkin-scheduler.test.tsx`

**Interfaces:**
- Consumes: `profiles.checkin_window_start/end/interval_minutes`, `profiles.paused_date`.
- Produces: fires `onCheckinDue()` callback (opens `CheckinPrompt`) at fixed clock times within the window (e.g., window 08:00–22:00, interval 120min → 08/10/12/14/16/18/20/22:00), per spec's resolved "fixed clock times, not app-open-relative" decision. Also computes whether "now" already has an unanswered checkin from a prior fixed time that's still within its grace period (answerable until the *next* fixed time fires, then auto-inserts `answered: false` and locks it as missed/excluded).

- [ ] **Step 1:** Write tests (using a fake/injectable clock, not real `Date.now()`) covering: fixed-time generation for a given window/interval; grace-period lock behavior (a checkin from 2 fixed-times ago with no answer gets auto-marked `answered: false` once a newer fixed time passes); paused-today suppresses all triggers for that date. Run, confirm fails.
- [ ] **Step 2:** Implement the scheduling logic as a pure function `computeCheckinSlots(windowStart, windowEnd, intervalMinutes, now)` (easily unit-testable) plus a thin `useEffect`-based client wrapper that polls every minute (`setInterval`) and calls `onCheckinDue()` when a slot's time has passed and it hasn't been answered/snoozed/locked yet.
- [ ] **Step 3:** Wire `CheckinScheduler` + `CheckinPrompt` into `AppShell` (Task 3.1) so the prompt can appear from anywhere in the app.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add fixed-clock-time check-in scheduler with grace-period miss handling"
```

---

## Phase 10: Weekly Planning Ritual

### Task 11.1: Weekly planning page

**Files:**
- Create: `app/(app)/weekly-planning/page.tsx`, `app/(app)/weekly-planning/actions.ts`
- Test: `app/(app)/weekly-planning/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `saveWeeklyGoal(domain: 'deen'|'business', headline: string, milestones: string[], quranPageTarget?: number)` — locks the *previous* week's row (`locked = true`) the first time this week's is saved, per spec's "past weeks are locked/read-only" decision.

- [ ] **Step 1:** Write tests: saving this week's goal sets last week's `locked = true` if not already; if no prior week exists (first-ever week), no error, just inserts. Run, confirm fails.
- [ ] **Step 2:** Implement `saveWeeklyGoal`.
- [ ] **Step 3:** Build the page: review section (last week's Deen prayer/adhkar/Qur'an consistency %, Business S:N + goal completion — reuse `getWeeklySignalNoiseRatio` from Task 6.1) shown first, with an explicit empty-state for the first-ever week; then two goal-card forms (Deen, Business) reusing the visual pattern from `weekly-goal-card.tsx` (Task 6.1) generalized into `components/shared/goal-card.tsx`. Unlocks (is reachable/nudgeable) starting Saturday evening per spec — implement as: Home's hero (Task 4.2) shows a nudge item once `now` is Saturday 18:00+ and this week's goals aren't saved yet, no hard lockout otherwise.
- [ ] **Step 4:** If a week was missed entirely (no row for last week at all, and it's now a new week), pre-fill the new week's form with the most recent prior week's headline text as an editable draft (per spec's "carries forward as an editable draft" decision) rather than leaving it blank.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add weekly planning ritual: review + Deen/Business goal setting with carry-forward and locking"
```

---

## Phase 11: Insights

### Task 12.1: Focus Map + global/per-domain ratios

**Files:**
- Create: `app/(app)/insights/page.tsx`, `lib/insights/focus-map.ts`
- Test: `lib/insights/__tests__/focus-map.test.ts`

**Interfaces:**
- Produces: `getFocusMap(userId: string, range: 'day'|'week', anchor: Date): Promise<{ segments: { domain: string, pct: number }[], globalRatio: string }>`.

- [ ] **Step 1:** Write tests: segments sum to ~100% across all `checkins` in range grouped by `tag_type` (kill_list→business, workout→fitness, deen→deen, school/co_op→school_co_op, noise→noise; `other_work` is excluded from the visual segments per spec's "neutral" framing but still counted in the denominator... actually per spec, Other work is neutral/excluded from the Signal:Noise ratio but should still show as its own segment in the Focus Map since it's real time spent — confirm both behaviors in the test: excluded from `globalRatio` calc, included as its own Focus Map segment). Run, confirm fails.
- [ ] **Step 2:** Implement `getFocusMap` per the confirmed behavior above, reusing the ratio-computation pattern from `lib/business/sn-ratio.ts` (Task 6.1) generalized to accept a `tagType` filter instead of being business-specific — refactor `getWeeklySignalNoiseRatio` to call this shared function scoped to `kill_list` if needed, rather than duplicating the divide-by-zero/no-data handling twice.
- [ ] **Step 3:** Build `app/(app)/insights/page.tsx`: segmented bar (per the spec's mockup), legend, global ratio, per-domain ratio cards, date-range toggle (day/week).
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add shared Insights view: Focus Map, global and per-domain Signal:Noise ratios"
```

---

## Phase 12: Settings

### Task 13.1: Settings page

**Files:**
- Create: `app/(app)/settings/page.tsx`, `app/(app)/settings/actions.ts`
- Test: `app/(app)/settings/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `updateProfile(fields: Partial<ProfileUpdatable>)` Server Action, where `ProfileUpdatable` covers every user-editable `profiles` column from the schema (prayer method, madhab, location, check-in window/interval, PIN enable + hash, traveling mode).

- [ ] **Step 1:** Write tests: `updateProfile` rejects an attempt to set `pin_hash` directly to a plaintext-looking value shorter than a bcrypt hash length (guard against accidentally storing a raw PIN — hashing happens client-side-adjacent in the action using `bcryptjs` before the update, never stored raw). Run, confirm fails.
- [ ] **Step 2:** Implement `updateProfile`, hashing the PIN with `bcryptjs` (`npm install bcryptjs`) inside the action before the DB write whenever a new PIN is submitted.
- [ ] **Step 3:** Build the Settings page: prayer method + madhab selects, location (manual city input for v1 — geolocation permission request is a client-side addition in Task 14.x alongside push permission, both prompted from onboarding, not built twice), check-in window/interval inputs, PIN lock toggle + PIN entry (default off, per spec), data export button (Task 13.2), theme note (dark-first only, no toggle for v1 — do not build a non-functional light-mode switch).
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add Settings page: prayer method, check-in config, PIN lock, location"
```

### Task 13.2: Manual data export

**Files:**
- Create: `app/(app)/settings/export/route.ts`

**Interfaces:**
- Produces: `GET /settings/export` — authenticated route handler returning a JSON download of every table row scoped to the current user.

- [ ] **Step 1:** Implement the route handler: query every user-scoped table for the authenticated user's rows, assemble one JSON object keyed by table name, respond with `Content-Disposition: attachment; filename="life-os-export-<date>.json"`.
- [ ] **Step 2:** Manual check: hit the route while signed in, confirm a valid JSON file downloads containing at least the `profiles` row.
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add manual JSON data export endpoint"
```

---

## Phase 13: Onboarding

### Task 14.1: First-run onboarding flow

**Files:**
- Create: `app/(app)/onboarding/page.tsx`, `app/(app)/onboarding/actions.ts`, `components/onboarding/ios-install-prompt.tsx`

**Interfaces:**
- Consumes: `updateProfile` (Task 13.1).
- Produces: redirect target — `app/(app)/layout.tsx` (Task 2.1) additionally redirects to `/onboarding` when `profiles.onboarding_completed = false`, instead of rendering the normal shell.

- [ ] **Step 1:** Build a 3-step flow: (1) location (manual city text input, saved to `location_label`; precise lat/lng geocoding is a nice-to-have, not required for v1 — store the label and let prayer-time calculation in Phase 14 resolve it), (2) prayer calculation method + madhab (pre-filled MWL/Standard, one-tap accept or change dropdown), (3) notification permission request (`Notification.requestPermission()`) — if `navigator.userAgent` matches iOS Safari and the app isn't running in standalone/installed mode, show `ios-install-prompt.tsx` instead of the permission button, explaining the home-screen-install requirement per spec.
- [ ] **Step 2:** On completion, call `updateProfile({ onboarding_completed: true, ...collected fields })` and redirect to `/`.
- [ ] **Step 3:** Manual check: with a fresh `onboarding_completed = false` row, confirm visiting any `(app)` route redirects to `/onboarding`, and completing it lands on Home.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add first-run onboarding: location, prayer method, notification permission, iOS install step"
```

---

## Phase 14: PWA + Push Notifications

### Task 15.1: Manifest + service worker + install

**Files:**
- Create: `public/manifest.json`, `public/sw.js`, `components/pwa/register-sw.tsx` (mounted once in root layout)
- Modify: `app/layout.tsx` (link manifest, theme-color meta, mount `RegisterSw`)

- [ ] **Step 1:** Write `public/manifest.json`: name "Life OS", `display: "standalone"`, `background_color`/`theme_color` matching the near-black base, icons (generate a simple 512/192px icon from the domain accent palette — a placeholder monogram is acceptable, note in `PROJECT_STATUS.md` that final icon art is a later polish item, not a functional blocker).
- [ ] **Step 2:** Write `public/sw.js`: a minimal service worker with a `push` event listener that shows a notification from the payload (`title`, `body`, `data.url`) and a `notificationclick` listener that focuses/opens the app to `data.url` — per spec's resolved decision, tapping opens the app rather than answering inline.
- [ ] **Step 3:** Build `components/pwa/register-sw.tsx`: client component, `useEffect` registers `/sw.js`, requests `Notification.permission` if not already granted (only called post-onboarding, this is a re-check for returning sessions), and if granted, subscribes via `PushManager.subscribe` with the VAPID public key, POSTing the subscription to a new route.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add PWA manifest, service worker, and push subscription registration"
```

### Task 15.2: VAPID keys + subscription endpoint

**Files:**
- Create: `app/api/push/subscribe/route.ts`
- Modify: `.env.local` (add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)

- [ ] **Step 1:** Run `npx web-push generate-vapid-keys` and add the resulting public/private keys to `.env.local` (never commit — already gitignored). Set `VAPID_SUBJECT=mailto:ayman.mohammed@newtonbev.com`.
- [ ] **Step 2:** Implement `POST /api/push/subscribe`: authenticated route, upserts the subscription (`endpoint`, `p256dh`, `auth_key`) into `push_subscriptions` for the current user.
- [ ] **Step 3:** Manual check: after Task 15.1's registration flow runs in a real browser, confirm a row appears in `push_subscriptions` via `mcp__plugin_supabase_supabase__execute_sql`.
- [ ] **Step 4: Commit** (code only — `.env.local` is gitignored, nothing to add there)

```bash
git add app/api/push/subscribe/route.ts
git commit -m "Add push subscription endpoint and VAPID key configuration"
```

### Task 15.3: Scheduled push dispatch (Supabase Edge Function + pg_cron)

**Files:**
- Create: Supabase Edge Function `supabase/functions/dispatch-notifications/index.ts` (deployed via `mcp__plugin_supabase_supabase__deploy_edge_function`)

**Interfaces:**
- Consumes: `push_subscriptions`, `profiles` (check-in window/interval, prayer method/location), computed prayer times (implement a small MWL/ISNA-style calculation directly in the function — this is standard astronomical math, no external API dependency needed, avoiding a runtime call to a third-party prayer-time API as an extra point of failure).

- [ ] **Step 1:** Write the Edge Function: runs every 15 minutes (via `pg_cron`, scheduled in Step 3), for each user with an active push subscription: (a) if a prayer time falls within the next 15 minutes and hasn't been notified yet today, send a push "Prayer Name in ~15 min"; (b) if a fixed check-in slot (per Task 10.3's `computeCheckinSlots` logic, reimplemented server-side since Edge Functions can't import client code — keep the pure function in a shared location if the runtime allows, e.g. duplicate the small pure function rather than fight a cross-runtime import, and note the duplication explicitly in a code comment so it's not "silently" duplicated) is starting now, send "What'd you spend the last 2 hours on?". Use the `web-push` npm-compatible library available in Deno Edge Functions (`npm:web-push`) with the VAPID keys from environment.
- [ ] **Step 2:** Deploy via `mcp__plugin_supabase_supabase__deploy_edge_function`.
- [ ] **Step 3:** Enable `pg_cron` (check `mcp__plugin_supabase_supabase__list_extensions` first) and schedule the function call every 15 minutes via `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select cron.schedule(
  'dispatch-notifications-every-15min',
  '*/15 * * * *',
  $$ select net.http_post(
    url := 'https://kjaveyumtrtcvraqdlbe.supabase.co/functions/v1/dispatch-notifications',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
  ) $$
);
```
(Store the service role key as a Vault secret or Supabase project setting rather than inlining it in the SQL string — check `search_docs` for the current recommended pattern for calling Edge Functions from `pg_cron` before finalizing this step, since this specific wiring detail benefits from checking current Supabase docs rather than relying on possibly-stale training knowledge.)
- [ ] **Step 4:** Manual check: use `mcp__plugin_supabase_supabase__get_logs` (service: edge-function) after the next scheduled run to confirm the function executed without errors.
- [ ] **Step 5: Commit** (Edge Function source, if tracked in-repo under `supabase/functions/`)

```bash
git add supabase/functions
git commit -m "Add scheduled push notification dispatch via Supabase Edge Function and pg_cron"
```

---

## Phase 15: Deployment

### Task 16.1: Vercel deployment

**Files:** none (CLI operations)

- [ ] **Step 1:** From `.env.local` (never echo the token to a committed file or log), run `vercel link --token=$VERCEL_TOKEN --yes` to link this repo to a Vercel project non-interactively.
- [ ] **Step 2:** Push every non-`NEXT_PUBLIC_*` and `NEXT_PUBLIC_*` var from `.env.local` (except `VERCEL_TOKEN` itself, which is a CLI credential, not an app runtime var) into Vercel's environment via `vercel env add <NAME> production --token=$VERCEL_TOKEN` for each one, or `vercel env pull`/push equivalent — confirm with `vercel env ls --token=$VERCEL_TOKEN` that all required vars are present before deploying.
- [ ] **Step 3:** Run `vercel deploy --prod --token=$VERCEL_TOKEN --yes`.
- [ ] **Step 4:** Record the resulting production URL in `PROJECT_STATUS.md`'s progress log.
- [ ] **Step 5: Commit** (status file update only)

```bash
git add PROJECT_STATUS.md
git commit -m "Record production deployment URL"
```

---

## Phase 16: End-to-End Verification

### Task 17.1: Playwright E2E suite

**Files:**
- Create: `e2e/auth.spec.ts`, `e2e/home.spec.ts`, `e2e/deen.spec.ts`, `e2e/business.spec.ts`, `e2e/checkin.spec.ts`, `playwright.config.ts`

- [ ] **Step 1:** Run `npm init playwright@latest -- --quiet --browser=chromium` (chromium only is sufficient for a personal-use verification pass, not a cross-browser compatibility matrix).
- [ ] **Step 2:** Write `e2e/auth.spec.ts`: sign in with the real seeded user (credentials from `.env.local`, never hardcoded in the spec file — read via `process.env`), confirm redirect to Home.
- [ ] **Step 3:** Write `e2e/home.spec.ts`: confirm hero, pulse strip, and priority list all render; toggling a visible item updates its checked state without a full page reload (optimistic UI or fast revalidation).
- [ ] **Step 4:** Write `e2e/deen.spec.ts`: mark a prayer on-time, confirm it reflects on both `/deen` and back on Home.
- [ ] **Step 5:** Write `e2e/business.spec.ts`: set all 3 kill-list items, complete one, confirm the Business page's progress reflects it.
- [ ] **Step 6:** Write `e2e/checkin.spec.ts`: this one can't wait for a real 2-hour interval — instead, directly call `answerCheckin` (Task 10.2) through a test-only route or by driving the UI with a mocked/injected clock; assert the resulting `checkins` row and that `getWeeklySignalNoiseRatio` reflects it.
- [ ] **Step 7:** Run `npx playwright test` against both a desktop viewport and a mobile viewport (`playwright.config.ts` `projects: [{ name: 'Desktop Chrome' }, { name: 'Mobile Chrome', use: devices['Pixel 7'] }]`) — confirm the mobile project renders the floating island nav and the desktop project renders the top bar, exercising the responsive layout split from the spec, not just one viewport.
- [ ] **Step 8:** Run the full suite against the deployed production URL (Task 16.1) as the final check, not just localhost — update `PROJECT_STATUS.md` with pass/fail results.
- [ ] **Step 9: Commit**

```bash
git add e2e playwright.config.ts
git commit -m "Add Playwright E2E suite covering auth, Home, Deen, Business, and check-in flows across desktop and mobile viewports"
```

### Task 17.2: Final wrap-up

- [ ] **Step 1:** Update `PROJECT_STATUS.md`'s progress log with a final summary: what's built, what (if anything) was deferred, the production URL, and any judgment calls made during the unattended run that the user should review first thing.
- [ ] **Step 2:** Only after Task 17.1's production-URL test run passes: kill the `caffeinate` process started at the beginning of this session (`kill <PID>` — the PID was logged via `ps` when launched; if lost, `pgrep caffeinate` and confirm it's the one from this session before killing, since killing an unrelated caffeinate process would be a mistake).
- [ ] **Step 3:** Send a final status message to the user (they'll see it when they wake up) summarizing what's live and what needs their attention.

---

## Self-Review Notes (from plan authoring)

- **Spec coverage:** All domain screens (Deen/Business/Fitness/School/Co-op), Home's 3-layer design, universal check-ins (context-aware options, snapshot labels, snooze, grace period, fixed clock times, skip-today), weekly planning (lean Deen+Business scope, carry-forward, locking), Insights/Focus Map, Settings (PIN default-off, prayer method, check-in window), onboarding (including iOS install step), PWA/push (including the iOS constraint), and deployment are each covered by an explicit task above.
- **Deliberately deferred out of this plan** (flagged in the spec as v2/candidate, not missing by oversight): Ramadan mode, automatic qasr/jam' calculation, calendar (.ics) import, light mode, semester-date-driven auto-hiding of class schedules (manual toggle only for v1).
- **Type consistency check performed:** `PriorityItem.actionType`/`actionRefId` (Task 4.1) is the shape every inline Home toggle uses; `toggleItem` (Task 4.2) is the single consumer. `CheckinOption`/`CheckinTagType` (Task 10.1) match the `checkins.tag_type` check constraint (Task 1.1) exactly across all six tables/functions that touch it. `getWeeklySignalNoiseRatio`'s three-state `display` output ("X.X : 1" / "All Signal" / "No data") is defined once (Task 6.1) and reused, not reimplemented, by Insights (Task 12.1).
