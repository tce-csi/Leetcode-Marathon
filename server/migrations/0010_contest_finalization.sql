-- ===========================================================================
-- CodeQuest - Migration 0010: Explicit contest finalization ("Submit for Review")
-- ===========================================================================
-- Completing every level records `finished_at` automatically so the finisher
-- leaderboard keeps working exactly as before. On top of that, a student may now
-- explicitly submit the whole contest for organiser review. That is a deliberate,
-- one-way action recorded in `finalized_at`: it freezes the attempt (no further
-- submissions or assessments), moves the student into the review queue and sets
-- their finalist status to UNDER_REVIEW. The column is additive and nullable, so
-- existing finishers are never modified and every historic row is preserved.

alter table students
  add column if not exists finalized_at timestamptz;

-- Speeds up the admin "submitted for review" queue (finalized students only).
create index if not exists students_finalized_idx
  on students (contest_id, year, finalized_at)
  where finalized_at is not null;
