---
id: meta.domains-readme
title: Domains
layer: L2
type: meta
status: canonical
owner: unassigned
updated: 2026-09-13
answers:
  - "what business domains exist"
  - "which domain owns X"
covers: "What qualifies as a domain, the full domain index, how to write one"
excludes: "The domains themselves (see each domain's own .brain/domains/*.md)"
tokens_est: 1118
---

# `.brain/domains/`

One summary per **business capability**. This is the layer most repositories lack,
and its absence is why agents read code to answer questions code was never the
right source for.

---

## The domains (14)

| Domain | Covers | Primary code | Owner |
|---|---|---|---|
| [Home + Cross-Domain Arbiter](home-arbiter.md) | Home as the single daily entry point; ranks candidates from every domain into one "Now" | `lib/home/` | unassigned |
| [Deen (Faith Practice)](deen.md) | Prayer windows, Qur'an reading, sunnah tracking, habit-builder, reflection, Qada backlog | `app/(app)/deen/`, `lib/prayer-times/` | unassigned |
| [Fitness](fitness.md) | Training plans, daily log, body metrics, 4-week measurement cycles | `app/(app)/fitness/` | unassigned |
| [Self-Mastery (ULM)](self-mastery.md) | Book ingestion, FSRS spaced repetition, lesson-promotion loop | `app/(app)/personal/[subdomain]/`, `lib/self-mastery/` | unassigned |
| [Work / Co-op](work-coop.md) | Up to 3 live Targets, per-target task pipeline, Deep Work/Study Lock-In | `lib/coop/`, `app/(app)/work/` | unassigned |
| [Business / Lock-In](business-lockin.md) | 3-item daily Kill List, weekly goal, Lock-In sessions, Signal:Noise | `lib/business/` | unassigned |
| [School](school.md) | Classes, assessments, weekly schedule, grade projection, risk scoring | `lib/school/`, `app/(app)/school/` | unassigned |
| [Evening Close / Morning Open / Night Plan](evening-close.md) | Nightly close refusal gate, read-only morning-open, dump/star/crown night-plan engine | `lib/evening-close/`, `lib/night-plan/` | unassigned |
| [Distractions + Check-ins](distractions-checkins.md) | One-tap distraction capture + 3-strike rewrite discipline; periodic time-allocation check-ins | `lib/distractions/`, `app/(app)/distractions/` | unassigned |
| [Calendar](calendar.md) | Sun–Sat hour-grid week view, read-mostly | `app/(app)/calendar/` | unassigned |
| [Insights](insights.md) | The analytics hub — metrics, trends, history that Home deliberately excludes | `app/(app)/insights/`, `lib/insights/` | unassigned |
| [MCP AI-Connector](mcp-connector.md) | Remote MCP server + OAuth 2.1 authorization server for external AI clients | `lib/mcp/`, `app/api/mcp/**` | unassigned |
| [Widgets](widgets.md) | Declarative, MCP-created Home dashboard widgets — Tier 1 only | `lib/widgets/` | unassigned |
| [Settings & Onboarding](settings-onboarding.md) | Domain-first onboarding wizard, Settings, the legacy/domains-mode split | `lib/domains/`, `app/(app)/onboarding/` | unassigned |

---

## What counts as a domain

A **business capability**, not a directory and not a technical layer.

| Domain | Not a domain |
|---|---|
| Deen, Fitness, School, Business/Lock-In | a generic utils folder, a generic UI-components folder, the API layer generically |

14 domains for this repo's size and depth is on the high end of the typical 3–15
range, and is justified here: this is a merged product (LifeOS + CollegeOS + ULM)
with genuinely distinct business capabilities, not directories indexed as domains.

---

## Writing one

Use `_TEMPLATE.md`. Budget: **150 lines**.

The test a domain summary must pass:

> Could an agent implement a small feature in this domain, correctly, having read
> only this document and the files it names?

Two fields carry disproportionate weight: **`sources:`** (makes drift mechanically
detectable) and **`excludes:`** (the boundary — without it an agent answers
confidently out of a gap).

## Shared vs. local

This repo is a single package (not a monorepo), so every domain lives at the root
`.brain/domains/` — there is no "which package" question to ask here.
