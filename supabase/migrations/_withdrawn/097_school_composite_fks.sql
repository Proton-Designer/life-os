-- CollegeOS School merge: convert the question-bank FKs to composite, ownership-carrying
-- form. Defence-in-depth, following 058's precedent and prompted by the cross-tenant
-- squat ULM's engineer proved against `sources.class_id` on 2026-09-01.
--
-- THE SHAPE OF THE BUG THIS FORECLOSES:
-- FK checks bypass RLS. A single-column `class_id references classes(id)` therefore
-- verifies only that the class EXISTS, never that the caller owns it -- so user A can
-- insert a row of their own pointing at user B's class, and the RLS policy allows it
-- because the policy only checks the row's own `user_id`.
--
-- WHY THIS IS AN INTEGRITY GAP HERE AND WAS A DENIAL OF SERVICE THERE:
-- `sources` carried a unique index on `class_id` that was not user-scoped, which turned
-- "A wrote a row" into "B is permanently locked out of their own course, sees zero rows,
-- cannot delete what they cannot see, and gets no error explaining why." Neither
-- `questions` nor `attempts` has any uniqueness beyond its primary key -- verified in
-- both `pg_constraint` AND `pg_indexes`, because a unique INDEX is an equally valid FK
-- target and checking only constraints is how 058's existing index got missed once
-- already. So there is no squat available and nothing of B's can be blocked.
--
-- Fixed anyway. The stated posture is defence-in-depth on a database that is
-- single-tenant today, and a gap whose only protection is "there is one user" stops
-- being protected the moment that changes -- silently, with no error, and with a victim
-- who cannot diagnose it.
--
-- WHY A CONSTRAINT AND NOT A TRIGGER:
-- The obvious alternative -- a BEFORE INSERT trigger checking ownership -- is the
-- inert-guard shape ULM found this morning. It runs as the invoking user, so its lookup
-- is subject to that user's RLS: reading B's class returns NULL, and `if owner <>
-- new.user_id` is NULL rather than TRUE, so the guard never fires against the exact
-- attack it exists to stop, while passing review looking correct. The same RLS bypass
-- that makes the single-column FK exploitable is what makes the composite FK airtight:
-- the bypass stops being the bug and becomes the mechanism.
--
-- COLUMN ORDER IS (user_id, id), NOT (id, user_id) -- it must match the existing index
-- `classes_user_id_id_key` created by 058:65. The reversed pair is a different index and
-- nothing covers it.

-- questions -> classes, carrying ownership.
alter table public.questions
  drop constraint questions_class_id_fkey;

alter table public.questions
  add constraint questions_class_id_fkey
  foreign key (user_id, class_id) references public.classes(user_id, id) on delete cascade;

-- attempts -> questions needs its own composite target first. Unique on (user_id, id) is
-- redundant with the primary key -- `id` is already unique, so the pair trivially is --
-- and exists solely to be referencable. Same trick 058 used on `classes`.
create unique index questions_user_id_id_key
  on public.questions (user_id, id);

alter table public.attempts
  drop constraint attempts_question_id_fkey;

alter table public.attempts
  add constraint attempts_question_id_fkey
  foreign key (user_id, question_id) references public.questions(user_id, id) on delete cascade;

comment on constraint questions_class_id_fkey on public.questions is
  'Composite: a question can only reference a class the same user owns. FK checks bypass RLS, so ownership must be part of the referenced key.';
comment on constraint attempts_question_id_fkey on public.attempts is
  'Composite: an attempt can only reference a question the same user owns. See 097 header.';
