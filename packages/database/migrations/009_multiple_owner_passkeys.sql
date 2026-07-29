-- Allow the installation owner to register multiple independently revocable
-- passkeys while preserving the original owner identity and credential rows.

DROP INDEX "passkey_userId_unique";

CREATE TABLE passkey_management_intents (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('enroll','delete')),
  owner_user_id text NOT NULL CHECK (owner_user_id='context-use-owner'),
  session_id text NOT NULL REFERENCES "session"(id) ON DELETE CASCADE,
  target_passkey_id text REFERENCES passkey(id) ON DELETE CASCADE,
  name text,
  authenticator_attachment text CHECK (
    authenticator_attachment IS NULL OR authenticator_attachment='cross-platform'
  ),
  challenge text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  token_hash text CHECK (token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  authorizing_credential_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  CONSTRAINT passkey_management_intents_expiry CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '5 minutes'
  ),
  CONSTRAINT passkey_management_intents_shape CHECK (
    (
      action='enroll'
      AND target_passkey_id IS NULL
      AND name IS NOT NULL
      AND length(trim(name)) BETWEEN 1 AND 80
    ) OR (
      action='delete'
      AND target_passkey_id IS NOT NULL
      AND name IS NULL
      AND authenticator_attachment IS NULL
    )
  ),
  CONSTRAINT passkey_management_intents_confirmation CHECK (
    (confirmed_at IS NULL AND token_hash IS NULL AND authorizing_credential_id IS NULL)
    OR (
      confirmed_at IS NOT NULL
      AND authorizing_credential_id IS NOT NULL
      AND (action='delete' OR token_hash IS NOT NULL)
    )
  ),
  CONSTRAINT passkey_management_intents_consumption CHECK (
    consumed_at IS NULL OR confirmed_at IS NOT NULL
  )
);
CREATE INDEX passkey_management_intents_expiry_idx
  ON passkey_management_intents(expires_at);

-- Credential material remains immutable and replay counters can only advance.
-- Deletion takes an owner-scoped transaction lock so concurrent requests can
-- never remove the final passkey.
CREATE OR REPLACE FUNCTION protect_passkey_credential() RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD."userId",0));
    IF (
      SELECT count("userId") FROM passkey WHERE "userId"=OLD."userId"
    )<=1 THEN
      RAISE EXCEPTION 'at least one owner passkey is required' USING ERRCODE='22023';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."publicKey" IS DISTINCT FROM OLD."publicKey"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."credentialID" IS DISTINCT FROM OLD."credentialID"
     OR NEW."deviceType" IS DISTINCT FROM OLD."deviceType"
     OR NEW."backedUp" IS DISTINCT FROM OLD."backedUp"
     OR NEW.transports IS DISTINCT FROM OLD.transports
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW.aaguid IS DISTINCT FROM OLD.aaguid
     OR NEW.counter<OLD.counter THEN
    RAISE EXCEPTION 'the owner passkey credential is immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

UPDATE passkey
SET name='Primary passkey'
WHERE name IS NULL OR length(trim(name))=0;

ALTER TABLE passkey
  ADD CONSTRAINT passkey_name_length_check CHECK (
    name IS NULL OR length(trim(name)) BETWEEN 1 AND 80
  );

CREATE FUNCTION remove_owner_passkey(
  p_owner_user_id text,
  p_passkey_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF p_owner_user_id IS DISTINCT FROM 'context-use-owner'
     OR p_passkey_id IS NULL OR length(trim(p_passkey_id))<1 THEN
    RAISE EXCEPTION 'valid owner passkey required' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id,0));
  IF (
    SELECT count("userId") FROM passkey WHERE "userId"=p_owner_user_id
  )<=1 THEN
    RAISE EXCEPTION 'at least one owner passkey is required' USING ERRCODE='22023';
  END IF;

  DELETE FROM passkey
  WHERE id=p_passkey_id AND "userId"=p_owner_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner passkey not found' USING ERRCODE='P0002';
  END IF;
END;
$$;

GRANT SELECT,INSERT,UPDATE,DELETE
  ON passkey_management_intents TO context_use_auth;
GRANT SELECT ON passkey_management_intents TO context_use_backup;

GRANT SELECT (id) ON passkey TO context_use_boundary_owner;
GRANT DELETE ON passkey TO context_use_boundary_owner;
GRANT CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION remove_owner_passkey(text,text) OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;
REVOKE ALL ON FUNCTION remove_owner_passkey(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_owner_passkey(text,text) TO context_use_auth;
