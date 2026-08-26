-- Engineer B, item 5 (2026-08-26 night batch 2).
--
-- (1) tasks.task_type widens to Ayman's real 7-type taxonomy (Homework/
-- Assignment, Quiz, Exam, Final/Midterm, Project/Paper, Reminder, Other),
-- replacing 046's placeholder set which never matched his actual request.
-- No rows use the old values in production (confirmed via psql before
-- writing this), so the translation below is a formality tonight, but
-- written as a real mapping rather than a blind drop-and-recreate in case
-- it ever runs against populated data. "Other" gets a free-text label
-- column, constrained to only ever be set alongside task_type = 'other'.
alter table public.tasks add column task_type_other_label text null;

update public.tasks set task_type_other_label = 'Reading' where task_type = 'reading';

update public.tasks
set task_type = case task_type
  when 'assignment' then 'homework_assignment'
  when 'project' then 'project_paper'
  when 'test' then 'exam'
  when 'reading' then 'other'
  else task_type
end
where task_type in ('assignment', 'project', 'test', 'reading');

alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check
  check (task_type in ('homework_assignment', 'quiz', 'exam', 'final_midterm', 'project_paper', 'reminder', 'other'));

alter table public.tasks add constraint tasks_task_type_other_label_check
  check (task_type_other_label is null or task_type = 'other');

-- (2) A task belongs to a CLASS, not to one specific weekly meeting
-- occurrence — pointing at a schedule_events row (046's class_event_id)
-- was always conceptually wrong, and would have made item 6c's "an
-- assessment write also creates its class's task" (R5) messy, forced to
-- pick an arbitrary meeting to attach to. class_event_id is dropped
-- outright, not deprecated in place: it was added earlier THIS SAME NIGHT
-- (046), has zero non-null rows in production (confirmed via psql), and
-- the code that ever read it has never been deployed — an abandoned
-- same-night design, not legacy with real history (Opus Lead ruling;
-- contrast with cancelled_on/class_group_id, kept in place precisely
-- because those DO have that history). Dropping the column also drops its
-- index (tasks_class_event_id_idx, migration 046) — noted here so nobody
-- goes looking for it separately.
alter table public.tasks drop column class_event_id;

alter table public.tasks add column class_id uuid null references public.classes(id) on delete set null;
create index tasks_class_id_idx on public.tasks (class_id) where class_id is not null;

-- (3) Item 4: the Work schedule's edit popup needs a genuinely different
-- axis from anything built tonight — "temporarily for this week or next
-- week" is a TIME CHANGE on one occurrence, not a removal (that's already
-- schedule_event_cancellations) and not a new permanent pattern. Same
-- per-occurrence key shape as the cancellations table (event_id, date),
-- but stores a replacement time instead of an absence. A one-off extra
-- shift (a day with no permanent pattern at all) doesn't need this table —
-- that's already representable as a plain is_recurring=false schedule_events
-- row with its own event_date, which the schema has supported all along.
create table public.schedule_event_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  event_time time not null,
  end_time time null,
  created_at timestamptz not null default now(),
  constraint schedule_event_overrides_unique unique (event_id, date)
);

create index schedule_event_overrides_event_id_idx on public.schedule_event_overrides (event_id);
create index schedule_event_overrides_user_id_idx on public.schedule_event_overrides (user_id);

alter table public.schedule_event_overrides enable row level security;

create policy "schedule_event_overrides_own_row"
  on public.schedule_event_overrides for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
