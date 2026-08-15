-- Clearing the knowledge base is irreversible, so it is bound to the restorable
-- export that must precede it rather than being a standalone action. One passkey
-- confirmation authorizes the pair, and the clear stays refused until the
-- archive that export produced has been delivered to the owner in full.
ALTER TABLE knowledge_export_intents
  ADD COLUMN reset_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN download_completed_at timestamptz,
  ADD COLUMN reset_completed_at timestamptz;

ALTER TABLE knowledge_export_intents
  ADD CONSTRAINT knowledge_export_intents_reset_kind CHECK (
    NOT reset_requested OR export_kind='restorable'
  ),
  ADD CONSTRAINT knowledge_export_intents_download_completion CHECK (
    download_completed_at IS NULL OR download_started_at IS NOT NULL
  ),
  ADD CONSTRAINT knowledge_export_intents_reset_completion CHECK (
    reset_completed_at IS NULL OR (reset_requested AND download_completed_at IS NOT NULL)
  );

-- Only the isolated confirmation service may record delivery, for the same
-- reason it is the only writer of the confirmation and download-claim marks.
CREATE FUNCTION complete_knowledge_export_download(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent record;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'export principal required' USING ERRCODE='42501';
  END IF;

  SELECT
    id,owner_user_id,session_id,expires_at,confirmed_at,
    download_started_at,download_completed_at
  INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge export intent not found' USING ERRCODE='P0002';
  END IF;
  IF intent.confirmed_at IS NULL OR intent.download_started_at IS NULL THEN
    RAISE EXCEPTION 'knowledge export download was never claimed' USING ERRCODE='42501';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge export intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge export principal mismatch' USING ERRCODE='42501';
  END IF;

  UPDATE knowledge_export_intents
  SET download_completed_at=coalesce(download_completed_at,now())
  WHERE id=p_intent_id;
END;
$$;

-- Clearing reuses the restore boundary rather than widening the dashboard role:
-- both operations replace private knowledge wholesale and neither may touch
-- authentication, integrations, or the registered passkeys.
CREATE FUNCTION clear_knowledge(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_root_title text,
  p_root_summary text,
  p_guide_title text,
  p_guide_summary text,
  p_guide_body text,
  p_guide_commit_message text,
  p_guide_actor_subject text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent record;
  guide_page_id uuid;
  guide_version_id uuid := gen_random_uuid();
  removable_directory_id uuid;
  removed jsonb;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'knowledge reset principal required' USING ERRCODE='42501';
  END IF;
  -- The surviving root guide is what makes the cleared instance importable
  -- again, so its authorship must stay attributable to a template.
  IF p_guide_actor_subject IS NULL
     OR (
       p_guide_actor_subject<>'context-use-bootstrap'
       AND p_guide_actor_subject !~ '^context-use-template/[a-z0-9]+(-[a-z0-9]+)*$'
     ) THEN
    RAISE EXCEPTION 'knowledge reset guide must be authored by a template' USING ERRCODE='22023';
  END IF;

  SELECT
    id,owner_user_id,session_id,expires_at,confirmed_at,
    reset_requested,download_completed_at,reset_completed_at
  INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge reset intent not found' USING ERRCODE='P0002';
  END IF;
  IF NOT intent.reset_requested THEN
    RAISE EXCEPTION 'knowledge export was not authorized to clear knowledge' USING ERRCODE='42501';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge reset principal mismatch' USING ERRCODE='42501';
  END IF;
  IF intent.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'knowledge reset passkey confirmation required' USING ERRCODE='42501';
  END IF;
  IF intent.download_completed_at IS NULL THEN
    RAISE EXCEPTION 'knowledge reset requires the restorable archive download to finish'
      USING ERRCODE='55000';
  END IF;
  IF intent.reset_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge reset intent already used' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge reset intent expired' USING ERRCODE='22023';
  END IF;

  LOCK TABLE knowledge_directories,knowledge_pages,knowledge_page_versions,
    assets,knowledge_asset_links,knowledge_page_changes IN ACCESS EXCLUSIVE MODE;

  SELECT id INTO guide_page_id FROM knowledge_pages WHERE current_path='agents';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'root AGENTS.md page is missing' USING ERRCODE='P0002';
  END IF;

  removed := jsonb_build_object(
    'directories',(SELECT count(*) FROM knowledge_directories),
    'pages',(SELECT count(*) FROM knowledge_pages),
    'page_versions',(SELECT count(*) FROM knowledge_page_versions),
    'assets',(SELECT count(*) FROM assets),
    'asset_links',(SELECT count(*) FROM knowledge_asset_links),
    'page_changes',(SELECT count(*) FROM knowledge_page_changes)
  );

  SET CONSTRAINTS ALL DEFERRED;

  DELETE FROM publication_intents;
  DELETE FROM page_deletion_intents;
  DELETE FROM knowledge_asset_links;
  DELETE FROM knowledge_page_versions;
  -- The root guide row is protected by trigger and is reused rather than
  -- recreated, keeping get_knowledge_base_guide answerable throughout.
  DELETE FROM knowledge_pages WHERE current_path<>'agents';
  DELETE FROM assets;
  FOR removable_directory_id IN
    SELECT id FROM knowledge_directories
    WHERE current_path<>''
    ORDER BY length(current_path) DESC,current_path DESC
  LOOP
    DELETE FROM knowledge_directories WHERE id=removable_directory_id;
  END LOOP;

  UPDATE knowledge_directories
  SET version_number=1,
      title=p_root_title,
      summary=p_root_summary,
      search_vector=directory_search_vector('',p_root_title,p_root_summary,''),
      updated_at=now()
  WHERE current_path='';

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,summary,body_markdown,commit_message,
    actor_kind,actor_subject,created_at
  ) VALUES (
    guide_version_id,guide_page_id,1,'agents',p_guide_title,p_guide_summary,
    p_guide_body,p_guide_commit_message,'dashboard',p_guide_actor_subject,now()
  );

  -- Discard the retained ledger, including the tombstones the deletions above
  -- just wrote, before the projection trigger records the one surviving page.
  DELETE FROM knowledge_page_changes;
  PERFORM setval(pg_get_serial_sequence('knowledge_page_changes','change_sequence'),1,false);

  UPDATE knowledge_pages
  SET current_version_id=guide_version_id,
      published_version_id=NULL,
      public_path=NULL,
      archived_at=NULL,
      created_at=now(),
      updated_at=now(),
      search_vector=page_search_vector('agents',p_guide_title,p_guide_summary,p_guide_body)
  WHERE id=guide_page_id;

  UPDATE knowledge_export_intents SET reset_completed_at=now() WHERE id=intent.id;
  RETURN removed;
END;
$$;

GRANT INSERT (reset_requested) ON knowledge_export_intents TO context_use_dashboard;
GRANT SELECT (reset_requested,download_completed_at,reset_completed_at)
  ON knowledge_export_intents TO context_use_dashboard,context_use_backup;
GRANT SELECT (download_completed_at) ON knowledge_export_intents
  TO context_use_confirmation,context_use_boundary_owner;
GRANT UPDATE (download_completed_at) ON knowledge_export_intents
  TO context_use_boundary_owner;
GRANT SELECT (
  id,owner_user_id,session_id,expires_at,confirmed_at,
  reset_requested,download_completed_at,reset_completed_at
) ON knowledge_export_intents TO context_use_restore_owner;
GRANT UPDATE (reset_completed_at) ON knowledge_export_intents TO context_use_restore_owner;

GRANT CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION complete_knowledge_export_download(uuid,text,text)
  OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

GRANT USAGE,CREATE ON SCHEMA public TO context_use_restore_owner;
ALTER FUNCTION clear_knowledge(uuid,text,text,text,text,text,text,text,text,text)
  OWNER TO context_use_restore_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_restore_owner;

REVOKE ALL ON FUNCTION complete_knowledge_export_download(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_knowledge(uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_knowledge_export_download(uuid,text,text)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION clear_knowledge(uuid,text,text,text,text,text,text,text,text,text)
  TO context_use_dashboard;
