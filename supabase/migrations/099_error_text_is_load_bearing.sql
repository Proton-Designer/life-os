-- Annotate the functions whose `raise exception` TEXT is load-bearing.
--
-- WHY (found 2026-09-01, porting ULM's offline queue)
--
-- `lib/self-mastery/session/offline-queue.ts` decides **retry vs. give up** by
-- string-matching the messages these functions raise:
--
--     message.includes("no card_states row")
--     message.includes("must increase by exactly")
--     message.includes("illegal transition")
--     message.includes("has been deleted")        <- added by 081's guard
--     ...
--
-- A message classified as permanent is dropped. Anything unrecognised falls
-- through to the transient default and **retries until the attempt cap** — so
-- rewording a `raise` turns a permanent failure into a poison pill that retries
-- forever. That is precisely the failure the classifier exists to prevent.
--
-- WHAT MAKES THIS WORSE THAN THE OTHER STALE-ARTIFACT BUGS WE HIT TODAY:
-- those had one artifact you could be wrong about, and `pg_get_functiondef`
-- against the migration file showed the drift. **Here the coupling is a string,
-- across two languages, in two repositories, connected by nothing a compiler or
-- a type can observe.** `tsc` passes. Lint passes. Every test passes unless one
-- deliberately triggers that exact server error.
--
-- And the failure direction is server → client: **the person who breaks it is
-- someone tidying a SQL error message, and they will never open the
-- TypeScript.** So the warning goes HERE, where that person is standing — not
-- only in the classifier, where the breakage eventually surfaces.
--
-- `COMMENT ON FUNCTION` rather than a redefinition: these functions are already
-- correct and live, and redefining one to add a comment risks exactly the
-- multi-version hazard documented on `submit_review` (redefined three times; a
-- rebuild from the wrong file silently reverts real fixes). A comment attaches
-- without touching the body, and shows up in `\df+` for anyone inspecting it.
--
-- BETTER FIX, DELIBERATELY NOT DONE HERE: switch the classifier onto something
-- structural — a SQLSTATE via `raise ... using errcode`, or a typed
-- discriminator — because prose is the thing people feel free to improve. That
-- is a real change to live functions with a live caller, and it wants its own
-- migration and its own verification rather than riding along with a doc pass.

comment on function public.submit_review is
  'LOAD-BEARING ERROR TEXT. The messages raised here are string-matched by '
  'lib/self-mastery/session/offline-queue.ts to decide retry-vs-give-up. '
  'Rewording a raise turns a permanent failure into one that retries until the '
  'attempt cap. If you change a message, change the classifier in the same '
  'commit — nothing in the type system or the test suite will catch it.';

comment on function public.start_session is
  'LOAD-BEARING ERROR TEXT — see the comment on submit_review. Messages raised '
  'here are string-matched by the client offline queue.';

comment on function public.complete_session is
  'LOAD-BEARING ERROR TEXT — see the comment on submit_review. Messages raised '
  'here are string-matched by the client offline queue.';
