-- ===========================================================================
-- CodeQuest - migration 0002: student LeetCode profile URLs
--
-- Registration previously collected only a LeetCode username. It now collects
-- the full LeetCode **profile URL**. This migration is safe for existing data:
--   1. Adds `leetcode_profile_url` (NOT NULL, default '' so existing rows and
--      legacy inserts keep working) - no data is lost or deleted.
--   2. Backfills the URLs of existing students from their stored username.
--   3. Enforces per-contest uniqueness on the normalized identity. Should a
--      legacy duplicate exist, later registrations are deactivated (kept in
--      the table, is_active = false) so an administrator can resolve it.
-- ===========================================================================

alter table students
  add column if not exists leetcode_profile_url text not null default '';

update students
   set leetcode_profile_url =
         'https://leetcode.com/u/' || leetcode_username || '/'
 where leetcode_profile_url = '';

-- Deactivate duplicate LeetCode identities (keep the earliest registration).
update students a
   set is_active = false
  from students b
 where a.contest_id = b.contest_id
   and a.leetcode_username_normalized = b.leetcode_username_normalized
   and a.created_at > b.created_at;

create unique index if not exists students_leetcode_unique_idx
  on students (contest_id, leetcode_username_normalized);