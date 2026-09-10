# Life OS

A personal operating system for running a day across the life areas you actually have —
faith, work, school, fitness, learning, business. Built on the conviction that most
tracking tools **record well and decide poorly**, so the app's job is to answer *what
should I do right now*, not *what happened*.

Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase Postgres · deployed on Vercel.
Installable PWA with web push.

## What's in it

- **Home** — a cross-domain arbiter that ranks candidates from every area into one next
  action.
- **Areas you choose at onboarding** — faith, work, school, fitness, learning, business.
  Navigation, Home, and the weekly goals adapt to what you picked.
- **Self-Mastery** — spaced repetition over real books (FSRS), with a promotion loop that
  tracks whether a lesson actually changed a behaviour, not just whether you can recite it.
- **Lock-In** — deep-work sessions and a deliberately three-item daily kill list.
- **Evening close** — a closing ceremony that will refuse to continue while a distraction
  plan has failed three times without a rewrite.
- **AI connector** — a remote MCP server plus an OAuth 2.1 authorization server, so
  Claude / ChatGPT / Gemini can read and act on real data from inside those apps.

Multi-tenant: signup is open, and isolation is enforced by row-level security on every
table plus composite tenancy foreign keys that make a cross-account row unrepresentable.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires a `.env.local` with Supabase and related credentials (gitignored).

```bash
npm test             # vitest
npx tsc --noEmit
./scripts/preflight.sh   # every durable check in one command
```

## If you are an agent working in this repo

**Read `CLAUDE.md` first, then `docs/REPO-MAP.md`.** `AGENTS.md` holds the hard
operational rules — shared-working-tree commit protocol, the timezone rule, the RSC
prop-serialization trap, Playwright discipline — and every one of them was written after
a real production incident. They are not optional and not stylistic.
