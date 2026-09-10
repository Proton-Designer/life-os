# Purpose and Domains

**Rewritten 2026-09-10.** The previous version (2026-08-31) opened by stating that Life
OS is "a single-user personal operating system built for one person, Ayman," explicitly
single-user "by decision, not by omission," and told the reader that "what if someone
else logs in?" was *the wrong question*. That was accurate when written and is false
now. It was also the most load-bearing sentence in the repo — every fresh agent
internalised it. What changed, and the evidence, is in §1.

This document answers what Life OS is trying to do, for whom, and what it means for the
app to be working. `ARCHITECTURE.md` explains how the code is arranged;
`RECENT-CHANGES.md` explains what changed recently. None of them tell you what a
*correct* change looks like when the code doesn't spell it out — that's this document's
job.

## 1. What Life OS is

Life OS is a personal operating system: one place to run a day across the life areas a
person actually has, built on the conviction that most tools **record well and decide
poorly**. It is **multi-tenant and open to signup**, and has been since the 2026-09-01
convergence build.

The evidence, verified against production on 2026-09-10 rather than taken from any
document:

- `app/signup/actions.ts` calls `supabase.auth.signUp` with no allowlist, invite code,
  or email filter, and redirects to `/onboarding`. Registration is open at the
  application layer; the only gate is whichever email-confirmation setting the Supabase
  project has.
- `auth.users` holds 23 accounts. One is a second real human
  (`kareem.badawi24@gmail.com`); 17 were created by genuine signup runs, the most recent
  on 2026-09-09.
- All **77** public tables have RLS enabled — zero exceptions — with `user_id =
  (select auth.uid())` own-row policies.
- **67 composite tenancy foreign keys** `(user_id, child_id) → parent(user_id, id)` make
  a cross-account row *unrepresentable*, not merely forbidden. Two of the gaps this
  closed were proven exploitable by running the attack: a squatted row on another user's
  parent permanently locks them out of their own data, invisibly, because RLS hides the
  offending row.
- `e2e/stranger-journey.spec.ts` is the acceptance test that a genuinely new account can
  sign up, onboard, reach Home, and complete a study session — and it checks the
  retrieval invariant at the network layer.

So the questions the old document called *wrong* — "would this scale?", "what if someone
else logs in?" — are now the right ones. Concretely: **do not** assume a table can grow
without bound because one person writes to it, **do not** hand-compute on every load
because there is only one reader, and **do not** treat RLS as decorative. RLS and the
composite FKs are the tenancy mechanism, not defence in depth over a single tenant.

**What did not change** is the product's opinion about how a person should be helped,
and most of this document is about that. The founding critique still governs: an
internal power-architecture review of the app's own first weeks concluded, in its own
words, that "Life OS records well and decides poorly" — every screen answered *what
happened*, almost nothing answered *what should I do now*. Home showing exactly one next
action, the nightly review forcing a rewrite of a failing plan, the close ceremony that
can refuse to continue: all of it is a correction of that.

## 2. Areas are data now, not a fixed list

The old version described "the five domains" — Deen, Work, Business/Lock-In, School,
Fitness — as a fixed decomposition of one person's life. They are now **rows a user
chooses at onboarding**, and the set is larger.

`user_domains.key` is CHECKed to seven values: `personal_growth`, `faith`, `business`,
`body`, `learning`, `work`, `school`. Each row carries a `weight`
(`essential` / `important` / `background`) and a `depth`
(`prayers_only` / `prayers_quran` / `full_practice`). `user_subdomains` hangs beneath
them — a fixed vocabulary under Personal Growth (`faith`, `self_mastery`, `fitness`), and
an **open-ended, user-named** one under Work, where a person creates a row per job or
business (production holds `MyHomeBase` and `Newton Bev`).

Two things about this are actively in motion, and asserting either half alone will make
you wrong:

- **Migration 115 flattened Personal Growth** — it "is a shell artifact, not a user
  concept" — so `faith`, `body` and `learning` became peer top-level rows. It is applied
  in production.
