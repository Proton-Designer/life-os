-- LLM gateway (Phase 1 item #1/#2): the usage log every gateway call writes
-- to, and the data source the spend cap (lib/ai/spend-cap.ts) reads from.
--
-- WHY THIS SHAPE (2026-09-13, E1)
--
-- NEVER RAW PROMPT TEXT. `prompt_hash` is a sha256 hex digest of the request
-- content, nothing else -- prompts can and do carry user content (a typed
-- retrieval answer, book excerpts), and this table is otherwise exactly the
-- kind of place that content would leak into if anyone ever added "just log
-- the prompt for debugging." The hash is enough to notice "the same prompt
-- was sent twice" (e.g. for cache-hit-rate analysis) without ever being able
-- to reconstruct what was actually asked.
--
-- reasoning_tokens IS ITS OWN COLUMN, NOT FOLDED INTO completion_tokens
-- (Boss ruling, DeepSeek task): DeepSeek's reasoning models bill hidden
-- chain-of-thought as ordinary output tokens, so cost-per-USEFUL-token is
-- far worse than completion_tokens alone suggests. completion_tokens is the
-- BILLED total (matches what cost_usd was actually computed from);
-- reasoning_tokens is the reporting sub-count, always <= completion_tokens.
--
-- key_source is what the spend cap actually gates on: 'server' rows are
-- calls that drew on the ONE shared, operator-funded DeepSeek balance
-- ($1.98 total at the time this was built) -- 'user' rows are a BYO key,
-- the user's own money, logged for observability only and never capped by
-- us. See lib/ai/resolve-key.ts's `resolveApiKeyWithSource`.
--
-- APPEND-ONLY, SELECT-OWN, NO OTHER POLICY -- same shape as mcp_audit_log
-- (130): a usage log a subject can edit or a stranger can read in aggregate
-- is not a trustworthy cost record. Writes are service-role only
-- (lib/supabase/service-role.ts), same posture as that table, because the
-- spend cap's cross-user 'server' total is a reduction over EVERY user's
-- rows -- a client scoped to one user's own RLS view structurally cannot
-- compute it, and a SELECT-only-own-rows policy is exactly the same
-- constraint check-fk-tenancy.sh and check-rls.sh's own header describes for
-- audit logs: the guarantee only holds if nothing but the service role can
-- write it.

create table public.ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Free text, not a CHECK-constrained enum: new features will name new
  -- values faster than a migration could keep a value-set in sync, and this
  -- table's job is observability, not referential integrity over feature
  -- names. (Flagged here so check-enum-drift.sh's catalog scan does not
  -- report this as an unmapped CHECK later -- there is deliberately no CHECK
  -- to map.)
  feature text not null,
  provider text not null default 'deepseek',
  model text not null,
  key_source text not null check (key_source in ('user', 'server')),
  prompt_hash text not null,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric(12, 8) not null default 0,
  succeeded boolean not null,
  retry_count smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint ai_usage_log_cached_le_input check (cached_input_tokens <= input_tokens),
  constraint ai_usage_log_reasoning_le_completion check (reasoning_tokens <= completion_tokens)
);

create index ai_usage_log_user_id_idx on public.ai_usage_log (user_id);
create index ai_usage_log_created_at_idx on public.ai_usage_log (created_at);
-- The spend cap's hot query: sum(cost_usd) where key_source='server', over
-- all time (the $1.98 balance does not replenish on a schedule, so there is
-- no date-scoped window to index for today's version of this check).
create index ai_usage_log_key_source_idx on public.ai_usage_log (key_source) where key_source = 'server';

alter table public.ai_usage_log enable row level security;

create policy "ai_usage_log_select_own"
  on public.ai_usage_log for select
  using (user_id = (select auth.uid()));

-- Deliberately NO insert/update/delete policy for any non-service role --
-- same posture as mcp_audit_log (130). Writes go through
-- lib/supabase/service-role.ts from lib/ai/usage-log.ts only.
