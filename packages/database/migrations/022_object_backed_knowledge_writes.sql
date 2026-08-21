-- Finish the v0.1.74 object migration and remove every application-level path
-- that can persist or restore knowledge Markdown through PostgreSQL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM knowledge_page_versions WHERE body_markdown IS NOT NULL) THEN
    IF (SELECT count(*) FROM knowledge_pages)<>1
       OR (SELECT count(*) FROM knowledge_page_versions)<>1
       OR NOT EXISTS (
         SELECT 1 FROM knowledge_page_versions version
         JOIN knowledge_pages page ON page.id=version.page_id
         WHERE page.current_path='agents'
           AND version.actor_subject='context-use-bootstrap'
           AND version.body_markdown IS NOT NULL
       ) THEN
      RAISE EXCEPTION
        'knowledge object migration is incomplete; deploy v0.1.74 before this release'
        USING ERRCODE='55000';
    END IF;

    -- A brand-new database has no storage service available between migrations
    -- 021 and 022. Remove its synthetic bootstrap page without firing deferred
    -- lifecycle triggers; post-migration template installation writes the real
    -- object-backed guide.
    PERFORM set_config('session_replication_role','replica',true);
    DELETE FROM knowledge_page_versions;
    DELETE FROM knowledge_pages WHERE current_path='agents';
    DELETE FROM hypermedia_document_revisions;
    DELETE FROM hypermedia_documents WHERE authority='knowledge';
    DELETE FROM knowledge_page_changes;
    PERFORM setval(pg_get_serial_sequence('knowledge_page_changes','change_sequence'),1,false);
    PERFORM set_config('session_replication_role','origin',true);
  END IF;
END;
$$;

-- Exact application-level archive restore is deliberately unsupported. Keep
-- portable exports and infrastructure backup recovery, but remove the import
-- intents, confirmation path and history-rewriting function.
DELETE FROM confirmation_challenges WHERE intent_kind='knowledge_import';
DROP FUNCTION confirm_knowledge_import_intent(uuid,text,text,text,integer,integer);
DROP FUNCTION restore_knowledge_import(uuid,text,text);