- **Onboarding was never updated to match.** `components/onboarding/types.ts:6` still
  offers only `personal_growth | work | school`, so accounts created *after* the flatten
  still get a `personal_growth` row. Both vocabularies are live simultaneously.
  `lib/domains/area-vocabulary.ts` is the bridge; the pre-115 arm is live code.

An account with **zero** domain rows and completed onboarding is in **legacy mode** and
sees the original fixed shell. That includes the owner's own daily account. See
`CLAUDE.md` for the full branch.

### What each area is trying to change

The design intent below is unchanged and still governs. It is what a correct change
looks like when the code doesn't spell it out.

**Faith / Deen** governs the five daily prayers, Qur'an reading, a habit builder for
religious practice, and a private daily reflection log. Its purpose is not
compliance-checking: everything on the screen exists to answer *how am I actually
doing*, not *did I check a box today*. That shows up structurally — a missed prayer
isn't hidden, a Qur'an streak has no freeze mechanic, and the private reflection log
exists specifically so something sensitive doesn't compete for space with a
public-feeling tracker. The app would rather show "0/5, not tracked yet" than a
discouraging false zero, and would rather break a streak outright than let a freeze
mechanic quietly launder a missed day. Success is honesty and consistency, not
completion.

**Work** governs a job — a single active priority ("Target") at a time, a short queue of
what's next, and a four-stage pipeline underneath. The whole design rests on one idea:
you can only truly focus on one thing at once, so the screen makes that one thing
physically larger and harder to lose track of than everything on deck behind it. Success
is forward motion on the one thing that currently matters, not breadth — the interface
actively resists showing an undifferentiated list of everything you could be doing. Work
now supports multiple user-named subdomains; note that they **share one pipeline** today,
which the UI states on screen rather than hiding.

**Business / Lock-In** governs deep-work and deep-study sessions and a daily three-item
kill list. Its spine: "every day you can only truly protect three priorities." And, as a
design commitment rather than an incidental choice, accumulated focus hours must never be
presented as an achievement — "as *context for output*, never as a score," because a
metric that becomes a score invites gaming it. This is the one area where record-keeping
is explicitly in service of self-honesty about effort, not motivation through progress
bars.

**School** governs classes, assignments, tests, and syllabi, and has since grown a grade
engine (projection, required-score, scenarios) and a risk engine (assignment and course
risk bands with confidence). Its job is more mechanical than the others — due dates,
overdue counts, one place per class to find the syllabus and schedule — but the intent is
the one that runs through Home: don't make anyone remember where something lives or
whether it's coming due. Surface it.

**Body / Fitness** governs training plans, a daily log, and a 28-day measurement cycle.
Its organizing idea: the app should never let you fool yourself about whether you trained
today, and should show honest numbers — sets, weight, waist, rep maxes — rather than a
vague sense of progress. It deliberately supports two very different training styles
(quick daily rep targets and structured multi-set sessions) because both get used.

**Learning / Self-Mastery** is the area the old document did not have, and it is now one
of the largest subsystems in the repo. It is spaced repetition over real material: books
→ sections → lessons → cards, scheduled by FSRS (`ts-fsrs`), with a retrieval session
that reveals only on commit, a calibration tap, and self-explanation interstitials. A
seeded 12-lesson Meditations deck ships with every new account. The piece that makes it
more than a flashcard app is the **promotion loop**: a lesson carries an action template,
a promotion is a commitment to actually try it, and an append-only verdict log records
whether it was adopted, abandoned, or is still being tested — with adopted lessons
leaving the review deck. A card you can recite is not the goal; a behaviour you changed
is.

## 3. The cross-cutting systems, and the failure mode each one closes

These aren't areas — they cut across all of them, and each exists because something
specific used to fail without it.

