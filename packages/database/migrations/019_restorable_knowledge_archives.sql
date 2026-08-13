ALTER TABLE knowledge_export_intents
  ADD COLUMN export_kind text NOT NULL DEFAULT 'portable'
  CHECK (export_kind IN ('portable','restorable'));

-- Full replacement needs broad private-table rights, but the existing boundary
-- owner intentionally remains metadata-only. Isolate restore ownership in a
-- separate non-login, non-inheritable role exposed through one checked function.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='context_use_restore_owner') THEN
    CREATE ROLE context_use_restore_owner NOLOGIN NOINHERIT;
  END IF;
END;
$$;
ALTER ROLE context_use_restore_owner NOLOGIN NOINHERIT;

CREATE TABLE knowledge_import_intents (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL CHECK (owner_user_id='context-use-owner'),
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
  archive jsonb NOT NULL CHECK (jsonb_typeof(archive)='object'),
  archive_sha256 text NOT NULL CHECK (archive_sha256 ~ '^[a-f0-9]{64}$'),
  active_asset_count integer NOT NULL CHECK (active_asset_count>=0),
  total_asset_bytes bigint NOT NULL CHECK (total_asset_bytes>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  CONSTRAINT knowledge_import_intents_expiry CHECK (
    expires_at>created_at
    AND (
      (confirmed_at IS NULL AND expires_at<=created_at+interval '15 minutes')
      OR
      (confirmed_at IS NOT NULL AND expires_at<=confirmed_at+interval '24 hours')
    )
  ),
  CONSTRAINT knowledge_import_intents_consumption CHECK (
    consumed_at IS NULL OR confirmed_at IS NOT NULL
  )
);
CREATE INDEX knowledge_import_intents_expiry_idx
  ON knowledge_import_intents(expires_at);

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
    challenge.intent_kind='knowledge_import'
    AND NOT EXISTS (SELECT 1 FROM knowledge_import_intents intent WHERE intent.id=challenge.intent_id)
  ) OR (
    challenge.intent_kind='page_deletion'
    AND NOT EXISTS (SELECT 1 FROM page_deletion_intents intent WHERE intent.id=challenge.intent_id)
  );

  IF p_intent_kind='publication' THEN
    SELECT expires_at,false INTO intent_expires_at,intent_inactive
    FROM publication_intents WHERE id=p_intent_id;
  ELSIF p_intent_kind='knowledge_export' THEN
    SELECT expires_at,confirmed_at IS NOT NULL OR download_started_at IS NOT NULL
    INTO intent_expires_at,intent_inactive
    FROM knowledge_export_intents WHERE id=p_intent_id;
  ELSIF p_intent_kind='knowledge_import' THEN
    SELECT expires_at,confirmed_at IS NOT NULL OR consumed_at IS NOT NULL
    INTO intent_expires_at,intent_inactive
    FROM knowledge_import_intents WHERE id=p_intent_id;
  ELSE
    SELECT expires_at,false INTO intent_expires_at,intent_inactive
    FROM page_deletion_intents WHERE id=p_intent_id;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'confirmation intent not found' USING ERRCODE='P0002'; END IF;
  IF intent_inactive OR intent_expires_at<=now() THEN
    RAISE EXCEPTION 'confirmation intent is inactive' USING ERRCODE='22023';
  END IF;
  INSERT INTO confirmation_challenges(intent_kind,intent_id,challenge)
  VALUES (p_intent_kind,p_intent_id,p_challenge);
END;
$$;

