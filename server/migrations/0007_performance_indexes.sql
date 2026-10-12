-- ===========================================================================
-- CodeQuest - Migration 0007: Performance Indexes & Optimization
-- Adds targeted indexes for high concurrency (50-100 participants)
-- ===========================================================================

-- 1. Index for fast student progress lookups by status
create index if not exists student_level_progress_status_idx
  on student_level_progress (student_id, status);

-- 2. Index for fast submission lookups by student and level
create index if not exists coding_submissions_student_level_created_idx
  on coding_submissions (student_id, level_id, created_at desc);

-- 3. Index for levels ordered by track, active status, order index, level number
create index if not exists levels_track_active_order_idx
  on levels (track_id, is_active, order_index asc, level_number asc);

-- 4. Index for score events aggregation by student
create index if not exists score_events_student_contest_points_idx
  on score_events (student_id, contest_id, points);