**Home** is the single daily entry point specifically because checking five separate
screens every time the app opens didn't happen — the day's actual priorities got missed
by omission, not by decision. Home's job is exactly three things in priority order: what
do I do right now, where am I in the day, how do I get to detail if I need it. Anything
on the screen that isn't one of those three is a candidate for removal. Home is
explicitly **not** a dashboard; metrics and history belong in Insights. What resolves
"right now" is the **cross-domain arbiter** (`lib/home/arbiter.ts`), which ranks
candidates from every area lexicographically: urgency → due time → area weight tier →
position → decay → cost → risk.

**The evening close** (`/close`) exists because a distraction noticed in the moment is
cheap to log and easy to never think about again — before it existed, "there is no moment
where the day gets closed." It runs in fixed stages, and its account stage is a genuine
**refusal gate**: a recurring trigger whose plan has failed three or more times with zero
successes gets force-rewritten rather than allowed to be silently re-skipped, and later
stages stay hidden until that's dealt with. A plan you keep failing and keep excusing is
worse than no plan. (`/review` is now a pure redirect here; the distraction review was
absorbed.)

**Distractions capture** is the front half of the same system: a one-tap,
no-navigation way to note "this just happened" without breaking whatever is in progress,
including inside a locked-in focus session. Friction at the moment of capture is what
makes things simply not get written down.

**Check-ins** exist so the app's picture of how time was actually spent doesn't rely on
reconstructing it from memory at the end of the day — periodic, low-friction prompts
sample reality as it happens (modeled on periodic-sampling tools rather than continuous
tracking) so Signal:Noise and Insights reflect what happened rather than a flattering
guess.

**Notifications** exist to be the thing that reaches out, rather than requiring someone
to remember to open the app at the right moment.

**Calendar and Insights** are the backward/forward-looking views, kept deliberately
separate from Home for the same reason Home excludes metrics.

**The AI connector** is the newest cross-cutting system: a remote MCP server plus a
hand-rolled OAuth 2.1 authorization server, so an existing Claude / ChatGPT / Gemini
subscription can read and write real Life OS data from inside those apps. Note what it is
*not* — it is deliberately not a chat surface inside Life OS (see §6). It reaches the
data through the same RLS-scoped client the web UI uses; a connector cannot obtain a
privileged one. `docs/ai-connector/SECURITY-account-isolation.md` records the five
independent isolation layers and an adversarial test run against production.

## 4. Design principles

Strongly and repeatedly evidenced in the app's own design history, not inferred from
patterns in the code:

- **Mobile-first, specifically at 390px.** A stated mandate, not an incidental bug
  source: "every screen must be designed at 390px, not merely not-broken." A real
  horizontal-scroll defect on `/school` at 390px was live in production for a day behind
  a fully green unit suite.
- **Speed of capture over completeness.** "Fast, frictionless logging"; single-tap and
  single-select interactions "to keep this friction-free"; the kill-list entry flow was
  redesigned to lower the effort of writing something down, not to make the form more
  thorough. `lib/capture/` is a deterministic parser that leaves ambiguities `null`
  rather than guessing — a wrong guess is worse than a blank.