CREATE FUNCTION confirm_knowledge_import_intent(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_credential_id text,
  p_expected_counter integer,
  p_new_counter integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent record;
  intent_challenge text;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified import principal required' USING ERRCODE='42501';
  END IF;

  SELECT id,owner_user_id,session_id,expires_at,confirmed_at,consumed_at
  INTO intent
  FROM knowledge_import_intents
  WHERE id=p_intent_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge import intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.confirmed_at IS NOT NULL OR intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge import intent already used' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge import intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge import principal mismatch' USING ERRCODE='42501';
  END IF;
  SELECT challenge INTO intent_challenge
  FROM confirmation_challenges
  WHERE intent_kind='knowledge_import' AND intent_id=intent.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge import challenge not issued' USING ERRCODE='42501';
  END IF;

  PERFORM consume_confirmation_challenge(
    'knowledge_import',intent.id,intent_challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  UPDATE knowledge_import_intents
  SET confirmed_at=now(),expires_at=now()+interval '24 hours'
  WHERE id=p_intent_id;
END;
$$;

CREATE FUNCTION restore_knowledge_import(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent record;
  source_root jsonb;
  source_agents jsonb;
  maximum_change_sequence bigint;
  removable_directory_id uuid;
  result jsonb;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'knowledge import principal required' USING ERRCODE='42501';
  END IF;

  SELECT id,owner_user_id,session_id,archive,expires_at,confirmed_at,consumed_at
  INTO intent
  FROM knowledge_import_intents
  WHERE id=p_intent_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge import intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'knowledge import passkey confirmation required' USING ERRCODE='42501';
  END IF;
  IF intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge import intent already used' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge import intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge import principal mismatch' USING ERRCODE='42501';
  END IF;

  IF jsonb_typeof(intent.archive->'directories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(intent.archive->'pages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(intent.archive->'page_versions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(intent.archive->'assets') IS DISTINCT FROM 'array'
     OR jsonb_typeof(intent.archive->'asset_links') IS DISTINCT FROM 'array'
     OR jsonb_typeof(intent.archive->'page_changes') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'knowledge archive record sets are invalid' USING ERRCODE='22023';
  END IF;

  SELECT value INTO source_root
  FROM jsonb_array_elements(intent.archive->'directories')
  WHERE value->>'current_path'='';
  IF NOT FOUND OR (
    SELECT count(*) FROM jsonb_array_elements(intent.archive->'directories') value
    WHERE value->>'current_path'=''
  )<>1 THEN
    RAISE EXCEPTION 'knowledge archive root directory is invalid' USING ERRCODE='22023';
  END IF;

  SELECT value INTO source_agents
  FROM jsonb_array_elements(intent.archive->'pages')
  WHERE value->>'current_path'='agents' AND value->>'archived_at' IS NULL;
  IF NOT FOUND OR (
    SELECT count(*) FROM jsonb_array_elements(intent.archive->'pages') value
    WHERE value->>'current_path'='agents'
  )<>1 THEN
    RAISE EXCEPTION 'knowledge archive root guide is invalid' USING ERRCODE='22023';
  END IF;

  LOCK TABLE knowledge_directories,knowledge_pages,knowledge_page_versions,
    assets,knowledge_asset_links,knowledge_page_changes IN ACCESS EXCLUSIVE MODE;

  -- Imports replace knowledge only on an untouched installation. Authentication,
  -- integrations, and the registered passkey remain outside this boundary.
  IF EXISTS (SELECT 1 FROM assets) OR EXISTS (
    SELECT 1 FROM knowledge_page_versions
    WHERE actor_subject<>'context-use-bootstrap'
      AND actor_subject NOT LIKE 'context-use-template/%'
  ) OR EXISTS (
    SELECT 1 FROM knowledge_page_changes
    WHERE actor_subject IS NULL OR (
      actor_subject<>'context-use-bootstrap'
      AND actor_subject NOT LIKE 'context-use-template/%'
    )
  ) OR EXISTS (
    SELECT 1
    FROM knowledge_directories directory
    WHERE directory.current_path NOT IN ('','automations')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_pages page
        WHERE page.current_path LIKE directory.current_path||'/%'
      )
  ) THEN
    RAISE EXCEPTION 'knowledge imports require a fresh Context Use instance' USING ERRCODE='55000';
  END IF;

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
  SET id=(source_root->>'id')::uuid,
      version_number=(source_root->>'version_number')::integer,
      title=source_root->>'title',
      summary=source_root->>'summary',
      search_vector=directory_search_vector('',source_root->>'title',source_root->>'summary',''),
      created_at=(source_root->>'created_at')::timestamptz,
      updated_at=(source_root->>'updated_at')::timestamptz
  WHERE current_path='';

  INSERT INTO knowledge_directories(
    id,current_path,version_number,title,summary,search_vector,created_at,updated_at
  )
  SELECT
    value.id::uuid,value.current_path,value.version_number::integer,value.title,value.summary,
    directory_search_vector(value.current_path,value.title,value.summary,''),
    value.created_at::timestamptz,value.updated_at::timestamptz
  FROM jsonb_to_recordset(intent.archive->'directories') AS value(
    id text,current_path text,version_number text,title text,summary text,
    created_at text,updated_at text
  )
  WHERE value.current_path<>''
  ORDER BY length(value.current_path),value.current_path;

  UPDATE knowledge_pages
  SET id=(source_agents->>'id')::uuid,
      current_version_id=(source_agents->>'current_version_id')::uuid,
      published_version_id=(source_agents->>'published_version_id')::uuid,
      public_path=source_agents->>'public_path',
      created_at=(source_agents->>'created_at')::timestamptz,
      updated_at=(source_agents->>'updated_at')::timestamptz,
      archived_at=NULL,
      search_vector=page_search_vector(
        'agents',
        (SELECT version->>'title' FROM jsonb_array_elements(intent.archive->'page_versions') version
         WHERE version->>'id'=source_agents->>'current_version_id'),
        (SELECT version->>'summary' FROM jsonb_array_elements(intent.archive->'page_versions') version
         WHERE version->>'id'=source_agents->>'current_version_id'),
        (SELECT version->>'body_markdown' FROM jsonb_array_elements(intent.archive->'page_versions') version
         WHERE version->>'id'=source_agents->>'current_version_id')
      )
  WHERE current_path='agents';

  INSERT INTO knowledge_pages(
    id,current_path,current_version_id,published_version_id,public_path,
    created_at,updated_at,archived_at,search_vector
  )
  SELECT
    value.id::uuid,value.current_path,value.current_version_id::uuid,
    value.published_version_id::uuid,value.public_path,
    value.created_at::timestamptz,value.updated_at::timestamptz,value.archived_at::timestamptz,
    page_search_vector(value.current_path,version.title,version.summary,version.body_markdown)
  FROM jsonb_to_recordset(intent.archive->'pages') AS value(
    id text,current_path text,current_version_id text,published_version_id text,
    public_path text,created_at text,updated_at text,archived_at text
  )
  JOIN jsonb_to_recordset(intent.archive->'page_versions') AS version(
    id text,title text,summary text,body_markdown text
  ) ON version.id=value.current_version_id
  WHERE value.current_path<>'agents';

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,summary,body_markdown,commit_message,
    actor_kind,actor_subject,created_at
  )
  SELECT
    value.id::uuid,value.page_id::uuid,value.version_number::integer,value.path,
    value.title,value.summary,value.body_markdown,value.commit_message,
    value.actor_kind::actor_kind,value.actor_subject,value.created_at::timestamptz
  FROM jsonb_to_recordset(intent.archive->'page_versions') AS value(
    id text,page_id text,version_number text,path text,title text,summary text,
    body_markdown text,commit_message text,actor_kind text,actor_subject text,created_at text
  );

  INSERT INTO assets(
    id,current_path,public_path,filename,content_type,size_bytes,content_hash,
    s3_object_key,width,height,duration_seconds,created_at,deleted_at
  )
  SELECT
    value.id::uuid,value.current_path,value.public_path,value.filename,value.content_type,
    value.size_bytes::bigint,value.content_hash,value.s3_object_key,
    value.width::integer,value.height::integer,value.duration_seconds::numeric,
    value.created_at::timestamptz,value.deleted_at::timestamptz
  FROM jsonb_to_recordset(intent.archive->'assets') AS value(
    id text,current_path text,public_path text,filename text,content_type text,
    size_bytes text,content_hash text,s3_object_key text,width text,height text,
    duration_seconds text,created_at text,deleted_at text
  );

  INSERT INTO knowledge_asset_links(source_version_id,target_asset_id,created_at)
  SELECT value.source_version_id::uuid,value.target_asset_id::uuid,value.created_at::timestamptz
  FROM jsonb_to_recordset(intent.archive->'asset_links') AS value(
    source_version_id text,target_asset_id text,created_at text
  );

  -- Version triggers produce a temporary ledger while rows are loaded. Replace
  -- it with the source ledger, including durable tombstones and sequence IDs.
  DELETE FROM knowledge_page_changes;
  INSERT INTO knowledge_page_changes(
    change_sequence,page_id,version_id,version_number,change_kind,path,title,
    commit_message,actor_kind,actor_subject,changed_at
  ) OVERRIDING SYSTEM VALUE
  SELECT
    value.change_sequence::bigint,value.page_id::uuid,value.version_id::uuid,
    value.version_number::integer,value.change_kind,value.path,value.title,
    value.commit_message,value.actor_kind::actor_kind,value.actor_subject,
    value.changed_at::timestamptz
  FROM jsonb_to_recordset(intent.archive->'page_changes') AS value(
    change_sequence text,page_id text,version_id text,version_number text,
    change_kind text,path text,title text,commit_message text,actor_kind text,
    actor_subject text,changed_at text
  )
  ORDER BY value.change_sequence::bigint;

  SELECT max(change_sequence) INTO maximum_change_sequence FROM knowledge_page_changes;
  IF maximum_change_sequence IS NULL THEN
    PERFORM setval(pg_get_serial_sequence('knowledge_page_changes','change_sequence'),1,false);
  ELSE
    PERFORM setval(pg_get_serial_sequence('knowledge_page_changes','change_sequence'),maximum_change_sequence,true);
  END IF;

  UPDATE knowledge_import_intents SET consumed_at=now() WHERE id=intent.id;
  result := jsonb_build_object(
    'directories',jsonb_array_length(intent.archive->'directories'),
    'pages',jsonb_array_length(intent.archive->'pages'),
    'page_versions',jsonb_array_length(intent.archive->'page_versions'),
    'assets',jsonb_array_length(intent.archive->'assets'),
    'asset_links',jsonb_array_length(intent.archive->'asset_links'),
    'page_changes',jsonb_array_length(intent.archive->'page_changes')
  );
  RETURN result;
END;
$$;

GRANT SELECT ON knowledge_import_intents TO context_use_dashboard,context_use_backup;
GRANT INSERT (
  id,owner_user_id,session_id,archive,archive_sha256,
  active_asset_count,total_asset_bytes,expires_at
) ON knowledge_import_intents TO context_use_dashboard;
GRANT DELETE ON knowledge_import_intents TO context_use_dashboard;
GRANT SELECT (id,owner_user_id,session_id,expires_at,confirmed_at,consumed_at)
  ON knowledge_import_intents TO context_use_confirmation,context_use_boundary_owner;
GRANT UPDATE (confirmed_at,expires_at) ON knowledge_import_intents TO context_use_boundary_owner;
GRANT SELECT (id,owner_user_id,session_id,archive,expires_at,confirmed_at,consumed_at),
  UPDATE (consumed_at) ON knowledge_import_intents TO context_use_restore_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON
  knowledge_directories,knowledge_pages,knowledge_page_versions,assets,
  knowledge_asset_links,knowledge_page_changes,publication_intents,page_deletion_intents
TO context_use_restore_owner;
GRANT USAGE,SELECT,UPDATE ON SEQUENCE knowledge_page_changes_change_sequence_seq
  TO context_use_restore_owner;
GRANT EXECUTE ON FUNCTION directory_search_vector(text,text,text,text),page_search_vector(text,text,text,text)
  TO context_use_restore_owner;

GRANT INSERT (export_kind) ON knowledge_export_intents TO context_use_dashboard;
GRANT SELECT (export_kind) ON knowledge_export_intents
  TO context_use_dashboard,context_use_confirmation,context_use_boundary_owner;

GRANT CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION confirm_knowledge_import_intent(uuid,text,text,text,integer,integer)
  OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

GRANT USAGE,CREATE ON SCHEMA public TO context_use_restore_owner;
ALTER FUNCTION restore_knowledge_import(uuid,text,text)
  OWNER TO context_use_restore_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_restore_owner;

REVOKE ALL ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_knowledge_import_intent(uuid,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION restore_knowledge_import(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION confirm_knowledge_import_intent(uuid,text,text,text,integer,integer)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION restore_knowledge_import(uuid,text,text)
  TO context_use_dashboard;
