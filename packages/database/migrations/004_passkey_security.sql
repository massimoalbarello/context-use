CREATE TABLE passkey_management_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('add_passkey', 'delete_passkey')),
  target_credential_id text,
  owner_user_id text NOT NULL,
  session_id text NOT NULL,
  challenge text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE TABLE passkey_management_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL UNIQUE REFERENCES passkey_management_intents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CHECK (action IN ('add_passkey', 'delete_passkey')),
  target_credential_id text,
  owner_user_id text NOT NULL,
  session_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE passkey_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  owner_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

REVOKE ALL ON passkey_management_intents, passkey_management_grants, passkey_recovery_tokens FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON passkey_management_intents, passkey_management_grants, passkey_recovery_tokens TO context_use_auth;
GRANT INSERT ON security_audit_events TO context_use_auth;
GRANT SELECT ON passkey_management_intents, passkey_management_grants, passkey_recovery_tokens TO context_use_backup;
