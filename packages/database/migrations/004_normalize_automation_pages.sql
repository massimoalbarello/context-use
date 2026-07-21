-- Automation output keeps its provenance, but follows the ordinary page
-- lifecycle after creation. The reserved automation tree still prevents
-- unrelated pages from impersonating run output, while an owner or ordinary
-- MCP edit may move generated knowledge elsewhere.

CREATE OR REPLACE FUNCTION enforce_automation_page_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  owner_automation_key text;
BEGIN
  IF NEW.automation_id IS NULL THEN
    IF NEW.current_path ~ '^automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT automation_key INTO owner_automation_key
  FROM cron_schedules
  WHERE id=NEW.automation_id;

  IF owner_automation_key IS NULL THEN
    RAISE EXCEPTION 'automation page has no owning automation'
      USING ERRCODE='23514';
  END IF;

  IF NEW.current_path ~ '^automations(/|$)'
     AND NEW.current_path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_automation_page_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
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
      RAISE EXCEPTION 'reserved automation knowledge path' USING ERRCODE='23514';
    END IF;
  ELSIF owner_automation_key IS NULL THEN
    RAISE EXCEPTION 'automation page has no owning automation'
      USING ERRCODE='23514';
  ELSIF NEW.path ~ '^automations(/|$)'
     AND NEW.path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_intents_keep_automation_pages_private
  ON publication_intents;
DROP FUNCTION IF EXISTS keep_automation_pages_private();

REVOKE ALL ON FUNCTION enforce_automation_page_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_version_path() FROM PUBLIC;
