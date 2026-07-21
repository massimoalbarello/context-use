-- Search only the current page snapshot. Historical versions remain available
-- for rollback/publication without inflating the full-text index.
ALTER TABLE knowledge_pages
  ADD COLUMN search_vector tsvector NOT NULL DEFAULT ''::tsvector;

UPDATE knowledge_pages page
SET search_vector=(
  setweight(to_tsvector('simple',coalesce(version.path,'')),'A')
  || setweight(to_tsvector('simple',coalesce(version.title,'')),'A')
  || setweight(to_tsvector('english',coalesce(version.body_markdown,'')),'B')
)
FROM knowledge_page_versions version
WHERE version.id=page.current_version_id AND version.page_id=page.id;

CREATE INDEX knowledge_pages_search_idx
  ON knowledge_pages USING gin(search_vector);
DROP INDEX knowledge_page_versions_search_idx;
ALTER TABLE knowledge_page_versions DROP COLUMN search_vector;

CREATE FUNCTION page_search_vector(p_path text,p_title text,p_body_markdown text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog
RETURN (
  setweight(to_tsvector('simple',coalesce(p_path,'')),'A')
  || setweight(to_tsvector('simple',coalesce(p_title,'')),'A')
  || setweight(to_tsvector('english',coalesce(p_body_markdown,'')),'B')
);

-- Application roles can refresh only the derived current-page search column.
GRANT INSERT (search_vector) ON knowledge_pages TO context_use_dashboard,context_use_mcp;
GRANT UPDATE (search_vector) ON knowledge_pages TO context_use_dashboard,context_use_mcp;
REVOKE ALL ON FUNCTION page_search_vector(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION page_search_vector(text,text,text)
  TO context_use_dashboard,context_use_mcp;

-- Retain the five newest versions, the exact published snapshot, and a version
-- selected by an unexpired publication confirmation. Callers never receive
-- arbitrary DELETE access to immutable history.
CREATE FUNCTION prune_page_versions(p_page_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  removed_count integer;
BEGIN
  IF p_page_id IS NULL THEN
    RAISE EXCEPTION 'page id required' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM knowledge_pages WHERE id=p_page_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  WITH newest AS (
    SELECT id
    FROM knowledge_page_versions
    WHERE page_id=p_page_id
    ORDER BY version_number DESC
    LIMIT 5
  ), removed AS (
    DELETE FROM knowledge_page_versions version
    WHERE version.page_id=p_page_id
      AND NOT EXISTS (SELECT 1 FROM newest WHERE newest.id=version.id)
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_pages page
        WHERE page.id=p_page_id
          AND (page.current_version_id=version.id OR page.published_version_id=version.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_intents intent
        WHERE intent.target_kind='page'
          AND intent.target_id=p_page_id
          AND intent.version_id=version.id
          AND intent.expires_at>now()
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO removed_count FROM removed;

  RETURN removed_count;
END;
$$;

GRANT DELETE ON knowledge_page_versions TO context_use_boundary_owner;
GRANT SELECT (id,version_number) ON knowledge_page_versions TO context_use_boundary_owner;
GRANT SELECT (id,current_version_id,published_version_id)
  ON knowledge_pages TO context_use_boundary_owner;
ALTER FUNCTION prune_page_versions(uuid) OWNER TO context_use_boundary_owner;
REVOKE ALL ON FUNCTION prune_page_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_page_versions(uuid)
  TO context_use_dashboard,context_use_mcp;

DO $$
DECLARE
  page_id uuid;
BEGIN
  FOR page_id IN SELECT id FROM knowledge_pages LOOP
    PERFORM prune_page_versions(page_id);
  END LOOP;
END;
$$;

-- Permanent page deletion is staged by the dashboard and can be consumed only
-- by the isolated passkey-confirmation service.
CREATE TABLE page_deletion_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  expected_version_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT page_deletion_intents_owner CHECK (owner_user_id='context-use-owner'),
  CONSTRAINT page_deletion_intents_expiry CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '5 minutes'
  )
);
CREATE INDEX page_deletion_intents_expiry_idx ON page_deletion_intents(expires_at);

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
  );

  IF p_intent_kind='publication' THEN
    SELECT expires_at,false
    INTO intent_expires_at,intent_inactive
    FROM publication_intents
    WHERE id=p_intent_id;
  ELSIF p_intent_kind='knowledge_export' THEN
    SELECT expires_at,confirmed_at IS NOT NULL OR download_started_at IS NOT NULL
    INTO intent_expires_at,intent_inactive
    FROM knowledge_export_intents
    WHERE id=p_intent_id;
  ELSE
    SELECT expires_at,false
    INTO intent_expires_at,intent_inactive
    FROM page_deletion_intents
    WHERE id=p_intent_id;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'confirmation intent not found' USING ERRCODE='P0002'; END IF;
  IF intent_inactive OR intent_expires_at<=now() THEN
    RAISE EXCEPTION 'confirmation intent is inactive' USING ERRCODE='22023';
  END IF;
  INSERT INTO confirmation_challenges(intent_kind,intent_id,challenge)
  VALUES (p_intent_kind,p_intent_id,p_challenge);
END;
$$;

CREATE FUNCTION confirm_page_deletion_intent(
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
  target record;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified page deletion principal required' USING ERRCODE='42501';
  END IF;

  SELECT id,page_id,expected_version_id,owner_user_id,session_id,expires_at
  INTO intent
  FROM page_deletion_intents
  WHERE id=p_intent_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'page deletion intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'page deletion intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'page deletion intent principal mismatch' USING ERRCODE='42501';
  END IF;
  SELECT challenge INTO intent_challenge
  FROM confirmation_challenges
  WHERE intent_kind='page_deletion' AND intent_id=intent.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page deletion challenge not issued' USING ERRCODE='42501';
  END IF;

  SELECT id,current_version_id,published_version_id,archived_at
  INTO target
  FROM knowledge_pages
  WHERE id=intent.page_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'page not found' USING ERRCODE='P0002'; END IF;
  IF target.archived_at IS NULL OR target.published_version_id IS NOT NULL
     OR target.current_version_id IS DISTINCT FROM intent.expected_version_id
     OR EXISTS (
       SELECT 1 FROM cron_schedules schedule
       WHERE schedule.instructions_page_id=target.id
     ) THEN
    RAISE EXCEPTION 'page is no longer eligible for permanent deletion' USING ERRCODE='22023';
  END IF;

  PERFORM consume_confirmation_challenge(
    'page_deletion',intent.id,intent_challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  DELETE FROM publication_intents
  WHERE target_kind='page' AND target_id=target.id;
  DELETE FROM knowledge_page_versions WHERE page_id=target.id;
  DELETE FROM knowledge_pages WHERE id=target.id;
END;
$$;

GRANT SELECT ON page_deletion_intents TO context_use_dashboard;
GRANT INSERT (
  id,page_id,expected_version_id,owner_user_id,session_id,expires_at
) ON page_deletion_intents TO context_use_dashboard;
GRANT SELECT (
  id,page_id,expected_version_id,owner_user_id,session_id,expires_at
) ON page_deletion_intents TO context_use_boundary_owner;
GRANT DELETE ON page_deletion_intents TO context_use_boundary_owner;
GRANT DELETE ON knowledge_pages TO context_use_boundary_owner;
GRANT SELECT (id,current_version_id,published_version_id,archived_at)
  ON knowledge_pages TO context_use_boundary_owner;
GRANT SELECT (instructions_page_id) ON cron_schedules TO context_use_boundary_owner;
GRANT SELECT (
  id,page_id,expected_version_id,owner_user_id,session_id,expires_at
) ON page_deletion_intents TO context_use_confirmation;
GRANT SELECT ON page_deletion_intents TO context_use_backup;

ALTER FUNCTION confirm_page_deletion_intent(uuid,text,text,text,integer,integer)
  OWNER TO context_use_boundary_owner;
REVOKE ALL ON FUNCTION confirm_page_deletion_intent(uuid,text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_page_deletion_intent(uuid,text,text,text,integer,integer)
  TO context_use_confirmation;

-- The replaced generic issuer keeps its existing owner and execution grants.
REVOKE ALL ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  TO context_use_confirmation;
