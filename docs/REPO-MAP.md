# Repo map

**Written 2026-09-10.** Every claim here was derived from the code, the schema, or
`git log` — not from another document. Where something could not be established, it
says so. Where a doc and the code disagree, the code is right.

If you are a fresh agent, read `CLAUDE.md` first (it is short), then this.

---

## 1. Where documentation lives, and how much to trust it

| Path | What it is | Trust |
|---|---|---|
| `CLAUDE.md` | Entry point. What the project is now, and where to look. | **Current.** |
| `AGENTS.md` | Hard operational rules, each paid for by a production incident. | **Current and binding.** Read before writing code. |
| `docs/REPO-MAP.md` | This file. | Current. |
| `context/` | Orientation docs — purpose, architecture, recent changes. | Current as of 2026-09-10; each carries its own "as of" line. |
| `docs/ai-connector/` | The MCP/AI-connector program's own working record. | **Current** (written 2026-09-08→09, still the active program). |
| `supabase/migrations/ALLOCATIONS.md` | Append-only ledger of migration-number allocations and operator actions. | **Current and authoritative.** Never restructure it. |
| `supabase/migrations/_withdrawn/README.md` | Why three migrations were withdrawn and must never be applied. | Current. |
| `docs/DEPLOYING.md` | Deploy procedure and its three traps. | Current, with one gap: it predates `scripts/deploy-prod.sh`, which now automates it. |
| `lib/night-plan/SPEC.md` | The night-plan engine's port spec. | Current. |
| `docs/superpowers/` | **Dated historical record.** Specs, plans, research, briefs. | **Historical.** See §7 — several describe an app that no longer exists. |
| `docs/audits/` | One 2026-08-15 frontend structure audit. | Historical. |
| `PROJECT_STATUS.md` | 333 KB append-only build log, 2026-08-10 → 2026-08-20. | **Frozen historical log.** Its opening section asserts single-user/non-multi-tenant, which is false today. See the banner at its top. |
| `context/Life OS — Complete Feature Guide.docx` | Screen-by-screen behavioural guide, written 2026-08-29. | **Stale.** Predates the 2026-09-01 domains/onboarding restructure — it describes the legacy shell only. |
| `README.md` | Untouched `create-next-app` boilerplate. | Ignore. |

**The single most common wrong belief a fresh agent forms here** is that this is a
single-user personal app for one person. It was, until 2026-09-01. It is not now.
`context/PURPOSE-AND-DOMAINS.md` used to state that forcefully; it has been corrected.
`PROJECT_STATUS.md` and the pre-September specs still contain the old framing in their
historical text, which is correct *as history* and wrong as a description of today.

---

## 2. What the app is, in one screen

Next.js 16 App Router + React 19 + Supabase Postgres, deployed to Vercel as
`tracking-app`. Multi-tenant: signup is open, tenancy is enforced by RLS on every
table plus composite tenancy foreign keys. What each user sees is driven by rows in
`user_domains` / `user_subdomains`, chosen during onboarding.

See `context/PURPOSE-AND-DOMAINS.md` for *why* it is shaped this way, and
`context/ARCHITECTURE.md` for the technical conventions.

---

## 3. Routes

Route group `(app)` is URL-transparent. `loading.tsx` skeletons exist for most routes.

**Before reading this table: two navigation modes exist.** `getUserDomains()`
(`lib/domains/get-user-domains.ts:51`) returns `{ mode: "legacy" }` for an account with
completed onboarding and zero `user_domains` rows, and `{ mode: "domains", ... }`
otherwise. The two modes have **separate nav components** —
`components/shell/sidebar-nav.tsx` + `mobile-island.tsx` versus `tab-sidebar-nav.tsx` +
`tab-mobile-island.tsx`. A feature added to one does not exist in the other. `CLAUDE.md`
explains the full branch and its consequences; read it before changing navigation,
Home, or anything domain-scoped.

Quick reference:

| | Legacy nav | Domains nav |
|---|---|---|
| Built by | fixed list in `sidebar-nav.tsx:19-38` | `lib/shell/build-primary-nav-items.ts` |
| Main items | `/`, `/deen`, `/business`, `/fitness`, `/school`, `/work` | `/` + up to three of `/personal`, `/work/<sub>`, `/school` |
| Secondary | `/insights`, `/settings` | `/close`, `/insights`, `/calendar`, `/settings` |
| Business tab | yes | **none** — `/business` is URL-only |
| Respects `hidden_features` | yes | **not yet** (deliberate scope boundary) |

### Pages

