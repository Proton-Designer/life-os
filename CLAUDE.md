# Life OS

A multi-tenant personal-operating-system web app: Next.js 16 (App Router) + React 19
+ Supabase Postgres, deployed to Vercel as `tracking-app`. It helps a person run
their day across the life areas they choose — faith, work, school, fitness,
learning, business — on the premise that most tracking tools **record well and
decide poorly**, so most screens answer *what should I do now*, not *what happened*.

**It is not a single-user app**, despite what the founding 2026-08 spec says. Signup
is open, all 77 tables have row-level security, and 67 composite tenancy foreign
keys make a cross-account row unrepresentable. See `.brain/architecture/
system-overview.md` for the evidence.

**Stack:** Next.js 16 · React 19 · Tailwind v4 · Supabase Postgres · Vercel
**Layout:** single package (`life-os`)

---

## Where to find things

| If you need… | Read |
|---|---|
| **Anything not listed below** | **`.brain/README.md`** — indexes the whole knowledge base |
| What this system is, end to end | `.brain/architecture/system-overview.md` |
| Where any code lives | `REPOSITORY_MAP.md` |
| A specific business domain (14 total) | `.brain/domains/README.md` |
| The legacy-vs-domains navigation split | `.brain/domains/settings-onboarding.md` |
| Why a decision was made | `.brain/memory/decisions.md` |
| What is known-broken | `.brain/memory/known-issues.md` |
| What is in flight right now | `.brain/memory/active-work.md` |
| What we learned the hard way | `.brain/memory/lessons.md` |
| Build / test / deploy commands | `.brain/tooling/registry.md` |
| What to update when you change code | `.brain/governance/contribution-protocol.md` |
| Who owns what | `.brain/governance/ownership.md` |
| What the product does and for whom | `PRODUCT_CONTEXT.md` |
| This repo's own doc-trust map (what's current vs. historical) | `docs/REPO-MAP.md` |
<!-- GENERATED:ROUTING-ROWS v1 candidates="arch.dependency-graph,arch.data-flows,gov.ownership,tool.integrations,tool.optimization-registry" -->
| how does an mcp write reach the database | `.brain/architecture/data-flows.md` |
| what breaks if i change this | `.brain/architecture/dependency-graph.md` |
| who owns this service | `.brain/governance/ownership.md` |
| what external systems does this connect to | `.brain/tooling/integrations.md` |
| what token optimization tools are enabled | `.brain/tooling/optimization-registry.md` |
<!-- /GENERATED:ROUTING-ROWS -->

---

## Hard constraints

Each of these was paid for by a real production incident — full stories in
`.brain/archive/2026-09-13.root-agents-md-v1.md` and `.brain/memory/known-issues.md`.

- **Never pass a function as a prop from a Server Component to a Client
  Component.** `tsc`/`vitest` cannot see this; it only fails live in the browser.
  Bind a Server Action or pass a serializable value instead.
- **Never derive a calendar date from a raw `Date`.** Use `localDateString(now,
  tz)` / `resolveLocalTime(...)` from `lib/date-utils.ts`. This class of bug has
  shipped multiple times from the UTC-vs-local-evening rollover.
- **Commit only via `./scripts/agent-commit.sh "msg" <explicit paths>`** — several
  agents share one working tree and one git index. Never `git add -A`, `git commit
  -a`, `git stash`, `git reset --hard`, `git checkout --`, or `git clean`.
- **Only the session's "Lead" role runs `npx playwright test`** — one SEED
  account, one live database, one `storageState` file. `tsc`/`vitest` stay free
  for everyone.
- **Time shown to a person is always 12-hour ("9:00 PM").** Format with `formatHHMM12` / `formatClock12`
  (`lib/date-utils.ts`); pick with `components/ui/time-field-12.tsx`. Never `<input type="time">` or
  `toLocaleTimeString()` (both follow the browser locale and show "21:00"); `lib/__tests__/no-24-hour-time-ui.test.ts`
  fails if they come back. Stored values stay 24-hour `HH:MM`.
- **A check that examines nothing reports success.** Before trusting a check about
  a bug, seed the fixture to the bug's shape and confirm the check fails first.
- **This Next.js is not the one you trained on** — `proxy.ts`, not
  `middleware.ts`. Check the installed Next.js package's own docs before assuming an API.

---

## How to work here

**Load context in layers.** Summary → detail → source. Read the domain doc before
the code. Do not grep the repository to answer a question the routing table
already routes.

**Verify before you assert.** `.brain` summaries can drift — there is no CI gate
on this yet (`.brain/governance/knowledge-lifecycle.md`). When a summary and the
code disagree, the code is right; fix the summary and note it in
`.brain/memory/known-issues.md`.

**Record what you learn.** Non-obvious decision → `.brain/memory/decisions.md`.
Trap hit → `.brain/memory/known-issues.md`. Approach that failed →
`.brain/memory/lessons.md`.

**Say what you did not do.**

---

## Commands

```bash
npm install              # install dependencies
npm run dev              # run locally — http://localhost:3000
npm test                 # unit tests (vitest run)
npx tsc --noEmit          # typecheck — free
./scripts/preflight.sh   # every durable check in one command — run before committing
```

Full command reference, destructive-command list, and env vars:
`.brain/tooling/registry.md`
