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
