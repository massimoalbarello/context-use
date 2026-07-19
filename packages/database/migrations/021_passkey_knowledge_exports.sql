CREATE TABLE knowledge_export_intents (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  session_id text NOT NULL,
  challenge text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  credential_id text,
  download_started_at timestamptz,
  CONSTRAINT knowledge_export_intents_expiry CHECK (expires_at > created_at),
  CONSTRAINT knowledge_export_intents_confirmation CHECK (
    (confirmed_at IS NULL AND credential_id IS NULL AND download_started_at IS NULL)
    OR (confirmed_at IS NOT NULL AND credential_id IS NOT NULL)
  ),
  CONSTRAINT knowledge_export_intents_download CHECK (
    download_started_at IS NULL OR confirmed_at IS NOT NULL
  )
);

CREATE INDEX knowledge_export_intents_expiry_idx
  ON knowledge_export_intents(expires_at);

CREATE TABLE knowledge_export_pages (
  intent_id uuid NOT NULL REFERENCES knowledge_export_intents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL,
  PRIMARY KEY (intent_id, page_id),
  FOREIGN KEY (version_id, page_id)
    REFERENCES knowledge_page_versions(id, page_id)
    ON DELETE RESTRICT
);

CREATE TABLE knowledge_export_assets (
  intent_id uuid NOT NULL REFERENCES knowledge_export_intents(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  current_path text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  content_hash text NOT NULL,
  s3_object_key text NOT NULL,
  PRIMARY KEY (intent_id, asset_id)
);

CREATE OR REPLACE FUNCTION confirm_knowledge_export_intent(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_credential_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  intent knowledge_export_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge export intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.confirmed_at IS NOT NULL OR intent.download_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge export intent already used' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at <= now() THEN
    RAISE EXCEPTION 'knowledge export intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id <> p_owner_user_id OR intent.session_id <> p_session_id THEN
    RAISE EXCEPTION 'knowledge export principal mismatch' USING ERRCODE='42501';
  END IF;
  IF length(p_credential_id) < 1 THEN
    RAISE EXCEPTION 'verified credential required' USING ERRCODE='42501';
  END IF;

  UPDATE knowledge_export_intents
  SET confirmed_at=now(),credential_id=p_credential_id
  WHERE id=p_intent_id;
END;
$$;

CREATE OR REPLACE FUNCTION claim_knowledge_export_download(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  intent knowledge_export_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge export intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'knowledge export passkey confirmation required' USING ERRCODE='42501';
  END IF;
  IF intent.download_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge export download already started' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at <= now() THEN
    RAISE EXCEPTION 'knowledge export intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id <> p_owner_user_id OR intent.session_id <> p_session_id THEN
    RAISE EXCEPTION 'knowledge export principal mismatch' USING ERRCODE='42501';
  END IF;

  UPDATE knowledge_export_intents
  SET download_started_at=now()
  WHERE id=p_intent_id;
END;
$$;

REVOKE ALL ON knowledge_export_intents,knowledge_export_pages,knowledge_export_assets FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_knowledge_export_intent(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_knowledge_export_download(uuid,text,text) FROM PUBLIC;
REVOKE SELECT ON publication_intents FROM context_use_publisher;

GRANT SELECT ON knowledge_export_intents,knowledge_export_pages,knowledge_export_assets
  TO context_use_dashboard;
GRANT INSERT (id,owner_user_id,session_id,challenge,expires_at)
  ON knowledge_export_intents TO context_use_dashboard;
GRANT INSERT ON knowledge_export_pages,knowledge_export_assets TO context_use_dashboard;
GRANT DELETE ON knowledge_export_intents TO context_use_dashboard;

GRANT EXECUTE ON FUNCTION confirm_knowledge_export_intent(uuid,text,text,text)
  TO context_use_publisher;
GRANT EXECUTE ON FUNCTION claim_knowledge_export_download(uuid,text,text)
  TO context_use_publisher;

GRANT SELECT ON knowledge_export_intents,knowledge_export_pages,knowledge_export_assets
  TO context_use_backup;
