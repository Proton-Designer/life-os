# Recent changes

**As of 2026-09-10.** Newest section first. Append here; don't rewrite history.

This file goes stale in weeks. Every claim below is dated. Verify before you build on it.

---

## 2026-09-08 → 09 — the AI connector (the largest change since the convergence)

Two systems from `docs/superpowers/specs/2026-09-09-ai-integration-handoff.md`, built
over two days by a lead plus two engineers. **`docs/ai-connector/` is this program's own
record and is the accurate, current source** — it is more detailed and more current than
this section.

**System A — a remote MCP server** so an existing Claude / ChatGPT / Gemini subscription
can read and write real Life OS data from inside those apps.

- `app/api/mcp/route.ts` — five generic tools: `list_capabilities`, `read`, `write`,
  `widget_manage`, `scheduler_manage`. `lib/mcp/registry.ts` registers **13 domains and
  ~60 entities** (deen, work, business, school, fitness, self_mastery, settings,
  checkins, distractions, calendar, review, home, widgets).
- **A hand-rolled OAuth 2.1 authorization server** (`app/api/mcp/oauth/*`, migration
  `132`): PKCE S256 mandatory, single-use codes via atomic CAS
  (`UPDATE ... WHERE used_at IS NULL`), refresh rotation with reuse detection, RFC 7591
  dynamic client registration, and a mandatory consent screen. This is **not** a
  Claude-only shim — research against current vendor docs found OAuth is the only auth
  path any of the three consumer apps accept.
- **Migrations `130`–`145`** back it: access tokens + append-only audit log (`130`,
  select-only RLS — an audit log its subject can edit is not one), the resolved-operation
  column (`131`), OAuth tables (`132`), `updated_at` triggers across Deen / work /
  business / school / cross-cutting / fitness (`133`, `135`–`139`), widgets (`141`),
  scheduled actions (`142`), a non-destructive prayer `unlogged` status (`143`), and the
  notify action (`145`).
- **Account isolation is proven, not asserted** —
  `docs/ai-connector/SECURITY-account-isolation.md` documents five independent layers and
  an adversarial test run against production, signing a real session JWT as SEED and
  failing to reach the owner's account on every attempt.

**System B** — quick AI-platform links in the shell (`dc1b02e`), plus a personal-access-
token setup in Settings that replaces the old BYO-API-key path as the way "AI" is
configured here.

**Also shipped in the same window:** theme presets and per-account feature visibility
(L10, migration `134`); a real `deen.prayer.unlog`; book-section summaries (`144`);
`/school` task list defaulting to This Week; and two composite-FK correctness fixes
(`139`, `140`).

**Known gap, recorded by the program itself:** `docs/ai-connector/OPERATOR-ACTIONS-PENDING.md`.

---

## 2026-09-01 → 02 — the convergence build

The change that made this a multi-tenant app. **Everything written before this date that
describes Life OS as single-user is describing the app that existed before this
section.**

**Four tabs — Home, Personal, Work, School — gated on what the user selects during
onboarding.** Onboarding is domain-first: pick domains, walk each selected domain in
selection order, per-domain setup, done. Nav is derived by pure functions in `lib/shell/`
so the rules are unit-testable.

**Personal Growth carries Faith, Self-Mastery and Fitness. ULM is fully integrated into
Self-Mastery**: a seeded 12-lesson / 47-card Meditations deck, FSRS scheduling, a
retrieval session with reveal-on-commit, a calibration tap, self-explanation
interstitials, an offline queue, and a session-complete payoff.

**Legacy accounts are untouched (M6).** `getUserDomains()` returns `{ mode: "legacy" }`
for an account with zero domain rows *and* completed onboarding, and the shell renders
the original LifeOS nav and Home. `ayman.0704m@gmail.com` — the owner's real daily
account — has zero domain rows and is legacy. `lib/home/compute-domain-visibility.ts` is
a pure function specifically so "a legacy account sees everything" is a permanent unit
test rather than a hand check.

**Verified, not asserted.** `e2e/stranger-journey.spec.ts` is the acceptance test: a
genuinely new account goes signup → onboarding → Home → session → 5 cards graded →
"Session complete." It checks the retrieval invariant at the **network layer** (no answer
text in any response before the user commits), and it passes against production.

