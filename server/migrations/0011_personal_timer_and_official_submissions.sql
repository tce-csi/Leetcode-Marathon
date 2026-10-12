-- ===========================================================================
-- CodeQuest - Migration 0011: Personal Contest Timer & One Official Submission
-- ===========================================================================
-- 1. Personal timer: students gain a `started_at` column set once, server-side,
--    when the student presses "Start Contest" on their dashboard. It anchors the
--    live dashboard timer and the official elapsed duration used for finisher
--    rankings. It is additive and nullable, so historic rows are untouched.
--
-- 2. One official submission per level: each level accepts exactly one active
--    (non-rejected) submission. `is_official` marks the row that currently
--    "holds the slot" for a (student, level). A partial unique index enforces
--    at most one official row per student/level, while rejected rows stay in
--    the table as attempt history (and free the slot for a fresh attempt).
--    A trigger keeps `is_official` in sync with STATUS, so admin rejections and
--    raw SQL updates never leave a stale lock.
--
-- 3. Backfill: for every (student, level) the most recent non-rejected
--    submission becomes official; older rows are preserved as history.

alter table students
  add column if not exists started_at timestamptz;

alter table coding_submissions
  add column if not exists is_official boolean not null default false;

-- Backfill officiality from existing history: the newest non-rejected
-- submission per (student, level) owns the slot. Rejected-only history stays
-- non-official so the level remains resubmittable.
update coding_submissions cs
   set is_official = true
  from (
    select distinct on (student_id, level_id) id
      from coding_submissions
     where status <> 'REJECTED'
     order by student_id, level_id, created_at desc
  ) newest
 where cs.id = newest.id;

-- At most one official submission per student + level.
create unique index if not exists coding_submissions_official_uk
  on coding_submissions (student_id, level_id)
  where is_official;

-- Stay in sync when status changes after the fact (admin review, raw SQL).
-- A REJECTED status releases the slot; any active status claims it.
create or replace function sync_submission_officiality()
returns trigger
language plpgsql
as $$
begin
  new.is_official := (new.status <> 'REJECTED');
  return new;
end;
$$;

drop trigger if exists coding_submissions_officiality_sync on coding_submissions;

create trigger coding_submissions_officiality_sync
  before insert or update of status
  on coding_submissions
  for each row
  execute function sync_submission_officiality();

-- Speeds up seat/queries scanning in-progress students by their personal timer.
create index if not exists students_started_at_idx
  on students (contest_id, year, started_at)
  where started_at is not null;