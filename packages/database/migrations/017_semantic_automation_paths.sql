-- Keep the durable UUID as internal ownership metadata while giving every
-- automation a human-readable, immutable knowledge key.
ALTER TABLE cron_schedules ADD COLUMN automation_key text;

DO $$
DECLARE
  schedule record;
  base_key text;
  candidate_key text;
  suffix integer;
BEGIN
  FOR schedule IN
    SELECT id,name FROM cron_schedules ORDER BY created_at,id
  LOOP
    base_key := left(
      coalesce(
        nullif(trim(both '-' from regexp_replace(lower(schedule.name), '[^a-z0-9]+', '-', 'g')), ''),
        'automation'
      ),
      64
    );
    candidate_key := base_key;
    suffix := 2;

    WHILE EXISTS (SELECT 1 FROM cron_schedules WHERE automation_key=candidate_key) LOOP
      candidate_key := left(base_key, 63 - length(suffix::text)) || '-' || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE cron_schedules SET automation_key=candidate_key WHERE id=schedule.id;
  END LOOP;
END;
$$;

ALTER TABLE cron_schedules
  ALTER COLUMN automation_key SET NOT NULL,
  ADD CONSTRAINT cron_schedules_automation_key_format CHECK (
    length(automation_key) BETWEEN 1 AND 64
    AND automation_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  );

CREATE UNIQUE INDEX cron_schedules_automation_key_unique
  ON cron_schedules (automation_key);

-- Reserving the shorter namespace is intentionally explicit. If an ordinary
-- page already occupies it, the owner must move that page before migrating.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM knowledge_pages
    WHERE automation_id IS NULL AND current_path ~ '^automations(/|$)'
  ) THEN
    RAISE EXCEPTION 'ordinary knowledge pages already use the reserved automations path';
  END IF;
END;
$$;

DROP TRIGGER knowledge_page_versions_automation_path ON knowledge_page_versions;
DROP FUNCTION enforce_automation_page_version_path();
ALTER TABLE knowledge_pages DROP CONSTRAINT knowledge_pages_automation_path_boundary;

-- Preserve every existing generated page and version while replacing the
-- UUID-bearing prefix with its owning automation's semantic key.
UPDATE knowledge_page_versions version
SET path = 'automations/' || schedule.automation_key
  || substring(version.path FROM char_length('generated/automations/' || schedule.id::text) + 1)
FROM knowledge_pages page, cron_schedules schedule
WHERE page.id=version.page_id
  AND page.automation_id=schedule.id;

UPDATE knowledge_pages page
SET current_path = 'automations/' || schedule.automation_key
  || substring(page.current_path FROM char_length('generated/automations/' || schedule.id::text) + 1)
FROM cron_schedules schedule
WHERE page.automation_id=schedule.id;

DROP INDEX cron_schedules_knowledge_path_unique;
ALTER TABLE cron_schedules DROP COLUMN knowledge_path;
ALTER TABLE cron_schedules
  ADD COLUMN knowledge_path text
  GENERATED ALWAYS AS ('automations/' || automation_key) STORED;
CREATE UNIQUE INDEX cron_schedules_knowledge_path_unique
  ON cron_schedules (knowledge_path);

CREATE OR REPLACE FUNCTION enforce_automation_page_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  owner_automation_key text;
BEGIN
  IF NEW.automation_id IS NULL THEN
    IF NEW.current_path ~ '^automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT automation_key INTO owner_automation_key
  FROM cron_schedules
  WHERE id=NEW.automation_id;

  IF owner_automation_key IS NULL
     OR NEW.current_path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_pages_automation_path
BEFORE INSERT OR UPDATE OF current_path,automation_id ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION enforce_automation_page_path();

CREATE OR REPLACE FUNCTION enforce_automation_page_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  owner_automation_id uuid;
  owner_automation_key text;
BEGIN
  SELECT page.automation_id,schedule.automation_key
  INTO owner_automation_id,owner_automation_key
  FROM knowledge_pages page
  LEFT JOIN cron_schedules schedule ON schedule.id=page.automation_id
  WHERE page.id=NEW.page_id;

  IF owner_automation_id IS NULL THEN
    IF NEW.path ~ '^automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path'
        USING ERRCODE = '23514';
    END IF;
  ELSIF owner_automation_key IS NULL
     OR NEW.path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_page_versions_automation_path
BEFORE INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION enforce_automation_page_version_path();

CREATE OR REPLACE FUNCTION keep_automation_key_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.automation_key IS DISTINCT FROM OLD.automation_key THEN
    RAISE EXCEPTION 'automation key is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cron_schedules_keep_automation_key
BEFORE UPDATE OF automation_key ON cron_schedules
FOR EACH ROW EXECUTE FUNCTION keep_automation_key_immutable();

REVOKE ALL ON FUNCTION enforce_automation_page_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_version_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_key_immutable() FROM PUBLIC;

GRANT INSERT (automation_key) ON cron_schedules TO context_use_mcp;
