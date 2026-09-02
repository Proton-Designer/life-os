-- Adds user_domains.weight -- the closed 3-tier ordinal ruling R10 mandates
-- as the sixth signal of the cross-domain arbiter (essential/important/
-- background, NEVER a free numeric). Second of the ordered (a)->(b)->(c)
-- domains-as-data sequence's schema-touching pieces.
--
-- Why a closed tier, not a number (R10, verbatim): "Weight ranks
-- candidates, never manufactures one." A free numeric invites drift, has
-- no meaning a user could ever be shown, and makes "why is this ranked
-- above that" unanswerable. `position` (selection order, already on this
-- table) remains the tie-break WITHIN a tier, so re-ordering can never
-- silently promote a domain across tiers -- only weight does that, and
-- weight only ever changes from a deliberate "what matters most" action
-- (a later, one-screen UI, not built here).
--
-- Backfill, not a plain DEFAULT (Opus Lead's explicit instruction): R10
-- says "first picks essential, rest important, nothing born background" --
-- a column DEFAULT cannot express "first," since it has no notion of a
-- row's position relative to its user's other rows. The ALTER below sets
-- every row (existing and future-inserted-without-an-explicit-value) to
-- 'important' as a safe floor, then a keyed UPDATE promotes exactly the
-- first (lowest position) non-archived domain per user to 'essential'.
-- Nothing is ever backfilled to 'background' -- R10 is explicit that a
-- user who never touches the (not-yet-built) ranking screen must end up
-- with a real, breakable ranking (essential vs important), never a
-- uniform tier the arbiter can't use to break a tie.
--
-- A user with exactly one active domain: that row becomes essential, and
-- there is no "rest" to become important. Stated deliberately, not left to
-- fall out of the query -- this is correct, not an edge case to special-
-- case: "first picks essential" doesn't require a second row to exist.
--
-- Archived domains still get a weight value (the column is NOT NULL) but
-- are never candidates for 'essential' in the backfill below -- their
-- weight is inert (nothing reads an archived row's tier), 'important' is a
-- harmless floor for them same as any row.

begin;

alter table public.user_domains
  add column weight text not null default 'important'
  check (weight in ('essential', 'important', 'background'));

with first_domain as (
  select distinct on (user_id) id
  from public.user_domains
  where archived_at is null
  order by user_id, position asc
)
update public.user_domains
set weight = 'essential'
where id in (select id from first_domain);

commit;