CREATE OR REPLACE FUNCTION issue_confirmation_challenge(
  p_intent_kind confirmation_intent_kind,
  p_intent_id uuid,
  p_challenge text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent_expires_at timestamptz;
  intent_inactive boolean;
BEGIN
  IF p_intent_kind IS NULL OR p_intent_id IS NULL OR p_challenge IS NULL
     OR p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' THEN
    RAISE EXCEPTION 'valid confirmation challenge required' USING ERRCODE='22023';
  END IF;

  DELETE FROM publication_intents WHERE expires_at<=now();
  DELETE FROM knowledge_export_intents WHERE expires_at<=now();
  DELETE FROM page_deletion_intents WHERE expires_at<=now();
  DELETE FROM confirmation_challenges challenge
  WHERE (
    challenge.intent_kind='publication'
    AND NOT EXISTS (SELECT 1 FROM publication_intents intent WHERE intent.id=challenge.intent_id)
  ) OR (
    challenge.intent_kind='knowledge_export'
    AND NOT EXISTS (SELECT 1 FROM knowledge_export_intents intent WHERE intent.id=challenge.intent_id)
  ) OR (
    challenge.intent_kind='page_deletion'
    AND NOT EXISTS (SELECT 1 FROM page_deletion_intents intent WHERE intent.id=challenge.intent_id)
  ) OR challenge.intent_kind='knowledge_import';

  IF p_intent_kind='publication' THEN
    SELECT expires_at,false INTO intent_expires_at,intent_inactive
    FROM publication_intents WHERE id=p_intent_id;
  ELSIF p_intent_kind='knowledge_export' THEN
    SELECT expires_at,confirmed_at IS NOT NULL OR download_started_at IS NOT NULL
    INTO intent_expires_at,intent_inactive
    FROM knowledge_export_intents WHERE id=p_intent_id;
  ELSIF p_intent_kind='page_deletion' THEN
    SELECT expires_at,false INTO intent_expires_at,intent_inactive
    FROM page_deletion_intents WHERE id=p_intent_id;
  ELSE
    RAISE EXCEPTION 'confirmation intent kind is unsupported' USING ERRCODE='22023';
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'confirmation intent not found' USING ERRCODE='P0002'; END IF;
  IF intent_inactive OR intent_expires_at<=now() THEN
    RAISE EXCEPTION 'confirmation intent is inactive' USING ERRCODE='22023';
  END IF;
  INSERT INTO confirmation_challenges(intent_kind,intent_id,challenge)
  VALUES (p_intent_kind,p_intent_id,p_challenge);
END;
$$;

DROP TABLE knowledge_import_intents;
ALTER ROLE context_use_restore_owner RENAME TO context_use_reset_owner;
ALTER ROLE context_use_reset_owner NOLOGIN NOINHERIT;

-- The export format is now always the portable current snapshot. A reset may
-- still require that snapshot to be delivered before irreversible deletion.
ALTER TABLE knowledge_export_intents
  DROP CONSTRAINT knowledge_export_intents_reset_kind,
  DROP COLUMN export_kind;

DROP TRIGGER knowledge_page_versions_register_document_revision
  ON knowledge_page_versions;
DROP FUNCTION register_legacy_knowledge_revision_metadata();
DROP INDEX knowledge_page_versions_legacy_body_queue_idx;

-- Reset receives an already-written immutable guide revision and a derived
-- search vector. It never receives or stores Markdown.
DROP FUNCTION clear_knowledge(uuid,text,text,text,text,text,text,text,text,text);

CREATE FUNCTION clear_knowledge(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_guide_version_id uuid,
  p_guide_object_key text,
  p_guide_size_bytes integer,
  p_guide_content_hash text,
  p_root_title text,
  p_root_summary text,
  p_guide_title text,
  p_guide_summary text,
  p_guide_search_vector tsvector,
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
  removable_directory_id uuid;
  removed jsonb;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'knowledge reset principal required' USING ERRCODE='42501';
  END IF;
  IF p_guide_version_id IS NULL
     OR p_guide_object_key IS DISTINCT FROM
       'documents/private/'||p_guide_version_id::text||'.md'
     OR p_guide_size_bytes NOT BETWEEN 0 AND 4000000
     OR p_guide_content_hash !~ '^[a-f0-9]{64}$'
     OR p_guide_search_vector IS NULL THEN
    RAISE EXCEPTION 'knowledge reset guide object metadata is invalid'
      USING ERRCODE='22023';
  END IF;
  IF p_guide_actor_subject IS NULL
     OR (
       p_guide_actor_subject<>'context-use-bootstrap'
       AND p_guide_actor_subject !~ '^context-use-template/[a-z0-9]+(-[a-z0-9]+)*$'
     ) THEN
    RAISE EXCEPTION 'knowledge reset guide must be authored by a template'
      USING ERRCODE='22023';
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
    RAISE EXCEPTION 'knowledge reset requires the portable snapshot download to finish'
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

  INSERT INTO hypermedia_document_revisions(
    id,document_id,revision_number,body_object_key,body_size_bytes,
    body_content_hash,created_at
  ) VALUES (
    p_guide_version_id,guide_page_id,1,p_guide_object_key,
    p_guide_size_bytes,p_guide_content_hash,now()
  );
  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,summary,commit_message,
    actor_kind,actor_subject,created_at
  ) VALUES (
    p_guide_version_id,guide_page_id,1,'agents',p_guide_title,p_guide_summary,
    p_guide_commit_message,'dashboard',p_guide_actor_subject,now()
  );

  DELETE FROM knowledge_page_changes;
  PERFORM setval(pg_get_serial_sequence('knowledge_page_changes','change_sequence'),1,false);

  UPDATE knowledge_pages
  SET current_version_id=p_guide_version_id,
      published_version_id=NULL,
      public_path=NULL,
      archived_at=NULL,
      created_at=now(),
      updated_at=now(),
      search_vector=p_guide_search_vector
  WHERE id=guide_page_id;

  UPDATE knowledge_export_intents SET reset_completed_at=now() WHERE id=intent.id;
  RETURN removed;
END;
$$;

GRANT SELECT,INSERT ON hypermedia_documents,hypermedia_document_revisions
  TO context_use_reset_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_reset_owner;
ALTER FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,tsvector,text,text
) OWNER TO context_use_reset_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_reset_owner;
REVOKE ALL ON FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,tsvector,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,tsvector,text,text
) TO context_use_dashboard;

-- No committed or transaction-local Markdown remains in PostgreSQL.
ALTER TABLE knowledge_page_versions DROP COLUMN body_markdown;
