<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project-specific constraints

## Never pass a function as a prop from a Server Component to a Client Component

Hit twice during the 2026-08-15/16 structural refactor (Phase D's `AreaChart` `yTickFormat` callback, Phase E's `GoalCard` `onSave` closure) — both times `tsc --noEmit` and the full `vitest` suite passed clean, and the bug only surfaced live in the browser console ("Functions cannot be passed directly to Client Components"). jsdom-based unit tests don't enforce the RSC serialization boundary, so this class of bug is invisible to every automated check except an actual `next dev`/`next build` render.

**The fix, every time:** if the value you need to hand a Client Component is a Server Action (`"use server"`, either its own file or an inline directive), a bound reference survives the boundary — use `someAction.bind(null, arg)`, not a wrapping arrow function. If it's a plain formatting/callback function, replace it with a plain serializable value the Client Component can format internally (e.g. `AreaChart`'s `yTickFormat` callback became a plain `unit?: string` prop).

**No lint rule enforces this** — evaluated `eslint-plugin-react-server-components` in Phase H (2026-08-16) and rejected it: the package is explicitly self-described by its own author as "an experiment," hasn't been published since May 2024, and its only rule (`use-client`) checks directive placement, not prop serializability — it would not have caught either incident above. No better-maintained alternative exists as of this writing. Re-evaluate the ecosystem periodically; until then, this paragraph is the enforcement mechanism.

**When touching a page.tsx that passes props into a Client Component**, mentally check every prop: is it a function? If yes, is it a real Server Action reference (fine) or a closure/inline arrow (not fine)? Verify by actually loading the page in a browser and checking the console — not by `tsc`/`vitest` alone.

## Never derive a calendar date from a raw `Date` — always from the user's timezone

Hit **three times in one night** (2026-08-24/25), in three different layers:

1. **Shipping code, live for months.** `lib/prayer-times/calculate.ts` built its Julian date from `date.getUTCFullYear()/getUTCMonth()/getUTCDate()`. Ayman is `America/Chicago` (UTC−5), so from **19:00 local onward it is already tomorrow in UTC** and the app computed *tomorrow's* prayer times. Five production callers were affected — Day's Shape, the Now module, sector progress, the allocation queue, and the Deen Next-Prayer KPI. Symptom was oblique: activity blocks collapsed to zero width at the left edge of the ribbon, because every one of today's events fell before the (tomorrow) range start and clamped to 0%. Fixed in `03ab12b` by normalising **inside** `computePrayerWindows` — one point, not five call sites.
2. **Hand-written SQL.** Postgres `current_date` is UTC. Seeding a "today" row at 22:05 CDT creates it dated tomorrow. (The app's own SQL is clean — audited 2026-08-25, zero occurrences of `current_date`/`now()::date` in `supabase/` or query code. Every date arrives as an explicit string computed in the app layer. Keep it that way.)
3. **Test fixtures.** A spec picked "today" from the runner's clock and silently created tasks dated tomorrow relative to the account's local day.

**The rule:** a calendar date is a function of an instant *and a timezone*. Never `new Date()`, `getUTCDate()`, or `current_date` as a stand-in. Use `localDateString(now, timezone)`, and for day bounds use `resolveLocalTime(dateStr, "00:00", timezone)` — **not** `` `${dateStr}T00:00:00Z` ``, which treats an already-local date as a UTC boundary and pulls in the previous evening (that exact bug has shipped twice; see the comment in `lib/home/get-home-extras.ts`).

**Watch for the inverse too.** A function that normalises internally will *re-localise* a pseudo-instant like `new Date(\`${dateStr}T00:00:00Z\`)` a day backward in any zone behind UTC. If you pass a date-derived anchor into such a function, make it a real local instant — noon local is safest, being maximally far from both midnight boundaries.

**Tests must pin the boundary**, not just the happy path: the same local time either side of the UTC rollover (e.g. 18:59 and 19:01 CDT) must produce identical results, and at least one timezone *east* of UTC, where the bug inverts.

## Committing from a shared working tree: use `scripts/agent-commit.sh`

Several agents edit ONE working tree with ONE `.git`, which means they share ONE
**index**. Both obvious commit strategies race, and this was learned the hard way
twice in one night (2026-08-25):

```
git commit -m "msg" -- <paths>     # ignores the index; commits WORKING-TREE
                                   # state, so another agent's unsaved edit to
                                   # a file you own rides along.  → 87119ee
git add <paths>; git commit        # reads the index at commit time; another
                                   # agent staging in the gap between your add
                                   # and your commit puts THEIR files in YOUR
                                   # commit.                       → 631a921
```

The second is strictly better, but still unsafe: **verifying with `git diff
--cached` does not help, because the race happens after the verification.** The
index is shared mutable state, so stage-and-commit has to be *atomic with
respect to the other agents*.

**Always commit with:**

```
./scripts/agent-commit.sh "your commit message" path/one path/two
```

It takes a mkdir mutex (macOS has no `flock`), resets the index, stages exactly
your paths, prints precisely what will be committed, and commits. The index
reset touches the **index only** — it never modifies the working tree, so no
one's uncommitted edits are ever at risk.

Everything else still applies: explicit paths only, `git diff HEAD -- <path>`
before you stage a file, and never `git add -A`, `git commit -a`, `git stash`,
`git reset --hard`, `git checkout --`, or `git clean` in the shared tree.

If a commit lands under the wrong agent's message anyway, **leave it**. The code
is correct and present; rewriting history in a tree other agents are actively
committing to is far worse than a misattributed diff.

## Before deploying: run the full e2e suite, and distrust a green that saw nothing

`tsc` + `vitest` are structurally blind to most of what breaks this app. On
2026-08-25 a batch shipped on "1577/1577 green" alone. The Playwright suite
was **already red at that commit** and stayed red, unnoticed, for a day:
eight specs described UI that the same night's redesign had replaced, and a
real defect — `/school` scrolling horizontally at 390px, Ayman's own phone —
was live in production the whole time. Unit tests cannot see any of it.

**Run `npx playwright test` (both projects) before every deploy.** Not a
`-g`-filtered subset: `-g` also filters out the `setup` project, so the run
silently reuses a stale `storageState` and you learn nothing about auth.

### A check that examines nothing reports success

Three separate checks did this in one afternoon (2026-08-26), and all three
failed **green**, which is the direction nothing ever flags:

- An overlap check measured an assessments table that was **empty** on SEED —
  zero overlaps found, because there was nothing to overlap. The real bug
  (a crushed Name column at 390px) appeared the moment the fixture was seeded
  to match the shape of the reported bug.
- `layout-overflow.spec.ts` passed `/school` in ~3s by measuring **before the
  class cards rendered**. A timing settle (networkidle + fonts + rAF) cannot
  distinguish "nothing wide has mounted yet" from "nothing wide exists." Only
  a *content* assertion can — hence `READY_SELECTOR` in that spec.
- A `-g`-filtered production run skipped the auth setup entirely and reported
  a pass against a session that was never established.

**Before trusting any check about a reported bug, seed the fixture to the
shape of that bug and confirm the check FAILS first.** A red you can explain
is evidence; a green you didn't earn is not. (Same discipline that made the
prayer-floor fix trustworthy: prove the broken case first, so the fixed case
means something.)

