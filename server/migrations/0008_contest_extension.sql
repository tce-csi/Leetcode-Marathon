-- ===========================================================================
-- CodeQuest - Migration 0008: Contest Extension Support
-- Preserves previous completion timestamps when contest is extended
-- ===========================================================================

alter table students
  add column if not exists previous_finished_at timestamptz;

alter table students
  add column if not exists previous_elapsed_duration_ms bigint;

create index if not exists students_previous_finish_idx
  on students (contest_id, previous_finished_at)
  where previous_finished_at is not null;
