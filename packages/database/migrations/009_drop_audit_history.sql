CREATE OR REPLACE FUNCTION confirm_publication_intent(
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
  intent publication_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent
  FROM publication_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication intent not found' USING ERRCODE = 'P0002'; END IF;
  IF intent.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'publication intent already consumed' USING ERRCODE = '23505'; END IF;
  IF intent.expires_at <= now() THEN RAISE EXCEPTION 'publication intent expired' USING ERRCODE = '22023'; END IF;
  IF intent.owner_user_id <> p_owner_user_id OR intent.session_id <> p_session_id THEN
    RAISE EXCEPTION 'publication intent principal mismatch' USING ERRCODE = '42501';
  END IF;
  IF length(p_credential_id) < 1 THEN RAISE EXCEPTION 'verified credential required' USING ERRCODE = '42501'; END IF;

  IF intent.target_kind = 'page' THEN
    IF intent.action IN ('publish', 'republish') THEN
      IF intent.version_id IS NULL OR intent.public_slug IS NULL THEN
        RAISE EXCEPTION 'page publication requires version and slug' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM knowledge_page_versions
        WHERE id = intent.version_id AND page_id = intent.target_id
      ) THEN
        RAISE EXCEPTION 'page version mismatch' USING ERRCODE = '23503';
      END IF;
      UPDATE knowledge_pages
      SET published_version_id = intent.version_id,
          public_slug = intent.public_slug,
          updated_at = now()
      WHERE id = intent.target_id AND archived_at IS NULL;
    ELSE
      UPDATE knowledge_pages
      SET published_version_id = NULL, public_slug = NULL, updated_at = now()
      WHERE id = intent.target_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    IF intent.action IN ('publish', 'republish') THEN
      UPDATE assets SET published_at = now()
      WHERE id = intent.target_id AND deleted_at IS NULL;
    ELSE
      UPDATE assets SET published_at = NULL WHERE id = intent.target_id;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  UPDATE publication_intents SET consumed_at = now() WHERE id = intent.id;
END;
$$;

DROP TABLE IF EXISTS publication_events;
DROP TABLE IF EXISTS security_audit_events;
