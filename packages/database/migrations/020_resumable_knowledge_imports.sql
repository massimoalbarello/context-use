ALTER TABLE knowledge_import_intents
  DROP CONSTRAINT knowledge_import_intents_expiry;

ALTER TABLE knowledge_import_intents
  ADD CONSTRAINT knowledge_import_intents_expiry CHECK (
    expires_at>created_at
    AND (
      (confirmed_at IS NULL AND expires_at<=created_at+interval '15 minutes')
      OR
      (confirmed_at IS NOT NULL AND expires_at<=confirmed_at+interval '24 hours')
    )
  );

GRANT UPDATE (expires_at)
  ON knowledge_import_intents TO context_use_boundary_owner;

CREATE OR REPLACE FUNCTION confirm_knowledge_import_intent(
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
