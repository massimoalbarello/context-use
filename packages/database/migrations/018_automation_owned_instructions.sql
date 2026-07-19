-- Automations are dispatched work, not discoverable Agent Skills. Preserve the
-- immutable version pinning that runs already rely on while moving instructions
-- under the automation that owns them.
CREATE TABLE automation_versions (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES cron_schedules(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  instructions_markdown text NOT NULL CHECK (
    length(trim(instructions_markdown)) > 0
    AND octet_length(instructions_markdown) <= 4000000
  ),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id, version_number),
  UNIQUE (id, automation_id)
);

-- One automation may have used several skill versions over its run history.
-- Give every distinct pair a private automation version and retain the ordering
-- of the source versions for deterministic audit history.
CREATE TEMP TABLE migrated_automation_versions ON COMMIT DROP AS
WITH pairs AS (
  SELECT id AS automation_id,skill_version_id FROM cron_schedules
  UNION
  SELECT schedule_id AS automation_id,skill_version_id FROM automation_runs
)
SELECT
  pair.automation_id,
  pair.skill_version_id,
  gen_random_uuid() AS automation_version_id,
  row_number() OVER (
    PARTITION BY pair.automation_id
    ORDER BY source.created_at,source.version_number,source.id
  )::integer AS automation_version_number
FROM pairs pair
JOIN automation_skill_versions source ON source.id=pair.skill_version_id;

INSERT INTO automation_versions(
  id,automation_id,version_number,instructions_markdown,commit_message,
  actor_kind,actor_subject,created_at
)
SELECT
  migrated.automation_version_id,migrated.automation_id,migrated.automation_version_number,
  source.instructions_markdown,source.commit_message,source.actor_kind,source.actor_subject,source.created_at
FROM migrated_automation_versions migrated
JOIN automation_skill_versions source ON source.id=migrated.skill_version_id;

ALTER TABLE cron_schedules ADD COLUMN current_version_id uuid;
UPDATE cron_schedules schedule
SET current_version_id=migrated.automation_version_id
FROM migrated_automation_versions migrated
WHERE migrated.automation_id=schedule.id
  AND migrated.skill_version_id=schedule.skill_version_id;
ALTER TABLE cron_schedules
  ALTER COLUMN current_version_id SET NOT NULL,
  ADD CONSTRAINT cron_schedules_current_version_fk
  FOREIGN KEY (current_version_id,id)
  REFERENCES automation_versions(id,automation_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE automation_runs ADD COLUMN automation_version_id uuid;
UPDATE automation_runs run
SET automation_version_id=migrated.automation_version_id
FROM migrated_automation_versions migrated
WHERE migrated.automation_id=run.schedule_id
  AND migrated.skill_version_id=run.skill_version_id;
ALTER TABLE automation_runs
  ALTER COLUMN automation_version_id SET NOT NULL,
  ADD CONSTRAINT automation_runs_automation_version_fk
  FOREIGN KEY (automation_version_id,schedule_id)
  REFERENCES automation_versions(id,automation_id)
  ON DELETE RESTRICT;

-- Definitions that existed to drive active automations leave skill discovery.
-- Immutable skill versions remain available for historical audit and backup.
UPDATE automation_skills skill
SET deleted_at=coalesce(skill.deleted_at,now()),updated_at=now()
WHERE skill.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM cron_schedules schedule
    JOIN automation_skill_versions version ON version.id=schedule.skill_version_id
    WHERE version.skill_id=skill.id AND schedule.deleted_at IS NULL
  );

ALTER TABLE cron_schedules DROP COLUMN skill_version_id;
ALTER TABLE automation_runs DROP COLUMN skill_version_id;

-- The remaining skills are agent-discoverable capabilities. Their names should
-- no longer imply that they are an automation implementation detail.
ALTER TABLE automation_skills RENAME TO agent_skills;
ALTER TABLE automation_skill_versions RENAME TO agent_skill_versions;
ALTER INDEX automation_skills_name_unique RENAME TO agent_skills_name_unique;

REVOKE ALL ON automation_versions FROM PUBLIC;
GRANT SELECT ON automation_versions TO context_use_dashboard,context_use_mcp,context_use_backup;
GRANT INSERT ON automation_versions TO context_use_dashboard;
GRANT INSERT (
  id,automation_id,version_number,instructions_markdown,commit_message,actor_kind,actor_subject
) ON automation_versions TO context_use_mcp;

GRANT INSERT (current_version_id) ON cron_schedules TO context_use_mcp;
GRANT INSERT (automation_version_id) ON automation_runs TO context_use_mcp;
