-- v0.1.74 wrote and verified every historical knowledge revision before the
-- storage broker became healthy. Refuse to strand a real upgrade that skipped
-- that release. A brand-new database contains only the baseline bootstrap
-- guide; remove it so the post-storage template installer can recreate it
-- through the object boundary.
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

    SET CONSTRAINTS ALL DEFERRED;
    ALTER TABLE knowledge_pages DISABLE TRIGGER knowledge_pages_keep_root_guide;
    ALTER TABLE knowledge_pages DISABLE TRIGGER knowledge_pages_prevent_root_guide_deletion;
    DELETE FROM knowledge_page_versions;
    DELETE FROM knowledge_pages WHERE current_path='agents';
    ALTER TABLE knowledge_pages ENABLE TRIGGER knowledge_pages_keep_root_guide;
    ALTER TABLE knowledge_pages ENABLE TRIGGER knowledge_pages_prevent_root_guide_deletion;
  END IF;
END;
$$;

DROP TRIGGER knowledge_page_versions_register_document_revision
  ON knowledge_page_versions;
DROP FUNCTION register_legacy_knowledge_revision_metadata();
DROP INDEX knowledge_page_versions_legacy_body_queue_idx;

-- Restore and reset are privileged database replacement operations. Their
-- application repositories now prewrite every immutable object before calling
-- the checked SQL boundary. Accept the body only as transaction-local input
-- for the existing restore functions, register its immutable metadata, and
-- erase it in the same statement. No Markdown queue is committed or polled.
CREATE FUNCTION register_object_backed_knowledge_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  INSERT INTO hypermedia_documents(id,authority,created_at,updated_at)
  SELECT page.id,'knowledge',page.created_at,page.updated_at
  FROM knowledge_pages page WHERE page.id=NEW.page_id
  ON CONFLICT (id) DO NOTHING;

  IF NEW.body_markdown IS NOT NULL THEN
    INSERT INTO hypermedia_document_revisions(
      id,document_id,revision_number,body_object_key,body_size_bytes,
      body_content_hash,created_at
    ) VALUES (
      NEW.id,NEW.page_id,NEW.version_number,
      'documents/private/'||NEW.id::text||'.md',octet_length(NEW.body_markdown),
      encode(digest(convert_to(NEW.body_markdown,'UTF8'),'sha256'),'hex'),NEW.created_at
    ) ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM hypermedia_document_revisions revision
      WHERE revision.id=NEW.id
        AND revision.document_id=NEW.page_id
        AND revision.revision_number=NEW.version_number
        AND revision.body_object_key='documents/private/'||NEW.id::text||'.md'
        AND revision.body_size_bytes=octet_length(NEW.body_markdown)
        AND revision.body_content_hash=encode(
          digest(convert_to(NEW.body_markdown,'UTF8'),'sha256'),'hex'
        )
    ) THEN
      RAISE EXCEPTION 'knowledge revision metadata does not match its object'
        USING ERRCODE='23514';
    END IF;

    UPDATE knowledge_page_versions
    SET body_markdown=NULL
    WHERE id=NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER knowledge_page_versions_register_object_revision
AFTER INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION register_object_backed_knowledge_revision();

REVOKE ALL ON FUNCTION register_object_backed_knowledge_revision() FROM PUBLIC;
REVOKE SELECT (body_markdown),UPDATE (body_markdown)
  ON knowledge_page_versions FROM context_use_storage;
REVOKE INSERT (body_markdown)
  ON knowledge_page_versions FROM context_use_dashboard,context_use_mcp;

-- Reset receives an already-written immutable revision from the dashboard and
-- commits only its object metadata with the replacement knowledge transaction.
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
  removable_directory_id uuid;
  removed jsonb;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'knowledge reset principal required' USING ERRCODE='42501';
  END IF;
  IF p_guide_version_id IS NULL
     OR p_guide_object_key IS DISTINCT FROM
       'documents/private/'||p_guide_version_id::text||'.md'
     OR p_guide_size_bytes IS DISTINCT FROM octet_length(p_guide_body)
     OR p_guide_content_hash IS DISTINCT FROM encode(
       digest(convert_to(p_guide_body,'UTF8'),'sha256'),'hex'
     ) THEN
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
    RAISE EXCEPTION 'knowledge export was not authorized to clear knowledge'
      USING ERRCODE='42501';
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
      search_vector=page_search_vector(
        'agents',p_guide_title,p_guide_summary,p_guide_body
      )
  WHERE id=guide_page_id;

  UPDATE knowledge_export_intents SET reset_completed_at=now() WHERE id=intent.id;
  RETURN removed;
END;
$$;

GRANT SELECT,INSERT ON hypermedia_documents,hypermedia_document_revisions
  TO context_use_restore_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_restore_owner;
ALTER FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,text,text,text
) OWNER TO context_use_restore_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_restore_owner;
REVOKE ALL ON FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,text,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_knowledge(
  uuid,text,text,uuid,text,integer,text,text,text,text,text,text,text,text
) TO context_use_dashboard;