| URL | File | What it is |
|---|---|---|
| `/` | `app/(app)/page.tsx` | Home. Cross-domain arbiter ranking, Focus module, next actions, day ribbon, weekly goals, MCP-generated widgets. |
| `/onboarding` | `app/(app)/onboarding/page.tsx` | Resumable domain-first onboarding wizard. Writes `user_domains` / `user_subdomains`. |
| `/personal` | `app/(app)/personal/page.tsx` | No content — redirects to the user's first kept personal subdomain. |
| `/personal/[subdomain]` | `app/(app)/personal/[subdomain]/page.tsx` | Dispatch: `faith` → the Deen page, `fitness` → the Fitness page, `self_mastery` → the Self-Mastery library. Composes the existing route components; no duplication. |
| `/personal/[subdomain]/[bookId]` | `.../[bookId]/page.tsx` | Self-Mastery book detail. 404s unless subdomain is `self_mastery` and `bookId` is a UUID. |
| `/work` | `app/(app)/work/page.tsx` | Work/co-op: hours schedule, targets strip, four-stage task pipeline. |
| `/work/[subdomain]` | `app/(app)/work/[subdomain]/page.tsx` | URL alias for `/work`. Subdomains currently **share one pipeline** — per-subdomain scoping is not implemented, and the layout says so on screen. |
| `/school` | `app/(app)/school/page.tsx` | Classes, weekly class schedule, task list, due/overdue/at-risk KPIs. |
| `/deen` | `app/(app)/deen/page.tsx` | Faith dashboard. Also reached as `/personal/faith`. |
| `/fitness`, `/fitness/workouts` | `app/(app)/fitness/**` | Fitness dashboard and plan builder. Also reached as `/personal/fitness`. |
| `/business` | `app/(app)/business/page.tsx` | Kill List (3/day), business weekly goal, deep-work focus time. |
| `/close` | `app/(app)/close/page.tsx` | Evening close ceremony. Fixed stages; the account stage is a **refusal gate** on 3-strike distraction plans. |
| `/open` | `app/(app)/open/page.tsx` | Morning open, deliberately read-only. **No static link anywhere** — direct-URL only. |
| `/review` | `app/(app)/review/page.tsx` | Pure `redirect("/close")`. The distraction review was absorbed into the close. |
| `/calendar` | `app/(app)/calendar/page.tsx` | Sun–Sat hour grid for the week. |
| `/insights` | `app/(app)/insights/page.tsx` | Analytics: focus map, signal/noise trend, domain weights, weekly recap. |
| `/settings` | `app/(app)/settings/page.tsx` | Profile, theme preset, feature visibility, prayer, location, check-ins, push, AI keys, MCP connectors, data export. |
| `/login`, `/signup` | `app/login/`, `app/signup/` | Email/password auth. Outside the `(app)` group. |

**Only `/`, `/personal`, `/work/<sub>`, `/school`, `/settings` come from the primary
nav builder.** Everything else is reached by an in-page link — or, for `/open`, not at
all. A route existing is not evidence a user can reach it.

### Action-only directories (no `page.tsx`)

`app/(app)/actions.ts`, `app/(app)/checkin/*`, `app/(app)/distractions/actions.ts`,
`app/(app)/widgets/actions.ts`. Server Actions imported by components rendered on
other pages. Do not go looking for a `/checkin` or `/distractions` page.

### API routes

| Path | Purpose |
|---|---|
| `/api/mcp` | The MCP server. Generic tools: `list_capabilities`, `read`, `write`, `widget_manage`, `scheduler_manage`. |
| `/api/mcp/oauth/{authorize,token,register}` | Hand-rolled OAuth 2.1 authorization server (PKCE S256 mandatory, refresh rotation with reuse detection, RFC 7591 DCR). |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | RFC 8414 / RFC 9728 metadata for MCP clients. |
| `/api/cron/scheduled-actions` | Polled ~5 min by pg_cron + pg_net. `CRON_SECRET` bearer; **503 if unset — fails closed.** |
| `/api/cron/ping` | Reachability probe for the same driver. |
| `/api/push/subscribe` | Web Push subscription upsert. |
| `/api/self-mastery/ingestion/step` | Runs one book-ingestion stage. Service-role. |
| `/settings/export` | JSON export of ~21 user-scoped tables. |
| `app/api/test/*` | **E2E only.** Require a valid session *and* `E2E_TEST_SECRET`. Not product surface. |

---

## 4. `lib/` — business logic, no framework code