**Security work.** All 19 cross-tenant FK gaps closed (`058`–`059`, `100`–`101`, plus
ULM's `086`–`089`). Two were proven exploitable by running the attack: a squatted row on
another user's parent permanently locks them out of their own data, invisibly, because
RLS hides the offending row. As of 2026-09-10 there are **67 composite tenancy FKs** and
**zero** single-column FKs to user-scoped parents, enforced by
`scripts/check-fk-tenancy.sh` rather than by memory.

**Durable instruments (all self-testing).** `scripts/preflight.sh` runs the lot.

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

Each self-tests by injecting a real failure and confirming detection. That matters:
`check-enum-drift` once went stale in exactly the way it existed to detect, and the
migration ledger was wrong within forty minutes of shipping.

**The lesson worth carrying:** every green that turned out to be real was one someone
**looked at a picture of**. Every green that turned out to be hollow was read from a log.

---

## Known gaps and live inconsistencies — verified 2026-09-10

Deliberate or unclosed, not forgotten. Each was checked against the code or the database
on this date.

- **Onboarding still writes the pre-115 vocabulary.** Migration `115` flattened Personal
  Growth into peer `faith` / `body` / `learning` rows and **is applied** (in
  `migration_ledger`; visible in production as `personal_growth` archived 2026-09-02
  03:58 UTC). But `components/onboarding/types.ts:6` still types `DomainKey` as
  `personal_growth | work | school`, so accounts created after the flatten still get a
  `personal_growth` row — `m.ayman4227@gmail.com` signed up nine hours later and has one.
  **Both vocabularies are live in production simultaneously.**
  `lib/domains/area-vocabulary.ts` bridges them and `lib/shell/nav-domain-state.ts:54-80`
  synthesises the three personal areas from flat keys. The pre-115 arm is live code.
- **`user_domains.depth` is a landed column with no consumer.** `lib/deen/faith-depth.ts`
  is a tested pure function with zero callers; no query even selects the column. Intended
  to gate *rendering* of Faith features, never deletion — but nothing calls it.
- **`user_domains.weight` is insert-only.** Written once at
  `app/(app)/onboarding/actions.ts:111`; no UI changes it afterwards. `business` and
  `co_op` have no weight entry at all.
- **Work subdomains share one pipeline.** Per-subdomain data scoping hasn't landed. The
  UI states this on screen (`app/(app)/work/[subdomain]/layout.tsx:44-51`) rather than
  hiding it.
- **`hidden_features` is not wired into the domains-mode nav.** A deliberate scope
  boundary documented at `components/shell/app-shell-chrome.tsx:61-65` — legacy and
  domains nav are separately-maintained paths, and the account the feature was built for
  is legacy.
- **A third account state exists.** `onboarding_completed === false` with zero domain
  rows is `mode: "domains"` with empty arrays, **not** legacy. But
  `lib/business/domain-weights.ts:44` uses its own zero-rows predicate that ignores
  `onboarding_completed`, so such an account is domains-mode for nav and legacy-mode for
  Signal:Noise. Live divergence.
- **`/open` is unreachable by navigation.** No static `href` to it exists anywhere in
  `app/` or `components/`. Direct URL only.
- **No book-ingestion driver.** `/api/self-mastery/ingestion/step` runs one stage, but
  nothing drives it; upload stays gated behind
  `lib/self-mastery/ingestion-availability.ts`, which lights up on its own when a model
  provider is configured. Without it the seeded 12-lesson deck is the only deck.
- **The e2e suite is partly blind to domains mode.** SEED
  (`ayman.mohammed@newtonbev.com`) is a legacy account, so most specs exercise the legacy
  nav. `seed-domains@lifeos.test` exists for the domains path; only a few specs use it.
- **Test accounts in production auth.** ~17 `onboard-*@example.com` rows from e2e runs,
  most recent 2026-09-09. Removing them is the owner's call.
- **`tsc` was red mid-afternoon 2026-09-10 and is green as of ~17:00** — 8 errors, all
  in test fixtures that predated `ActiveWorkSession` gaining `goalMinutes` /
  `objectives`, fixed by the session-goal track within the hour. Recorded because it is a
  useful reminder: in a shared working tree, a red `tsc` is often somebody else's
  in-flight work rather than a regression you caused, and it can go green without you
  doing anything. Check `git status` before diagnosing.
- **`next.config.ts`'s comment about the realtime provider is stale.** It says the
  provider is disabled; `components/shell/app-shell-chrome.tsx:103` mounts it, re-mounted
  2026-08-26 after the session-restore race was fixed.

---

## Note on this file's own history

The 2026-09-01 version referenced `convergence-ops/DECISIONS.md` (D-047 through D-052)
for the reasoning behind several decisions. **That directory does not exist in this
repo** — it was an operations workspace outside the checkout. The references have been
removed rather than left pointing at nothing.
