-- ===========================================================================
-- CodeQuest - migration 0003: LeetCode Marathon (Phase 3)
--
-- Adds everything Phase 3 needs without disturbing existing data:
--   1. levels.teaser                - short, non-solution challenge introduction
--   2. students.integrity_accepted_at - contest integrity acknowledgment
--   3. students.identity_verified_*  - optional organiser ownership approval
--   4. conceptual_questions.variant_group - alternate question variants
--   5. suspicious_flags              - lightweight anti-cheating review flags
--
-- All statements are additive; no existing row is deleted or rewritten.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Challenge teasers
-- ---------------------------------------------------------------------------
alter table levels
  add column if not exists teaser text not null default '';

-- ---------------------------------------------------------------------------
-- 2. Integrity acknowledgment
-- ---------------------------------------------------------------------------
alter table students
  add column if not exists integrity_accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Optional LeetCode ownership approval (manual organiser verification)
-- ---------------------------------------------------------------------------
alter table students
  add column if not exists identity_verified_at timestamptz;
alter table students
  add column if not exists identity_verified_by uuid references admin_users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Conceptual question variants
-- Questions sharing a non-null `variant_group` are interchangeable variants of
-- the same question; the server deterministically shows one variant per student.
-- ---------------------------------------------------------------------------
alter table conceptual_questions
  add column if not exists variant_group text;
create index if not exists conceptual_questions_variant_idx
  on conceptual_questions (level_id, phase, variant_group);

-- ---------------------------------------------------------------------------
-- 5. Suspicious activity flags (admin-only, review-oriented, never automatic
--    disqualification)
-- ---------------------------------------------------------------------------
do $$ begin
  create type flag_severity as enum ('LOW', 'MEDIUM', 'HIGH');
exception
  when duplicate_object then null;
end $$;

create table if not exists suspicious_flags (
  id            uuid primary key default gen_random_uuid(),
  contest_id    uuid not null references contests(id) on delete cascade,
  student_id    uuid references students(id) on delete cascade,
  level_id      uuid references levels(id) on delete set null,
  submission_id uuid references coding_submissions(id) on delete cascade,
  kind          text not null,
  severity      flag_severity not null default 'LOW',
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references admin_users(id) on delete set null
);
create index if not exists suspicious_flags_contest_idx
  on suspicious_flags (contest_id, created_at desc);
create index if not exists suspicious_flags_open_idx
  on suspicious_flags (resolved_at) where resolved_at is null;

alter table suspicious_flags enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.suspicious_flags from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.suspicious_flags from authenticated';
  end if;
end $$;