| Dir | Responsibility |
|---|---|
| `ai/` | Optional BYO-key LLM layer (DeepSeek, OpenAI wire format). Every feature behind it is optional by construction. |
| `business/` | Deep-work sessions, Kill List, signal:noise, domain weights. |
| `capture/` | Global quick-capture: a deterministic, no-LLM utterance parser that leaves ambiguities `null` rather than guessing. |
| `charts/` | Pure SVG chart math. No React. |
| `checkins/` | 2-hour check-in windows, 120-minute allocation pool, missed-hour queries. |
| `commitments/` | Polymorphic session→commitment binding (kill-list item / rep goal / lesson promotion). |
| `coop/` | Work domain: targets (`position <= 3`) and the task pipeline. |
| `deen/` | Prayer status/streaks/consistency, qada, sunnah, Quran, reflection, habit stages. |
| `distractions/` | Triggers and action plans; the 3-strike forced-rewrite rule. |
| `domains/` | **Which domains/subdomains a user selected.** `get-user-domains.ts` is the entry point. |
| `evening-close/` | Close ceremony stages, the blocker gate, day-won. |
| `fitness/` | 4-week cycles, weekly volume, plans, progression, rep goals. |
| `home/` | Home composition and the **cross-domain arbiter** (candidate ranking, urgency, day shape). |
| `insights/` | Focus map, KPI aggregation. |
| `mcp/` | The MCP connector: registry, tools, OAuth, tokens, per-call RLS session, rate limit, audit, scheduler runner. |
| `night-plan/` | Pure engine ported from CollegeOS: dump → star three → crown one. Has its own `SPEC.md`. |
| `notifications/` | In-app list, Web Push send, `notify` scheduled action. |
| `prayer-times/` | Astronomical prayer-time calculation. **`windows.ts` is the only safe entry point** — see the timezone rule in `AGENTS.md`. |
| `promotions/` | Lesson-promotion loop: promotion (commitment) → verdict. |
| `pwa/` | Shared push-subscribe flow; never throws, returns typed failure reasons. |
| `scheduling/` | Cron validation/next-run and the `scheduler_manage` core. |
| `school/` | Class cards, plus `grades/` and `risk/` sub-engines. |
| `self-mastery/` | Book library, FSRS scheduler (`ts-fsrs`), seeded Meditations deck, `ingestion/` pipeline, `session/`. |
| `settings/` | Geocoding, city/timezone lookup, location resolution. |
| `shell/` | **Pure nav derivation** — `computeNavDomainState` and `buildPrimaryNavItems`. Framework-free, so nav rules are unit-testable. |
| `supabase/` | Client creation and auth. Infrastructure, not a business domain. |
| `tasks/` | Cross-domain task helpers, schedule exceptions, grouping. |
| `weekly-planning/` | Weekly recap aggregation. |
| `widgets/` | AI-created dashboard widgets. `render.ts` calls the **real** `readTool()` so widgets inherit MCP read filters exactly. |

Loose files at `lib/` root: `date-utils.ts` (timezone-safe local-date math — used nearly
everywhere; read the timezone rule in `AGENTS.md` before touching it), `theme-presets.ts`,
`features.ts`, `accent-tokens.ts`, `domain-icons.ts`, `featured-card-style.ts`,
`kpi-value-accent.ts`, `utils.ts` (`cn`).

## 5. `components/` — mirrors `lib/`'s split

`components/ui/` are design-system primitives. `components/shared/` are cross-domain
*composites* built from them. `components/shell/` is app chrome — and it holds the
loading-skeleton primitives (`route-skeleton.tsx`) deliberately, not by accident.

**`components/co-op/` backs `/work`, not a `/co-op` route.** That is the one naming
mismatch in the tree.

**A directory listing describes the repo, not the app.** Both `lib/` and `components/`
carry dead files from superseded designs. Grep for a real importer before treating
anything as live.

---

## 6. Scripts — the durable instruments

`scripts/preflight.sh` runs every durable check in one command: `tsc --noEmit`,
`vitest run`, `next build`, and the self-testing schema instruments. Its own header
states honestly what it does *not* cover.

| Script | Asserts / does |
|---|---|
| `agent-commit.sh` | **The only safe way to commit in this tree.** Atomic stage+commit under a mkdir mutex. |
| `deploy-prod.sh` | Deploys the **committed** state from a throwaway worktree, not the dirty working tree. |
| `apply-migration.sh` | Applies *and* records in `migration_ledger`; refuses a file edited after it was applied. |
| `check-rls.sh` | Every public table has RLS and a policy. |
| `check-fk-tenancy.sh` | No single-column FK to a user-scoped parent. |
| `check-enum-drift.sh` | DB CHECK value sets are named in TypeScript. |
| `check-vocabulary-drift.sh` | Two DB objects don't spell one concept two ways. |
| `check-migrations-applied.sh` | What is on this DB; parity between two DBs. |
| `mcp-protocol-check.ts`, `mcp-oauth-flow-check.ts` | The MCP server answers protocol and the OAuth flow completes. |

Each self-tests by injecting a real failure and confirming detection. That matters:
`check-enum-drift` once went stale in exactly the way it existed to detect.

