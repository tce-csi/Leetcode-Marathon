-- ===========================================================================
-- CodeQuest - Migration 0006: Automatic Finisher Rankings & Finalist Verification
-- ===========================================================================

-- 1. Add finisher timestamps and duration to students table
alter table students
  add column if not exists contest_started_at timestamptz;

alter table students
  add column if not exists finished_at timestamptz;

alter table students
  add column if not exists elapsed_duration_ms bigint;

-- 2. Add finalist status and verification tracking
alter table students
  add column if not exists finalist_status text not null default 'PROVISIONAL';

alter table students
  drop constraint if exists students_finalist_status_check;

alter table students
  add constraint students_finalist_status_check
  check (finalist_status in ('PROVISIONAL', 'UNDER_REVIEW', 'VERIFIED', 'DISQUALIFIED'));

alter table students
  add column if not exists finalist_verified_at timestamptz;

alter table students
  add column if not exists finalist_verified_by uuid references admin_users(id) on delete set null;

alter table students
  add column if not exists finalist_review_notes text;

alter table students
  add column if not exists finalist_disqualification_reason text;

-- 3. Indexes for efficient finisher leaderboards & sorting
create index if not exists students_finisher_rank_idx
  on students (contest_id, year, finished_at asc, elapsed_duration_ms asc)
  where finished_at is not null;

create index if not exists students_finalist_status_idx
  on students (contest_id, year, finalist_status);
