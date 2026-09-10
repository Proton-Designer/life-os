# Known-stale comments — read before trusting a "not in the generated type yet" claim

Comments age out of truth silently. A comment that was accurate when written and
never updated reads exactly as authoritative as one that's still true — the text
gives no signal that the world moved on underneath it. This file exists so the
next reader checks the claim instead of inheriting it, the way a stale
`CheckinSchedulerLoader` comment cost the lead twenty minutes on 2026-09-09
believing dead code was live.

## `lib/self-mastery/untyped-from.ts`'s header (found 2026-09-10, Eng3)

The file's own comment reads:

> books/lessons/cards/card_states/source_chunks/ingestion_jobs aren't in
> the generated Database type yet — see types.ts's header... Delete this
> the moment lib/supabase/database.types.ts is regenerated against the
> migrated schema.

**This is no longer true.** Confirmed directly against `lib/supabase/database.types.ts`
(2026-09-10): every one of those tables — `books`, `lessons`, `cards`, `card_states`,
`source_chunks`, `ingestion_jobs`, plus `lesson_promotions`/`lesson_verdicts` — is
present with real `Row`/`Insert`/`Update` types. `database.types.ts` was regenerated
at some point after this comment was written; the comment was never updated to match.

**What this means for anyone touching self-mastery/ULM code:**

- `untypedFrom(supabase, "table")` still WORKS (it's a plain cast-through wrapper),
  but it is no longer NECESSARY for any of the tables the comment lists. A query
  against one of them can and should use the real typed client (`supabase.from("books")`
  etc.) directly, which gets you compiler-checked column names for free.
- **Not fixed in scope** when found (Eng3 was building `lib/promotions/actions-core.ts`,
  which uses the real typed client instead of this escape hatch for exactly this
  reason) — the existing `untypedFrom` call sites elsewhere (e.g. `lib/promotions/
  actions.ts`'s `promoteLesson`, and plenty of other self-mastery code) were left
  alone. They are not bugs; they're just no longer necessary, and migrating them is
  a separate, low-priority cleanup, not something to do as a drive-by edit while
  touching unrelated code.
- **Do delete `untyped-from.ts` and its remaining call sites** the next time someone
  is properly in this area — the file's own header already says to, once the actual
  precondition (a regenerated `database.types.ts`) holds, which it now does.
