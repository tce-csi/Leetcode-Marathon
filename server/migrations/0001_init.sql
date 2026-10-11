-- ===========================================================================
-- CodeQuest - Initial schema
-- Target: Supabase PostgreSQL (compatible with vanilla PostgreSQL 15+)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type admin_role as enum ('SUPER_ADMIN', 'ADMIN', 'REVIEWER');
create type difficulty as enum ('EASY', 'MEDIUM', 'HARD');
create type assessment_mode as enum ('NONE', 'BEFORE', 'AFTER', 'BOTH');
create type question_type as enum ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_TEXT');
create type question_phase as enum ('BEFORE', 'AFTER');
create type attempt_status as enum ('IN_PROGRESS', 'SUBMITTED', 'GRADED');
create type submission_status as enum ('PENDING_REVIEW', 'VERIFIED', 'REJECTED');
create type verification_source as enum ('MANUAL', 'AUTOMATIC');
create type progress_status as enum ('LOCKED', 'UNLOCKED', 'IN_PROGRESS', 'COMPLETED');
create type score_source as enum ('ASSESSMENT', 'SUBMISSION', 'ADMIN_ADJUSTMENT');
create type actor_type as enum ('STUDENT', 'ADMIN', 'SYSTEM');
create type review_decision as enum ('APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ===========================================================================
-- 1. Administrator accounts
-- ===========================================================================
create table admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  password_hash text not null,
  role          admin_role not null default 'ADMIN',
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index admin_users_email_lower_key on admin_users (lower(email));

-- ===========================================================================
-- 2. Contests + ContestSettings
-- ===========================================================================
create table contests (
  id                        uuid primary key default gen_random_uuid(),
  slug                      text not null unique,
  name                      text not null,
  description               text not null default '',
  timezone                  text not null default 'Asia/Kolkata',
  registration_open_at      timestamptz,
  registration_close_at     timestamptz,
  start_at                  timestamptz,
  end_at                    timestamptz,
  grace_period_minutes      integer not null default 0 check (grace_period_minutes >= 0),
  registration_open         boolean not null default true,
  is_active                 boolean not null default true,
  leaderboard_visible       boolean not null default true,
  allow_late_submissions    boolean not null default false,
  allow_admin_override      boolean not null default true,
  require_submission_after_unlock boolean not null default false,
  verification_mode         text not null default 'MANUAL'
                              check (verification_mode in ('MANUAL', 'AUTOMATIC', 'HYBRID')),
  ranking_rule              text not null default 'POINTS_LEVELS_TIME'
                              check (ranking_rule in ('POINTS_LEVELS_TIME', 'LEVELS_POINTS_TIME', 'POINTS_TIME')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table contest_settings (
  id         uuid primary key default gen_random_uuid(),
  contest_id uuid not null references contests(id) on delete cascade,
  key        text not null,
  value      jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, key)
);

-- ===========================================================================
-- 3. Contest tracks (one per year)
-- ===========================================================================
create table contest_tracks (
  id          uuid primary key default gen_random_uuid(),
  contest_id  uuid not null references contests(id) on delete cascade,
  year        integer not null check (year in (1, 2)),
  name        text not null,
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (contest_id, year)
);

-- ===========================================================================
-- 4. Levels (the challenge unit)
-- ===========================================================================
create table levels (
  id                            uuid primary key default gen_random_uuid(),
  track_id                      uuid not null references contest_tracks(id) on delete cascade,
  level_number                  integer not null check (level_number > 0),
  title                         text not null,
  description                   text not null default '',
  difficulty                    difficulty not null default 'EASY',
  points                        integer not null default 10 check (points >= 0),
  order_index                   integer not null default 0,
  is_active                     boolean not null default true,
  is_starting                   boolean not null default false,
  assessment_mode               assessment_mode not null default 'NONE',
  require_assessment_pass       boolean not null default false,
  passing_score                 integer not null default 60 check (passing_score between 0 and 100),
  max_attempts                  integer not null default 3 check (max_attempts >= 1),
  require_verified_submission   boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (track_id, level_number)
);

-- ===========================================================================
-- 5. LeetCode problems (one per level)
-- ===========================================================================
create table leetcode_problems (
  id           uuid primary key default gen_random_uuid(),
  level_id     uuid not null unique references levels(id) on delete cascade,
  title        text not null,
  url          text not null,
  problem_slug text not null,
  difficulty   difficulty not null default 'EASY',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ===========================================================================
-- 6. Conceptual questions + answer options
-- ===========================================================================
create table conceptual_questions (
  id            uuid primary key default gen_random_uuid(),
  level_id      uuid not null references levels(id) on delete cascade,
  question_text text not null,
  question_type question_type not null default 'SINGLE_CHOICE',
  phase         question_phase not null default 'BEFORE',
  order_index   integer not null default 0,
  points        integer not null default 1 check (points >= 0),
  correct_text  text,
  explanation   text not null default '',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table answer_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references conceptual_questions(id) on delete cascade,
  option_text text not null,
  is_correct  boolean not null default false,
  order_index integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- 7. Students
-- ===========================================================================
create table students (
  id                         uuid primary key default gen_random_uuid(),
  contest_id                 uuid not null references contests(id) on delete cascade,
  full_name                  text not null,
  roll_number                text not null,
  normalized_roll_number     text not null,
  year                       integer not null check (year in (1, 2)),
  leetcode_username          text not null,
  leetcode_username_normalized text not null,
  password_hash              text not null,
  is_active                  boolean not null default true,
  last_login_at              timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (contest_id, normalized_roll_number)
);
create index students_year_idx on students (contest_id, year);
create index students_leetcode_idx on students (contest_id, leetcode_username_normalized);

-- ===========================================================================
-- 8. Sessions
-- ===========================================================================
create table student_sessions (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  ip         text,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index student_sessions_student_idx on student_sessions (student_id);

create table admin_sessions (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  ip         text,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index admin_sessions_admin_idx on admin_sessions (admin_id);

-- ===========================================================================
-- 9. Assessment attempts + answers
-- ===========================================================================
create table assessment_attempts (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  level_id       uuid not null references levels(id) on delete cascade,
  phase          question_phase not null,
  attempt_number integer not null default 1 check (attempt_number >= 1),
  status         attempt_status not null default 'IN_PROGRESS',
  score          integer not null default 0,
  max_score      integer not null default 0,
  passed         boolean not null default false,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  graded_at      timestamptz,
  graded_by      uuid references admin_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (student_id, level_id, phase, attempt_number)
);
create index assessment_attempts_student_level_idx on assessment_attempts (student_id, level_id);

create table assessment_answers (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references assessment_attempts(id) on delete cascade,
  question_id         uuid not null references conceptual_questions(id) on delete cascade,
  selected_option_ids uuid[] not null default '{}',
  text_answer         text,
  is_correct          boolean,
  points_awarded      integer not null default 0,
  created_at          timestamptz not null default now(),
  unique (attempt_id, question_id)
);

-- ===========================================================================
-- 10. Coding submissions + reviews
-- ===========================================================================
create table coding_submissions (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id) on delete cascade,
  level_id            uuid not null references levels(id) on delete cascade,
  problem_id          uuid references leetcode_problems(id) on delete set null,
  status              submission_status not null default 'PENDING_REVIEW',
  verification_source verification_source not null default 'MANUAL',
  submission_url      text,
  screenshot_path     text,
  student_note        text,
  problem_slug        text,
  verdict             text,
  reported_solved_at  timestamptz,
  verified_solved_at  timestamptz,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- At most one active (non-rejected) submission per student+level.
create unique index coding_submissions_active_idx
  on coding_submissions (student_id, level_id)
  where status <> 'REJECTED';
create index coding_submissions_status_idx on coding_submissions (status, created_at);

create table submission_reviews (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references coding_submissions(id) on delete cascade,
  reviewer_id   uuid references admin_users(id) on delete set null,
  decision      review_decision not null,
  reason        text not null default '',
  created_at    timestamptz not null default now()
);
create index submission_reviews_submission_idx on submission_reviews (submission_id);

-- ===========================================================================
-- 11. Student level progress
-- ===========================================================================
create table student_level_progress (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  level_id       uuid not null references levels(id) on delete cascade,
  status         progress_status not null default 'LOCKED',
  points_awarded integer not null default 0 check (points_awarded >= 0),
  unlocked_at    timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (student_id, level_id)
);
create index student_level_progress_student_idx on student_level_progress (student_id);

-- ===========================================================================
-- 12. Score events (auditable, idempotent ledger)
-- ===========================================================================
create table score_events (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  contest_id      uuid not null references contests(id) on delete cascade,
  level_id        uuid references levels(id) on delete set null,
  source          score_source not null,
  points          integer not null,
  reason          text not null default '',
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);
create index score_events_student_idx on score_events (student_id);
create index score_events_contest_idx on score_events (contest_id);

-- ===========================================================================
-- 13. Audit logs
-- ===========================================================================
create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_type  actor_type not null,
  actor_id    uuid,
  action      text not null,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_type, actor_id);

-- ===========================================================================
-- 14. Rate limiting (DB-backed so it works across serverless instances)
-- ===========================================================================
create table rate_limits (
  id           uuid primary key default gen_random_uuid(),
  bucket_key   text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (bucket_key, window_start)
);
create index rate_limits_window_idx on rate_limits (window_start);

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
create trigger trg_admin_users_updated      before update on admin_users            for each row execute function set_updated_at();
create trigger trg_contests_updated         before update on contests               for each row execute function set_updated_at();
create trigger trg_contest_settings_updated before update on contest_settings       for each row execute function set_updated_at();
create trigger trg_tracks_updated           before update on contest_tracks         for each row execute function set_updated_at();
create trigger trg_levels_updated           before update on levels                 for each row execute function set_updated_at();
create trigger trg_problems_updated         before update on leetcode_problems      for each row execute function set_updated_at();
create trigger trg_questions_updated        before update on conceptual_questions   for each row execute function set_updated_at();
create trigger trg_students_updated         before update on students               for each row execute function set_updated_at();
create trigger trg_attempts_updated         before update on assessment_attempts    for each row execute function set_updated_at();
create trigger trg_submissions_updated      before update on coding_submissions      for each row execute function set_updated_at();
create trigger trg_progress_updated         before update on student_level_progress  for each row execute function set_updated_at();

-- ===========================================================================
-- Row Level Security
-- The application talks to Postgres through a trusted server-side connection
-- (DATABASE_URL). RLS is enabled as defence-in-depth and anon/authenticated
-- roles are denied by default so that a leaked public key cannot read data.
-- ===========================================================================
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
  end if;
end $$;
