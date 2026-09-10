# Life OS — orientation for an agent

**This file exists to stop you forming a wrong belief in your first ten minutes.**
Read it, then `docs/REPO-MAP.md` for where things are. Verified against the schema,
the code and `git log` on 2026-09-10.

## What this project is

A multi-tenant personal-operating-system web app: Next.js 16 (App Router) + React 19 +
Supabase Postgres, deployed to Vercel as `tracking-app`. It helps a person run their
day across the life areas they choose — faith, work, school, fitness, learning,
business — and its opinion is that most tools **record well and decide poorly**, so
nearly every screen is built to answer *what should I do now* rather than *what
happened*.

**It is not a single-user app.** This is the single most common wrong belief a fresh
agent forms here, because the founding spec said so in 2026-08 and older docs repeated
it forcefully. The evidence that it is false today:

- **Signup is open.** `app/signup/actions.ts` calls `supabase.auth.signUp` with no
  allowlist, invite code, or email filter. It redirects straight to `/onboarding`.
- **Production `auth.users` holds 23 accounts**, including a second real human
  (`kareem.badawi24@gmail.com`) and 17 accounts created by real signup runs.
- **All 77 public tables have RLS enabled** — zero exceptions — with `user_id =
  (select auth.uid())` own-row policies.
- **67 composite tenancy foreign keys** of the shape `(user_id, child_id) →
  parent(user_id, id)` make a row pointing at another account's data *unrepresentable*,
  not merely forbidden.
- `e2e/stranger-journey.spec.ts` is an acceptance test that a **genuinely new account**
  can sign up → onboard → reach Home → complete a study session.

Do not "simplify" anything on the grounds that only one person will see it, and do not
treat RLS as decorative defence-in-depth on a single-tenant database. It is the tenancy
mechanism.

## Who actually uses it

- `ayman.0704m@gmail.com` — the owner's real daily account. **Legacy mode** (zero
  `user_domains` rows). This matters constantly; see below.
- `ayman.m0704@gmail.com`, `m.ayman4227@gmail.com` — domains-mode accounts.
- `kareem.badawi24@gmail.com` — a second human, legacy mode, zero rows of anything.
- `ayman.mohammed@newtonbev.com` — **SEED**, the Playwright fixture account
  (`SEED_USER_EMAIL`). Legacy mode, which is why the e2e suite is partly blind to
  domains-mode behaviour.
- `seed-domains@lifeos.test` — the domains-mode fixture (`SEED_DOMAINS_USER_EMAIL`).

## The one structural fact that explains most of the codebase

**Two navigation modes exist, and they are separately-maintained code paths.**

`getUserDomains()` (`lib/domains/get-user-domains.ts:51`) returns a discriminated union:

```ts
if ((profile?.onboarding_completed ?? false) && domains.length === 0) {
  return { mode: "legacy" };       // the original single-user LifeOS shell
}
return { mode: "domains", domains, subdomains };
```

- **Legacy** (`onboarding_completed === true` **and** zero active `user_domains` rows):
  the fixed six-item nav — `/`, `/deen`, `/business`, `/fitness`, `/school`, `/work` —
  rendered by `components/shell/sidebar-nav.tsx` + `mobile-island.tsx`. Home shows every
  sector. Respects `profiles.hidden_features`.
- **Domains**: at most four tabs — `/` always, plus `/personal`, `/work/<subdomain>`,
  `/school` if selected — built by `lib/shell/build-primary-nav-items.ts` and rendered
  by `tab-sidebar-nav.tsx` + `tab-mobile-island.tsx`. **There is no Business tab at
  all.** Does *not* yet respect `hidden_features` (a deliberate scope boundary,
  documented at `components/shell/app-shell-chrome.tsx:61-65`).

Three consequences worth internalising before you change anything:

1. **A feature added to one nav does not exist in the other.** Check both.
2. **Only `/personal/*` and `/work/*` are URL-gated by mode.** `/deen`, `/business`,
   `/fitness`, `/school` render for anybody who types the URL — no `page.tsx` in those
   routes reads `getUserDomains`. So "domains mode hides Deen" is a nav claim, not a
   route claim.
3. **Domains mode reaches the same content through composed routes.**
   `/personal/[subdomain]/page.tsx` renders `DeenPage`, `FitnessPage`, or
   `SelfMasteryLibrary`. The duplication is in the nav, not the pages.

A caution about the third state: an account with `onboarding_completed === false` and
zero rows is **not** legacy — it is `mode: "domains"` with empty arrays. But
`lib/business/domain-weights.ts:44` uses its own zero-rows predicate that ignores
`onboarding_completed`, so that account is domains-mode for navigation and legacy-mode
for Signal:Noise. That divergence is real and live.

## The domain vocabulary is mid-migration — do not assume either half

`user_domains.key` is CHECKed to: `personal_growth`, `faith`, `business`, `body`,
`learning`, `work`, `school`. Each row also carries `weight`
(`essential`/`important`/`background`) and `depth`
(`prayers_only`/`prayers_quran`/`full_practice`).

Migration `115_flatten_personal_growth.sql` **is applied** (confirmed in
`migration_ledger`, and visible in production data: `personal_growth` archived
2026-09-02 03:58, with `faith`/`body`/`learning` created as peer rows). It split
Personal Growth into top-level peers because "Personal Growth is a shell artifact, not
a user concept."

