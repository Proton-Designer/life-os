---
id: domain.settings-onboarding
title: Settings & Onboarding (incl. domain-vocabulary migration)
layer: L2
type: domain
status: canonical
owner: unassigned
updated: 2026-09-13
sources:
  - app/(app)/settings/**
  - app/(app)/onboarding/**
  - lib/domains/**
  - lib/shell/**
  - components/onboarding/**
related:
  - domain.home-arbiter
  - domain.mcp-connector
  - arch.system-overview
answers:
  - "why do two domain vocabularies exist at once"
  - "what is legacy mode vs domains mode"
  - "why does an account get the wrong nav"
covers: "The domain-first onboarding wizard, Settings, and the two-navigation-mode split this is the origin of"
excludes: "Per-domain settings detail (theme, feature-visibility columns) beyond the vocabulary/nav mechanism itself"
tokens_est: 1258
source_hash: d856efe8dd42be0646cf3954113622d90ebafe04420ea6f6fa25b891888c8b3f
---

# Settings & Onboarding

## Purpose

Onboarding is the resumable, domain-first wizard that writes `user_domains`/`user_subdomains` and flips `profiles.onboarding_completed`. Settings configures theme, feature visibility, prayer/location, MCP connectors/PATs, and legacy BYO AI keys. Together they are the origin of the app's single most consequential structural fact: two separately-maintained navigation modes.

## Key concepts

| Term | Means |
|---|---|
| Legacy vs. domains mode | `getUserDomains()`: `onboarding_completed && domains.length===0` → `{mode:"legacy"}` (the original fixed six-item nav) — a deliberate failsafe for pre-domains accounts, not a bug. Otherwise `{mode:"domains", domains, subdomains}` (at most four tabs). |
| The vocabulary migration | Migration 115 flattened `personal_growth` into peer top-level rows `faith`/`body`/`learning`. **Onboarding was never updated** — `components/onboarding/types.ts` still types the old key. Both vocabularies are live in production simultaneously. |
| The bridge | `lib/domains/area-vocabulary.ts` resolves post-115 key first, pre-115 group+subdomain second. `lib/shell/nav-domain-state.ts`'s `personalSubdomains()` synthesizes the three personal areas from flat keys when the legacy group is empty — **this pre-115 arm is live code**, not dead code (it once silently broke all of `/personal/*` for a post-115 account until built). |
| `weight`/`depth` | Written only at onboarding, insert-only. `weight` feeds the Home arbiter's 3rd sort key and Signal:Noise; `depth` has **zero consumers** anywhere. |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Nav-mode entry point | `lib/domains/get-user-domains.ts` | `cache()`-wrapped |
| Vocabulary bridge | `lib/domains/area-vocabulary.ts` | "The one place that knows migration 115's before/after vocabulary" |
| Nav synthesis | `lib/shell/nav-domain-state.ts`, `build-primary-nav-items.ts` | |
| Onboarding types | `components/onboarding/types.ts` | Out of step with the schema (see above) |
| Actions | `app/(app)/onboarding/actions.ts` | `weight` write path, line ~111 |

## Integration points

| Direction | With | Via |
|---|---|---|
| Depended on by | Every domain's nav reachability | `getUserDomains()` |
| Depended on by | Home arbiter, Business Signal:Noise | `weight` (both, but via **two independently-computed, disagreeing** "is this legacy" predicates) |
| External | MCP connector | `settings` domain: `profiles`/`user_settings`/`user_api_keys`, field-restricted (never `encrypted_key`) |

## Constraints & gotchas

- **Two "is this user legacy" checks disagree.** `getUserDomains()` checks `onboarding_completed && zero rows`; `lib/business/domain-weights.ts`'s `getUserDomainWeights` checks only `zero rows`, ignoring `onboarding_completed`. A fresh domains-mode account mid-onboarding is nav-mode "domains" but Signal:Noise-mode "legacy" — real, live, documented in `context/RECENT-CHANGES.md`, independently re-derived from source. **A third similar zero-rows check elsewhere has not been ruled out** (no exhaustive grep performed).
- `/deen`, `/business`, `/fitness`, `/school` are reachable by direct URL in **both** modes — only `/personal/*` and `/work/*` are mode-gated. "Domains mode hides Deen" is a nav claim, not a route claim.
- Domains-mode nav does **not** respect `profiles.hidden_features` — a deliberate scope boundary.

## Not covered here

- Per-domain settings columns beyond the vocabulary/nav mechanism itself

## Unverified

- Whether a third zero-`user_domains`-rows branch exists elsewhere that also disagrees with the two known ones — flagged as worth a dedicated audit, not performed here.
