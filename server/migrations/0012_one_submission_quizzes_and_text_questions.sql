-- ===========================================================================
-- CodeQuest - Migration 0012: One-Submission Quizzes & Short Text Answer Type
-- ===========================================================================
-- 1. Short text answer questions: `conceptual_questions` gains optional
--    min/max character bounds. When absent the server defaults apply (1..4000),
--    so the existing SHORT_TEXT rows keep working unchanged.
--
-- 2. One immutable quiz submission per (student, level, phase): mirrors the
--    coding_submissions.is_official pattern from migration 0011. `is_submission`
--    marks the row that permanently holds the submission slot for a
--    (student, level, phase). A partial unique index enforces at most one
--    submission per student/level/phase, while older attempts stay in the table
--    as attempt history. Unlike coding submissions there is no unlock: the
--    submission is final once created, so submission state is permanent.
--
-- 3. Admin review of manually-graded (short text) submissions: `review_note`,
--    `reviewed_by`, `reviewed_at` record textual notes and a review status
--    WITHOUT overwriting the student's original answers.
--
-- 4. Backfill: for every (student, level, phase) the most recently completed
--    attempt (SUBMITTED or GRADED) becomes the submission. Older attempts are
--    preserved as history. Student rows are untouched.

-- Text-answer length bounds (nullable; server defaults 1..4000 when null).
alter table conceptual_questions
  add column if not exists min_length integer,
  add column if not exists max_length integer;

-- Submission slot marker + non-destructive admin review columns.
alter table assessment_attempts
  add column if not exists is_submission boolean not null default false,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references admin_users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Backfill: the newest completed attempt per (student, level, phase) owns the
-- one-submission slot; older completed attempts remain as attempt history.
update assessment_attempts a
   set is_submission = true
  from (
    select distinct on (student_id, level_id, phase) id
      from assessment_attempts
     where status in ('SUBMITTED', 'GRADED')
     order by student_id, level_id, phase,
              coalesce(graded_at, submitted_at, created_at) desc,
              attempt_number desc
  ) newest
 where a.id = newest.id;

-- At most one submission per student + level + phase.
create unique index if not exists assessment_attempts_submission_uk
  on assessment_attempts (student_id, level_id, phase)
  where is_submission;

-- Speeds up per-phase submission lookups and admin review scans.
create index if not exists assessment_attempts_submission_idx
  on assessment_attempts (student_id, level_id, phase, is_submission);