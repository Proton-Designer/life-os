-- Fix (2026-08-24, the Lead's review): recordPlanOutcome's followed:false
-- path previously inserted the outcome row, then re-queried counts, then
-- rejected a missing newPlanBody when mustRewrite tripped — but by then
-- trigger_plan_outcomes_one_per_day already held today's row, so a client
-- retry with the required plan body would itself fail the same unique
-- index. The user could not complete the review for that trigger — and
-- the 3rd skip is exactly the moment this fires. The same atomicity gap
-- existed for followed:true: writing the outcome and superseding the plan
-- were two separate round trips, so a failure between them could leave
-- one written without the other (plan revised, day not recorded as
-- reviewed, or vice versa).
--
-- record_plan_outcome does the outcome insert AND (when required) the
-- plan supersede+insert in one transaction — a PL/pgSQL RAISE EXCEPTION
-- aborts the whole call, rolling the outcome insert back with it, so a
-- rejected submission never leaves partial state to retry against. The
-- forced-rewrite threshold (3 skips, 0 follows) is duplicated here from
-- lib/distractions/plan-rules.ts's FORCED_REWRITE_AFTER_SKIPS/mustRewrite
-- by necessity: only a check made INSIDE this transaction can raise
-- before the outcome row commits.
create or replace function public.record_plan_outcome(
  p_trigger_id uuid,
  p_followed boolean,
  p_date date,
  p_new_plan_body text default null,
  p_reason text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_followed_count int;
  v_skipped_count int;
begin
  select id into v_plan_id
    from public.trigger_action_plans
    where trigger_id = p_trigger_id and superseded_at is null;

  if v_plan_id is null then
    raise exception 'no current plan for trigger %', p_trigger_id;
  end if;

  if p_followed and p_new_plan_body is null then
    raise exception 'newPlanBody is required when followed is true';
  end if;

  insert into public.trigger_plan_outcomes (user_id, trigger_id, plan_id, date, followed)
  values (auth.uid(), p_trigger_id, v_plan_id, p_date, p_followed)
  on conflict (user_id, trigger_id, date)
  do update set followed = excluded.followed, plan_id = excluded.plan_id;

  if p_followed then
    perform public.save_trigger_plan(p_trigger_id, p_new_plan_body, coalesce(p_reason, 'followed_failed'));
    return;
  end if;

  select
    count(*) filter (where followed),
    count(*) filter (where not followed)
    into v_followed_count, v_skipped_count
    from public.trigger_plan_outcomes
    where plan_id = v_plan_id;

  if v_skipped_count >= 3 and v_followed_count = 0 then
    if p_new_plan_body is null then
      raise exception 'newPlanBody is required: this plan has never once survived contact';
    end if;
    perform public.save_trigger_plan(p_trigger_id, p_new_plan_body, coalesce(p_reason, 'never_followed'));
  end if;
end;
$$;

grant execute on function public.record_plan_outcome(uuid, boolean, date, text, text) to authenticated;
