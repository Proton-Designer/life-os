-- Onboarding backend, Phase 1 (Opus Lead spec, docs/../PHASE-1-SPEC.md,
-- 2026-09-01). The merged platform's top-level domains (Personal Growth /
-- Work / School) and their subdomains (Faith/Self-Mastery/Fitness under
-- Personal Growth; user-created job/business subdomains under Work) are a
-- genuinely new structural concept — nothing in the existing schema
-- represents "which domains has this user turned on, in what order, with
-- which widgets/config." Additive only: no existing table's rows, columns,
-- or constraints are touched. D-005 still binds — this migration never
-- touches the existing `domain` text columns (tasks, schedule_events,
-- checkin_allocations, etc.) or their stored values; "Faith" is a
-- presentation-layer label, `domain='deen'` is untouched everywhere else.
--
-- Same conventions as 048: RLS enabled, one `<table>_own_row` policy using
-- (select auth.uid()), user_id indexed.

create table public.user_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('personal_growth', 'work', 'school')),
  -- Selection order from onboarding (M3: domains are walked in the order
  -- the user picked them).
  position smallint not null,
  -- Archival, never deletion: a user who drops a domain and re-adds it
  -- keeps history. Null = active. The unique index is NOT partial on
  -- archived_at — (user_id, key) is stable for the row's entire lifetime,
  -- which is what makes upsert-keyed-on-(user_id,key) idempotent across
  -- re-submission instead of accumulating duplicate rows every time a
  -- domain is archived and re-selected.
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index user_domains_user_key_unique on public.user_domains (user_id, key);
create index user_domains_user_id_idx on public.user_domains (user_id);
-- Composite-FK target for user_subdomains below — lets Postgres enforce
-- "a subdomain's parent domain belongs to the same user" as a structural
-- invariant. A plain single-column FK on domain_id plus RLS is NOT enough:
-- FK checks run as the table owner and bypass RLS, so a crafted insert with
-- a valid own user_id but someone else's domain_id would otherwise satisfy
-- both constraints (Opus Lead review catch). Low-severity today with one
-- real user, but cheap to close now versus after rows exist and the
-- direction of this whole project (M2/M3) is toward more than one.
create unique index user_domains_user_id_id_unique on public.user_domains (user_id, id);

alter table public.user_domains enable row level security;

create policy "user_domains_own_row"
  on public.user_domains for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table public.user_subdomains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain_id uuid not null,
  -- Fixed 3-value set ('faith' | 'self_mastery' | 'fitness') for Personal
  -- Growth, but genuinely open-ended for Work (M4: user-created job/business
  -- subdomains have no fixed vocabulary) — a CHECK enum here would be
  -- correct for one parent domain and wrong for the other, so it is
  -- deliberately left unconstrained at the DB layer. The
  -- exactly-3-and-minimum-1 Personal Growth rule (M3) is enforced in the
  -- server action, which knows which parent domain it's validating against;
  -- the DB only enforces per-(user,domain) key uniqueness, which holds for
  -- both cases identically.
  key text not null,
  -- Display name — fixed copy for Personal Growth's 3, user-editable for
  -- Work (M4: subdomains are user-named).
  label text not null,
  -- Only meaningful for Work subdomains ("first prompt: business or job?" —
  -- M4). Null for Personal Growth/School subdomains, which have no such
  -- distinction.
  kind text null check (kind in ('job', 'business')),
  -- Selected widget-catalogue ids for this subdomain's screen (Engineer 2's
  -- widget picker writes this; all preselected by default per M4).
  widgets jsonb not null default '[]'::jsonb,
  -- Per-subdomain onboarding answers (location/prayer-calc/madhab for
  -- Faith; per-subdomain questions elsewhere). Deliberately jsonb, not
  -- typed columns — the exact question set per subdomain is UI/content-
  -- owned (Faith here, School by the CollegeOS lead, Self-Mastery by the
  -- ULM lead) and not fully fixed yet. Per-area DEEP configuration still
  -- happens later, in-app (M3) — this is only what's collected at
  -- onboarding time.
  config jsonb not null default '{}'::jsonb,
  position smallint not null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK against user_domains(user_id, id) (backed by the unique
  -- index above), not a plain domain_id -> id FK — see the comment on that
  -- index. This makes cross-user domain_id impossible at the database
  -- level, not just something the action layer has to remember to check.
  constraint user_subdomains_domain_same_user
    foreign key (user_id, domain_id)
    references public.user_domains (user_id, id)
    on delete cascade
);

create unique index user_subdomains_user_domain_key_unique
  on public.user_subdomains (user_id, domain_id, key);
create index user_subdomains_user_id_idx on public.user_subdomains (user_id);
create index user_subdomains_domain_id_idx on public.user_subdomains (domain_id);

alter table public.user_subdomains enable row level security;

create policy "user_subdomains_own_row"
  on public.user_subdomains for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Atomic partial-jsonb-merge for saveSubdomainConfig ("merges into config
-- jsonb; does not clobber unrelated keys" — spec). A plain supabase-js
-- read-then-write from the action layer would work for a single-user app
-- with no concurrent onboarding sessions, but this closes the TOCTOU gap
-- for free and is one statement. `||` on jsonb is a shallow merge, right
-- operand wins on key collision — exactly "merge, don't clobber."
create or replace function public.merge_subdomain_config(p_subdomain_id uuid, p_patch jsonb)
returns public.user_subdomains
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.user_subdomains;
begin
  update public.user_subdomains
  set config = coalesce(config, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
      updated_at = now()
  where id = p_subdomain_id and user_id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'user_subdomains row % not found or not owned by caller', p_subdomain_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.merge_subdomain_config(uuid, jsonb) to authenticated;
