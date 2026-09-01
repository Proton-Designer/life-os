# Recent changes — convergence build

Last updated 2026-09-01, end of the first full build day. Production is live,
green, and demonstrated end to end by an automated first-run journey.

## What the app is now

Four tabs — **Home, Personal, Work, School** — gated on what the user selects
during onboarding. Onboarding is domain-first: pick domains, walk each selected
domain in selection order, per-domain setup, done.

**Personal Growth** carries Faith, Self-Mastery and Fitness. **ULM is fully
integrated into Self-Mastery**: a seeded 12-lesson / 47-card Meditations deck,
FSRS scheduling, a retrieval session with reveal-on-commit, a calibration tap,
self-explanation interstitials, an offline queue, and a session-complete payoff.

**Legacy accounts are untouched (M6).** `getUserDomains()` returns
`{ mode: "legacy" }` for an account with zero domain rows, and the shell renders
the original LifeOS nav and Home. `ayman.0704m@gmail.com` has zero domain rows
and is verified legacy. `lib/home/compute-domain-visibility.ts` is a pure
function specifically so "a legacy account sees everything" is a permanent unit
test rather than a hand check.

## Verified, not asserted

`e2e/stranger-journey.spec.ts` is the acceptance test: a genuinely new account
goes signup → onboarding → Home → session → 5 cards graded → "Session complete."
It checks the retrieval invariant at the **network layer** (no answer text in any
response before the user commits), and it passes against production.

## Durable instruments (all self-testing)

| script | asserts |
|---|---|
| `check-rls.sh` | every public table has RLS and a policy |
| `check-enum-drift.sh` | DB CHECK value sets are named in TypeScript |
| `check-fk-tenancy.sh` | no single-column FK to a user-scoped parent |
| `check-vocabulary-drift.sh` | two DB objects don't spell one concept two ways |
| `check-migrations-applied.sh` | what's on this DB; parity between two DBs |
| `apply-migration.sh` | applies AND records; refuses an edited re-run |
| `deploy-prod.sh` | deploys **committed** state from a clean worktree |
| `agent-commit.sh` | atomic stage+commit in the shared tree |

Each self-tests by injecting a real failure and confirming detection. That
matters: `check-enum-drift` once went stale in exactly the way it existed to
detect, and the migration ledger was wrong within forty minutes of shipping.

## Security work

All **19** cross-tenant FK gaps closed (`058`–`059`, `100`–`101`, plus ULM's
`086`–`089`). Two were proven exploitable by running the attack: a squatted row
on another user's parent permanently locks them out of their own data, invisibly,
because RLS hides the offending row. LifeOS now has **zero** single-column FKs to
user-scoped parents, enforced by a script rather than by memory.

## Known gaps — deliberate, not forgotten

- **No ingestion worker.** `uploadBook` is implemented but nothing consumes
  `ingestion_jobs`, so book upload is **disabled** behind
  `lib/self-mastery/ingestion-availability.ts` (derived from whether a model
  provider is configured — it lights up on its own when a key lands). Without it
  the 12-lesson deck is the *only* deck: roughly ten days of new material at five
  new cards/day, then reviews forever.
- **School migrations `093`–`097`** are written, verified, applied to scratch,
  and uncommitted pending Ayman's go-ahead. They are the sole structural
  difference between scratch and production.
- **`book_milestone`** deliberately unbuilt: with twelve lessons nobody reaches
  the threshold for weeks, so it would be a correct celebration nobody can reach.
- **~68 test accounts** in production auth from e2e runs. The leak is fixed
  (`afterEach` teardown, proven by counting rows before and after); removing the
  existing rows is Ayman's call.

## The lesson worth carrying

Every green that turned out to be real was one someone **looked at a picture
of**. Every green that turned out to be hollow was read from a log. See
`convergence-ops/DECISIONS.md` D-047 through D-052.