---

## 7. `docs/superpowers/` — read as a decision log, not a feature list

Everything here is **dated and historical**. Read chronologically it is a decision log;
later files revise earlier ones. Nothing here describes the app as it is today.

Three cautions:

1. **`specs/2026-08-09-life-os-design.md` is the founding spec and its premise is
   superseded.** It states "no multi-tenant auth, no accounts beyond the owner." That
   was true then. It is the origin of the single-user belief every fresh agent forms.
   It remains valuable for *why* the domains are shaped the way they are.
2. **The August specs describe a nine-screen single-user shell.** The 2026-09-01
   convergence replaced the navigation and added onboarding. Screen-level detail in
   those files is unreliable; design *intent* in them largely still holds.
3. **`specs/2026-09-09-mcp-ai-connector.md` says "design draft, not yet built."** It has
   since been built. `docs/ai-connector/` is the accurate record of what shipped, and
   `docs/ai-connector/PROGRAM-PLAN.md` lists three of the handoff doc's load-bearing
   claims that failed inspection.

These files are **not** archived, deliberately: nearly every one is cross-referenced by
name from other docs, from `supabase/migrations/*.sql` headers, and in several cases from
code comments (`lib/home/urgency.ts`, `lib/home/get-day-shape.ts`,
`components/checkin/allocation-checkin.tsx`). Moving them would break live references for
no gain. They are dated in their filenames; treat the date as the expiry stamp.

Index by area:

- **Founding / architecture:** `specs/2026-08-09-life-os-design.md`, `specs/2026-08-16-life-os-power-architecture.md` (the "records well, decides poorly" critique), `specs/2026-08-15-frontend-structural-refactor.md`, `docs/audits/2026-08-15-frontend-structure-audit.md`
- **Home:** `specs/2026-08-17-home-restructure.md`, `specs/2026-08-17-home-day-shape-design.md`, `specs/2026-08-18-home-weekly-goal-strip.md`, `specs/2026-08-23-home-fitness-row.md`
- **Navigation latency:** `specs/2026-08-16-navigation-latency-fix.md`, `specs/2026-08-18-navigation-prefetch-fix.md`, `research/2026-08-16-navigation-latency-research.md`
- **Deen / faith:** `specs/2026-08-17-prayer-time-intelligence.md`, `specs/2026-08-18-reflection-redesign.md`, `specs/2026-08-18-habit-builder-redesign-proposal.md` (proposal, never signed off), `research/2026-08-18-habit-formation-research.md`
- **Business:** `specs/2026-08-18-business-brainstorm-synthesis.md`, `research/2026-08-18-business-*.md`, `research/2026-08-18-*productivity*.md`, `specs/2026-08-19-missed-lockin-hours.md`
- **Fitness:** `specs/2026-08-22-fitness-system-REQUIREMENTS.md` (scope authority), `specs/2026-08-19-fitness-redesign.md`, `plans/2026-08-2{0,2}-fitness-*.md`
- **Work / school / calendar:** `specs/2026-08-20-coop-redesign.md`, `specs/2026-08-23-schedule-calendar.md`, `specs/2026-08-26-class-view-{VERBATIM,BOARD}.md`
- **Check-ins / distractions:** `specs/2026-08-19-checkin-allocation-system.md`, `specs/2026-08-23-distractions-system.md`
- **Verbatim requirement captures** (scope authorities, quoted word-for-word from Ayman): `specs/2026-08-2{2,3}-*REQUIREMENTS.md`, `specs/2026-08-25-night-batch-2-VERBATIM.md`, `specs/2026-08-26-class-view-VERBATIM.md`
- **Transient status boards** (a batch's live task list, now finished): `specs/2026-08-25-night-batch-2-PLAN.md`, `specs/2026-08-26-class-view-BOARD.md`
- **AI connector:** `specs/2026-09-09-ai-integration-handoff.md`, `specs/2026-09-09-mcp-ai-connector.md` — both superseded in fact by `docs/ai-connector/`.

---

## 8. Known documentation defects not fixed here

Recorded rather than silently left:

- `next.config.ts`'s comment says the realtime provider is disabled. It is not —
  `components/shell/app-shell-chrome.tsx:103` mounts `RealtimeSyncProvider`, re-mounted
  2026-08-26 after the session-restore race was fixed. Code comment, not touched.
- `context/RECENT-CHANGES.md` (2026-09-01) referenced `convergence-ops/DECISIONS.md`.
  **That directory does not exist in this repo.** The reference has been removed.
- `docs/ai-connector/SECURITY-account-isolation.md` says "all 68 tables." There are 77
  public tables as of 2026-09-10. The count moved; the argument did not. Left as written —
  that file is the AI-connector program's own dated record.