**But onboarding was never updated to match.** `components/onboarding/types.ts:6` still
types `DomainKey` as `"personal_growth" | "work" | "school"`, so every account created
since the flatten still gets a `personal_growth` row (verified:
`m.ayman4227@gmail.com`, signed up nine hours after the flatten, has one). Both
vocabularies are live in production simultaneously. `lib/domains/area-vocabulary.ts` is
the bridge module written for exactly this, and `lib/shell/nav-domain-state.ts:54-80`
synthesises the three personal areas from flat keys when the `personal_growth` group
comes back empty. **That pre-115 arm is live code, not dead code — do not delete it.**

Two schema columns land ahead of their consumers, which is deliberate but easy to
misread:

- **`weight`** is written **only** at onboarding (`app/(app)/onboarding/actions.ts:111`,
  insert-only). No UI changes it afterwards. It is consumed as the 3rd sort key in the
  Home arbiter (`lib/home/arbiter.ts:161`) and as the Signal:Noise classifier
  (`lib/business/domain-classification.ts:108`). `business` and `co_op` have no weight
  entry at all today.
- **`depth`** is consumed by **nothing**. `lib/deen/faith-depth.ts` is a tested pure
  function with zero callers, and no query even selects the column. It is a landed,
  unwired gate — not a live behaviour.

## Major subsystems

| Subsystem | Where | Note |
|---|---|---|
| **Home + cross-domain arbiter** | `lib/home/` | Ranks candidates across every domain into one "Now". Lexicographic: urgency → dueAt → weight tier → position → decay → cost → risk. |
| **Deen / faith** | `lib/deen/`, `lib/prayer-times/` | `computePrayerWindows` in `windows.ts` is the **only** safe entry point. See the timezone rule. |
| **Self-Mastery (ULM)** | `lib/self-mastery/` | Spaced repetition over books → lessons → cards, FSRS via `ts-fsrs`. A seeded 12-lesson Meditations deck. Book ingestion exists but has no driver wired. |
| **Work / co-op** | `lib/coop/`, `components/co-op/` | Targets + four-stage pipeline. Work subdomains currently **share one pipeline**; the UI says so on screen. |
| **School** | `lib/school/` (+ `grades/`, `risk/`) | Classes, assessments, grade projection, risk bands. |
| **Business / Lock-In** | `lib/business/` | Deep-work sessions, 3-item daily Kill List, Signal:Noise. |
| **Fitness** | `lib/fitness/` | Plans, daily log, 4-week measurement cycle. |
| **Evening close / night plan** | `lib/evening-close/`, `lib/night-plan/` | `/close` is a refusal gate: a 3-strike distraction plan blocks later stages. `crown()` refuses unstarred items. |
| **MCP AI connector** | `lib/mcp/`, `app/api/mcp/**` | The newest and largest subsystem — built 2026-09-08→09. A remote MCP server + a hand-rolled OAuth 2.1 authorization server, so Claude/ChatGPT/Gemini can read and write real data. 5 generic tools, 13 domains, ~60 registered entities. **`docs/ai-connector/` is its accurate, current record.** |
| **Widgets** | `lib/widgets/` | AI-created Home widgets. `render.ts` calls the real `readTool()` so widgets inherit MCP read filters exactly. |

## Standing operational rules

**`AGENTS.md` is binding and every rule in it was paid for by a production incident.**
It is imported below; read it before writing code. In particular:

- **This Next.js is not the one you trained on** — Next 16 renamed middleware to
  `proxy.ts`. Read `node_modules/next/dist/docs/` before assuming an API.
- **Never pass a function prop from a Server Component to a Client Component** — bind a
  Server Action, or pass a serializable value. `tsc` and `vitest` cannot see this.
- **Never derive a calendar date from a raw `Date`** — use `localDateString(now, tz)`
  and `resolveLocalTime(...)` from `lib/date-utils.ts`. This one shipped three times.
- **Commit only with `./scripts/agent-commit.sh "msg" <explicit paths>`** — several
  agents share one working tree and one git index. Never `git add -A`, `git commit -a`,
  `git stash`, `git reset --hard`, `git checkout --`, or `git clean`.
- **Only the Lead runs `npx playwright test`** — one SEED account, one live database,
  one `storageState` file. `tsc` and `vitest` are pure and free for everyone.
- **A check that examines nothing reports success.** Seed the fixture to the shape of
  the bug and confirm the check FAILS first.

Verification commands:

```
npx tsc --noEmit          # free
npx vitest run            # free
./scripts/preflight.sh    # every durable check in one command
./scripts/deploy-prod.sh  # deploys the COMMITTED state, not the dirty tree
```

Migration numbers are allocated by the LifeOS lead only, recorded in
`supabase/migrations/ALLOCATIONS.md` at the moment of allocation. Apply only via
`./scripts/apply-migration.sh` — never bare `psql`.

The direct `DATABASE_URL` is IPv6-only and unroutable from this machine; use
`DATABASE_URL_POOLER` (source `.env.local` first).

## Where to look next

- `docs/REPO-MAP.md` — routes, `lib/` responsibilities, scripts, and which docs to trust.
- `context/PURPOSE-AND-DOMAINS.md` — *why* the product is shaped this way.
- `context/ARCHITECTURE.md` — technical conventions, RSC/auth/RLS patterns.
- `context/RECENT-CHANGES.md` — what changed recently and what is known-broken.
- `docs/ai-connector/` — the MCP program's own current record.
- `docs/superpowers/` — **dated history.** A decision log, not a description of today.

@AGENTS.md
