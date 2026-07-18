-- Bring persisted skills in line with the Agent Skills SKILL.md discovery contract.
ALTER TABLE automation_skill_versions ADD COLUMN description text;

UPDATE automation_skill_versions version
SET description = left(
  'Use when an agent needs to perform the ' || skill.name || ' workflow.',
  1024
)
FROM automation_skills skill
WHERE skill.id = version.skill_id;

ALTER TABLE automation_skill_versions
  ALTER COLUMN description SET NOT NULL,
  ADD CONSTRAINT automation_skill_versions_description_format CHECK (
    length(trim(description)) BETWEEN 1 AND 1024
  );

-- Existing display-style names receive a deterministic standard-compliant name.
UPDATE automation_skills
SET name = left(
  coalesce(
    nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
    'skill'
  ),
  55
) || '-' || left(id::text, 8)
WHERE name !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   OR length(name) > 64;

ALTER TABLE automation_skills
  ADD CONSTRAINT automation_skills_standard_name CHECK (
    length(name) BETWEEN 1 AND 64
    AND name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  );

-- Every automation owns a stable virtual folder, independent of its editable name.
ALTER TABLE cron_schedules
  ADD COLUMN knowledge_path text
  GENERATED ALWAYS AS ('generated/automations/' || id::text) STORED;

CREATE UNIQUE INDEX cron_schedules_knowledge_path_unique ON cron_schedules (knowledge_path);

-- Automation-generated pages carry explicit ownership and cannot escape that folder.
ALTER TABLE knowledge_pages
  ADD COLUMN automation_id uuid REFERENCES cron_schedules(id) ON DELETE RESTRICT,
  ADD CONSTRAINT knowledge_pages_automation_path_boundary CHECK (
    (
      automation_id IS NULL
      AND current_path !~ '^generated/automations(/|$)'
    )
    OR
    (
      automation_id IS NOT NULL
      AND current_path LIKE ('generated/automations/' || automation_id::text || '/%')
    )
  );

CREATE INDEX knowledge_pages_automation_idx
  ON knowledge_pages (automation_id, current_path)
  WHERE automation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_automation_page_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  owner_automation_id uuid;
BEGIN
  SELECT automation_id INTO owner_automation_id
  FROM knowledge_pages
  WHERE id = NEW.page_id;

  IF owner_automation_id IS NULL THEN
    IF NEW.path ~ '^generated/automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.path NOT LIKE ('generated/automations/' || owner_automation_id::text || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_page_versions_automation_path
BEFORE INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION enforce_automation_page_version_path();

CREATE OR REPLACE FUNCTION keep_automation_pages_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.target_kind = 'page'
     AND NEW.action IN ('publish', 'republish')
     AND EXISTS (
       SELECT 1 FROM knowledge_pages
       WHERE id = NEW.target_id AND automation_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'automation-generated pages cannot be published'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_keep_automation_pages_private
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION keep_automation_pages_private();

REVOKE ALL ON FUNCTION enforce_automation_page_version_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_pages_private() FROM PUBLIC;

GRANT INSERT (description) ON automation_skill_versions TO context_use_mcp;
GRANT INSERT (automation_id) ON knowledge_pages TO context_use_mcp;