### Two mechanical traps that cost real time

- **`playwright test | tail` returns `tail`'s exit code.** A run with 12
  failures reported `exit 0`. Never read a test result through a pipe — run
  it bare and check `$?`, or write to a file.
- **Killing a mutating e2e run leaves SEED dirty.** An interrupted
  `fitness.spec.ts` left an orphaned active plan that the *next* run read as
  its baseline and then deleted, failing a residue comparison that had
  nothing to do with the code. If you kill a suite, check SEED before
  believing the next run's failure.

### Production verification is worth the two minutes

`PLAYWRIGHT_BASE_URL=https://tracking-app-sand.vercel.app npx playwright test …`
runs the same specs against the live site with no local server. Capture the
failing check **before** deploying and re-run it after — a deploy that
doesn't flip a known-red check didn't do what you think it did.

Expect the first post-deploy run to hit a cold serverless start; `login`'s
post-signin assertion carries an extended timeout for exactly that reason.
A slow login there is not a broken login — verify against localhost, the
previous deployment, and Supabase's token endpoint directly before concluding
you have shipped an outage.

## Only ONE agent runs Playwright at a time

The shared working tree has a second shared mutable resource besides the git
index, and it went unguarded far longer: **the e2e environment**. All specs
drive one SEED account against one live database, and every run rewrites
`playwright/.auth/user.json`.

On 2026-08-26 four agents ran mutating suites concurrently. Two failure modes,
both of which look like application bugs and are not:

- **Corrupt `storageState`.** Two `auth.setup` processes wrote the file at
  once, leaving a complete JSON object followed by a fragment — the file ends
  `}}`. Every test in the run then fails with
  `SyntaxError: Unexpected non-whitespace character after JSON`, which reads
  exactly like broken authentication. Fix: `rm playwright/.auth/user.json`,
  then run the `setup` project alone.
- **Cross-run row collisions.** Specs create and delete rows the other runs
  are mid-assertion on. Three engineers each independently "found" failures
  they were partly causing for each other.

**Rule: the Lead runs `npx playwright test`. Nobody else — not filtered, not a
single spec.** `tsc` and `vitest` are pure and stay free for everyone; ask the
Lead for any browser verification.

### A spec must clean up on failure, not only on success

The same incident exposed a spec that amplified one unrelated failure into a
permanently red test: `school-class-view.spec.ts` asserted on shared text
(`getByText("Sep. 3rd")`, which matches *any* task due that day), and its
cleanup ran only after the assertions. One corrupted-auth failure left its
task behind; the next run then had two rows due that date, failed strict-mode
ambiguity, and left a third.

Two rules fall out, and they apply to every mutating spec:

- **Anchor assertions to something unique to this run** (the generated title),
  never to a value other rows can share.
- **Put teardown in `afterEach`**, registered *before* the row is created, so
  an assertion failure anywhere still removes it. Keep any in-UI removal as a
  real assertion — the `afterEach` is a net beneath it, not a replacement.
