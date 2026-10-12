-- ===========================================================================
-- CodeQuest - Migration 0005: Student-wise Admin Review, Source Code & Timelines
-- ===========================================================================

-- 1. Drop partial unique index that restricts to 1 non-rejected submission per level.
-- This allows preserving multiple submission attempts per student and level.
drop index if exists coding_submissions_active_idx;

-- 2. Add columns to coding_submissions for multiple attempts, source code & review state
alter table coding_submissions
  add column if not exists attempt_number integer not null default 1;

alter table coding_submissions
  add column if not exists source_code text;

alter table coding_submissions
  add column if not exists programming_language text;

alter table coding_submissions
  add column if not exists code_file_name text;

alter table coding_submissions
  add column if not exists code_requested boolean not null default false;

alter table coding_submissions
  add column if not exists review_state text not null default 'NOT_REVIEWED';

-- 3. Index for efficient querying of multiple attempts per student & level
create index if not exists coding_submissions_student_level_attempt_idx
  on coding_submissions (student_id, level_id, attempt_number);

-- 4. Track when student opens challenge problem on level progress
alter table student_level_progress
  add column if not exists challenge_opened_at timestamptz;

-- 5. Add index on student_level_progress for fast lookup and timeline calculation
create index if not exists student_level_progress_completed_idx
  on student_level_progress (student_id, completed_at);
