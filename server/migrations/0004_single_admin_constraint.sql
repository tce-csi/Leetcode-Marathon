-- 0004_single_admin_constraint.sql
-- Enforce that exactly one active administrator account can exist in the platform.

-- Partial unique index ensuring that at most one active administrator row can exist at any time.
create unique index if not exists admin_users_single_active_admin_idx
  on admin_users ((true))
  where is_active = true;
