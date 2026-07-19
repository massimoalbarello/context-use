-- Dashboard deletion retires definitions without discarding immutable versions,
-- generated knowledge, or run history.
ALTER TABLE automation_skills ADD COLUMN deleted_at timestamptz;
ALTER TABLE cron_schedules ADD COLUMN deleted_at timestamptz;

DROP INDEX automation_skills_name_unique;
CREATE UNIQUE INDEX automation_skills_name_unique
  ON automation_skills (lower(name))
  WHERE deleted_at IS NULL;

DROP INDEX cron_schedules_name_unique;
CREATE UNIQUE INDEX cron_schedules_name_unique
  ON cron_schedules (lower(name))
  WHERE deleted_at IS NULL;

DROP INDEX cron_schedules_due_idx;
CREATE INDEX cron_schedules_due_idx
  ON cron_schedules (next_run_at)
  WHERE enabled AND deleted_at IS NULL;
