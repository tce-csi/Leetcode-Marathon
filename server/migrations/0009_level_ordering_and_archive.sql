-- ===========================================================================
-- CodeQuest - Migration 0009: Automatic level numbering & safe archives
-- ===========================================================================
-- Level numbers are an ordering position maintained exclusively by the backend.
-- When a level that already has participant activity is removed we archive it
-- (soft-delete) instead of cascading a destructive delete, so historic
-- submissions, source code, assessment attempts, progress and audit records are
-- preserved. Archived levels are hidden from every active view and are moved
-- out of the live numbering range, which keeps the existing
-- (track_id, level_number) uniqueness constraint fully enforced for all rows.

alter table levels
  add column if not exists archived_at timestamptz;

alter table levels
  add column if not exists archived_by uuid references admin_users(id) on delete set null;

-- Speeds up "list the live levels of a track in official order".
create index if not exists levels_track_live_order_idx
  on levels (track_id, order_index asc, level_number asc)
  where archived_at is null;