- **Tell the user what to do next; do not present a dashboard.** The most explicit and
  most repeated principle in the record, and the diagnosis ("records well, decides
  poorly") that motivated most of what followed it.
- **Accountability over gamification, by name.** Points, badges and levels are
  explicitly rejected for Deen as "the wrong register for a system that tracks religious
  practice," on the grounds that a number that becomes a score corrupts the honesty of
  the data underneath it — and the same rule is reinvented independently for Business
  focus-hours ("as *context for output*, never as a score"). Two areas arriving at the
  same rule without cross-referencing each other is what makes this a principle rather
  than a preference.
- **Prefer a refusal to a silent no-op.** The close ceremony blocks. `crown()` refuses an
  unstarred item. `completeOnboarding` refuses zero domains. `saveDomainSelection`
  refuses an empty array. When the app cannot honestly do the thing, it says so.

One candidate principle worth naming because it did *not* hold up: **"nothing should
require a decision late at night" is not a real design rule here.** There's no evidence
for it, and the evening close actively cuts against it — it is deliberately scheduled in
the evening and does ask for real decisions then.

## 5. Objectives and how the app measures them

Several cadences run at once, deliberately, rather than one universal reset clock:

- **Daily**: the Business kill list resets every calendar day and does not carry
  unfinished items forward — a fresh, deliberate re-prioritization each morning rather
  than yesterday's leftovers silently becoming today's default.
- **Weekly, Sunday–Saturday**: headline weekly goals, the Signal:Noise ratio, and
  Fitness's weekly workout count all reset on this boundary.
- **Rolling 30-day windows, not hard resets**: reflection tracking and Qur'an-adjacent
  habit tracking are "last 30 days" rolling rates, deliberately avoiding the
  all-or-nothing fragility of a hard reset.
- **Elapsed-time stages, not streaks**: the Habit Builder's Active Build → Stabilized →
  Locked progression is computed purely from days elapsed since a committed start date; a
  streak explicitly does not gate promotion.
- **28-day training cycles**: anchored to the date the first plan was ever activated,
  counting in the background even through periods with no active plan.
- **Scheduler-driven, not calendar-driven**: Self-Mastery review intervals come from
  FSRS state per card, not from any of the above.

The throughline: the app doesn't treat "current streak" as the universal scoreboard —
several areas were deliberately built to avoid exactly that fragility, in favor of
measures that tolerate a bad day without erasing a good month.

## 6. What this app is deliberately not

Directions considered and rejected, worth knowing precisely because a plausible-sounding
request can point straight at one:

- **A general LLM chat surface inside the app** — "the references have one; it would be
  decoration here." Note this is *not* contradicted by the AI connector: the ruling was
  against a chat box in Life OS, and the connector deliberately inverts it, bringing Life
  OS data into the assistant the user already pays for.
- **Gamification** — points, badges, levels, rejected by name.
- **Full offline-first sync** — enormous complexity for the benefit; the Self-Mastery
  session has a scoped offline queue instead, which is the narrow case that earned it.
- **Calendar import from external services** — real value, but its own integration
  project, not worth the auth/sync surface for what it would add.
- **A global search field** — rejected on the grounds that the app doesn't have enough
  surface area to search. *Flag:* this reasoning was explicitly "a single-user,
  nine-screen app." The app is no longer either. The conclusion may still be right; the
  argument for it no longer holds, so re-derive rather than cite it.
- **Widening the Business kill list past three items** — called out as the one place the
  product already, deliberately, says no.
- **Automated fiqh logic for prayer-shortening rules** — left to manual judgment,
  because that's the kind of thing that is easy to get subtly and invisibly wrong by
  automating.

The old version listed "any form of multi-user or social/sharing feature" here.
**Multi-user is no longer a non-goal — it is the current architecture.** Social and
sharing features remain unbuilt and unplanned, but that is absence, not a ruling.

## 7. Where the source of truth lives

- **The code and the schema** outrank every document here. Where they disagree, the
  document is the bug.
- `docs/ai-connector/` — the AI-connector program's own current record.
- `supabase/migrations/ALLOCATIONS.md` — the authoritative migration ledger and the
  reasoning behind individual schema decisions. Append-only; never restructure it.
- `AGENTS.md` — the hard operational rules, each paid for in a real production incident.
- `docs/superpowers/specs/` — **dated design history.** Read chronologically it is a
  decision log; later files revise earlier ones. Its August files describe a nine-screen
  single-user shell that no longer exists, and `2026-08-09-life-os-design.md` is the
  origin of the single-user framing §1 corrects. The *intent* in these files is largely
  still good; the *screens* are not.
- `PROJECT_STATUS.md` — a frozen historical build log for 2026-08-10 → 2026-08-20.
- `context/Life OS — Complete Feature Guide.docx` — written 2026-08-29, so it predates
  the domains restructure. It is accurate for the legacy shell and silent on everything
  after.
