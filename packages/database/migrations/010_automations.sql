CREATE TABLE automation_skills (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  current_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX automation_skills_name_unique ON automation_skills (lower(name));

CREATE TABLE automation_skill_versions (
  id uuid PRIMARY KEY,
  skill_id uuid NOT NULL REFERENCES automation_skills(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  instructions_markdown text NOT NULL CHECK (
    length(trim(instructions_markdown)) > 0
    AND octet_length(instructions_markdown) <= 4000000
  ),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version_number),
  UNIQUE (id, skill_id)
);

ALTER TABLE automation_skills
  ADD CONSTRAINT automation_skills_current_version_fk
  FOREIGN KEY (current_version_id, id)
  REFERENCES automation_skill_versions(id, skill_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE cron_schedules (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  skill_version_id uuid NOT NULL REFERENCES automation_skill_versions(id) ON DELETE RESTRICT,
  cron_expression text NOT NULL CHECK (length(trim(cron_expression)) BETWEEN 9 AND 160),
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cron_schedules_name_unique ON cron_schedules (lower(name));
CREATE INDEX cron_schedules_due_idx ON cron_schedules (next_run_at) WHERE enabled;

CREATE TABLE automation_runs (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES cron_schedules(id) ON DELETE RESTRICT,
  skill_version_id uuid NOT NULL REFERENCES automation_skill_versions(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'claimed', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_by text,
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  result_summary text CHECK (result_summary IS NULL OR length(result_summary) <= 10000),
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_for),
  CONSTRAINT automation_runs_claim_fields CHECK (
    (status = 'ready' AND claimed_by IS NULL AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL)
    OR (status = 'claimed' AND claimed_by IS NOT NULL AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded', 'failed') AND claimed_by IS NOT NULL AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX automation_runs_claim_idx ON automation_runs (scheduled_for)
  WHERE status IN ('ready', 'claimed');
CREATE INDEX automation_runs_recent_idx ON automation_runs (scheduled_for DESC);

REVOKE ALL ON automation_skills, automation_skill_versions, cron_schedules, automation_runs FROM PUBLIC;

GRANT SELECT ON automation_skills, automation_skill_versions, cron_schedules, automation_runs TO context_use_dashboard;
GRANT INSERT, UPDATE ON automation_skills, cron_schedules TO context_use_dashboard;
GRANT INSERT ON automation_skill_versions TO context_use_dashboard;
GRANT INSERT (id,schedule_id,skill_version_id,scheduled_for,input) ON automation_runs TO context_use_dashboard;

GRANT SELECT ON automation_skills, automation_skill_versions, cron_schedules, automation_runs TO context_use_mcp;
GRANT UPDATE (next_run_at,updated_at) ON cron_schedules TO context_use_mcp;
GRANT INSERT (id,schedule_id,skill_version_id,scheduled_for,input) ON automation_runs TO context_use_mcp;
GRANT UPDATE (
  status,attempt_count,claimed_by,claim_token,claimed_at,lease_expires_at,completed_at,result_summary,error_message
) ON automation_runs TO context_use_mcp;
GRANT SELECT ON automation_skills, automation_skill_versions, cron_schedules, automation_runs
  TO context_use_backup;
