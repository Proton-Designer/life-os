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

## `git commit -- <paths>` ignores the index — never use it in a shared tree

Several agents edit this working tree simultaneously. The obvious defence —
"only ever commit explicit paths" — is **not** what it appears to be:

```
git commit -m "msg" -- <paths>     # WRONG in a shared tree
```

Git's documentation is explicit: when a pathspec is given on the command line,
it commits the contents of the matching files *without recording the changes
already staged*. It reads the **working tree**, not the index. So anything
another agent has saved into one of your files between your last check and the
commit lands in your commit, under your name — and any staging you did first is
silently discarded.

That is not hypothetical. On 2026-08-25 an engineer deliberately isolated a
colleague's uncommitted line out of the index with `git apply --cached`, then
committed with a pathspec, and the line went in anyway (`87119ee`).

**Use the index instead, and verify it:**

```
git add <explicit paths>
git diff --cached          # authoritative: exactly what will be committed
git commit -m "msg"        # no pathspec
```

The index is a **snapshot**. Once you `git add`, a concurrent save by another
agent into one of your files cannot enter your commit. A pathspec commit has no
snapshot at all, so even a correct `git diff HEAD -- <paths>` a second earlier
can be invalidated by someone else's editor flushing in the gap.

Still applies as before: explicit paths only, `git diff HEAD -- <path>` on every
file before you stage it, and never `git add -A`, `git commit -a`, `git stash`,
`git reset --hard`, `git checkout --`, or `git clean` in the shared tree.
