ALTER TABLE cron_schedules ADD COLUMN instructions_page_id uuid;

DO $$
DECLARE
  automation record;
  occupied record;
  replacement_version_id uuid;
  new_instructions_page_id uuid;
  new_instructions_version_id uuid;
  instructions_path text;
BEGIN
  FOR automation IN
    SELECT schedule.id,schedule.name,schedule.automation_key,
      version.instructions_markdown,version.commit_message,
      version.actor_kind,version.actor_subject
    FROM cron_schedules schedule
    JOIN automation_versions version
      ON version.id=schedule.current_version_id
     AND version.automation_id=schedule.id
  LOOP
    instructions_path := 'automations/' || automation.automation_key || '/instructions';

    SELECT page.id,page.current_version_id,current.version_number,current.title,
      current.body_markdown
    INTO occupied
    FROM knowledge_pages page
    JOIN knowledge_page_versions current ON current.id=page.current_version_id
    WHERE page.current_path=instructions_path AND page.archived_at IS NULL;

    IF FOUND THEN
      replacement_version_id := gen_random_uuid();
      INSERT INTO knowledge_page_versions(
        id,page_id,version_number,path,title,body_markdown,
        commit_message,actor_kind,actor_subject
      ) VALUES (
        replacement_version_id,occupied.id,occupied.version_number + 1,
        instructions_path || '-generated-' || occupied.id::text,
        occupied.title,occupied.body_markdown,
        'Move page reserved for automation instructions','dashboard',
        'migration:006-automation-instruction-pages'
      );
      UPDATE knowledge_pages
      SET current_path=instructions_path || '-generated-' || occupied.id::text,
        current_version_id=replacement_version_id,updated_at=now()
      WHERE id=occupied.id;
    END IF;

    new_instructions_page_id := gen_random_uuid();
    new_instructions_version_id := gen_random_uuid();
    INSERT INTO knowledge_pages(
      id,current_path,current_version_id,automation_id
    ) VALUES (
      new_instructions_page_id,instructions_path,new_instructions_version_id,automation.id
    );
    INSERT INTO knowledge_page_versions(
      id,page_id,version_number,path,title,body_markdown,
      commit_message,actor_kind,actor_subject
    ) VALUES (
      new_instructions_version_id,new_instructions_page_id,1,instructions_path,
      automation.name || ' instructions',automation.instructions_markdown,
      automation.commit_message,automation.actor_kind,automation.actor_subject
    );
    UPDATE cron_schedules
    SET instructions_page_id=new_instructions_page_id
    WHERE id=automation.id;
  END LOOP;
END;
$$;

ALTER TABLE cron_schedules
  ALTER COLUMN instructions_page_id SET NOT NULL,
  ADD CONSTRAINT cron_schedules_instructions_page_fk
  FOREIGN KEY (instructions_page_id)
  REFERENCES knowledge_pages(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- Run output remains publishable through the owner's passkey flow. Only the
-- workflow definition itself is permanently private.
CREATE FUNCTION keep_automation_instruction_pages_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.target_kind='page'
     AND NEW.action='publish'
     AND EXISTS (
       SELECT 1 FROM cron_schedules
       WHERE instructions_page_id=NEW.target_id
     ) THEN
    RAISE EXCEPTION 'automation instruction pages cannot be published'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_keep_automation_instructions_private
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION keep_automation_instruction_pages_private();

REVOKE ALL ON FUNCTION keep_automation_instruction_pages_private() FROM PUBLIC;

GRANT INSERT (automation_id) ON knowledge_pages TO context_use_dashboard;
GRANT INSERT (instructions_page_id) ON cron_schedules TO context_use_dashboard;
GRANT INSERT (instructions_page_id) ON cron_schedules TO context_use_mcp;
