-- Context Use v1 database baseline.
--
-- This migration intentionally targets a new, empty PostgreSQL 17 database.
-- Authorization is based on isolated connection roles because an installation
-- has exactly one owner; there is no multi-tenant row boundary for RLS to model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'context_use_auth',
    'context_use_dashboard',
    'context_use_mcp',
    'context_use_public',
    'context_use_public_mcp',
    'context_use_confirmation',
    'context_use_storage',
    'context_use_backup',
    'context_use_projection_owner',
    'context_use_boundary_owner'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
        role_name
      );
    ELSE
      EXECUTE format(
        'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
        role_name
      );
    END IF;
    EXECUTE format('ALTER ROLE %I SET search_path=pg_catalog,public', role_name);
  END LOOP;

  -- Only named application identities may open a connection. Application roles
  -- cannot create schemas or temporary objects in this dedicated database.
  EXECUTE format(
    'REVOKE CONNECT,TEMPORARY,CREATE ON DATABASE %I FROM PUBLIC',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO context_use_auth,context_use_dashboard,context_use_mcp,context_use_public,context_use_public_mcp,context_use_confirmation,context_use_storage,context_use_backup',
    current_database()
  );
END;
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO
  context_use_auth,
  context_use_dashboard,
  context_use_mcp,
  context_use_public,
  context_use_public_mcp,
  context_use_confirmation,
  context_use_storage,
  context_use_backup,
  context_use_projection_owner,
  context_use_boundary_owner;

-- Make omissions fail closed in every later migration created by this owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TYPE actor_kind AS ENUM ('dashboard','mcp');
CREATE TYPE publication_action AS ENUM ('publish','republish','unpublish');
CREATE TYPE publication_target AS ENUM ('page','asset');
CREATE TYPE confirmation_intent_kind AS ENUM ('publication','knowledge_export');

-- Better Auth and OAuth provider state. Only context_use_auth receives access.
CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_single_owner_check CHECK (
    id='context-use-owner' AND "emailVerified"=true
  )
);

CREATE TABLE "session" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session"("userId");

CREATE TABLE account (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX "account_userId_idx" ON account("userId");

CREATE TABLE verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE jwks (
  id text PRIMARY KEY,
  "publicKey" text NOT NULL,
  "privateKey" text NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "expiresAt" timestamptz,
  alg text,
  crv text
);

CREATE TABLE passkey (
  id text PRIMARY KEY,
  name text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "credentialID" text NOT NULL,
  counter integer NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" boolean NOT NULL,
  transports text,
  "createdAt" timestamptz,
  aaguid text
);
CREATE UNIQUE INDEX "passkey_userId_unique" ON passkey("userId");
CREATE UNIQUE INDEX "passkey_credentialID_unique" ON passkey("credentialID");
CREATE INDEX "passkey_credentialID_idx" ON passkey("credentialID");

-- The sole owner identity and registered passkey are permanent. Authentication
-- may advance the authenticator counter, but no application credential can
-- replace the public key, delete the credential, or reset replay state.
CREATE FUNCTION protect_owner_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'the owner identity is immutable' USING ERRCODE='42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW."emailVerified" IS DISTINCT FROM OLD."emailVerified" THEN
    RAISE EXCEPTION 'the owner identity is immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_protect_owner_identity
BEFORE UPDATE OR DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION protect_owner_identity();

CREATE FUNCTION protect_passkey_credential() RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'the owner passkey is immutable' USING ERRCODE='42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW."publicKey" IS DISTINCT FROM OLD."publicKey"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."credentialID" IS DISTINCT FROM OLD."credentialID"
     OR NEW."deviceType" IS DISTINCT FROM OLD."deviceType"
     OR NEW."backedUp" IS DISTINCT FROM OLD."backedUp"
     OR NEW.transports IS DISTINCT FROM OLD.transports
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW.aaguid IS DISTINCT FROM OLD.aaguid
     OR NEW.counter<OLD.counter THEN
    RAISE EXCEPTION 'the owner passkey is immutable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER passkey_protect_credential
BEFORE UPDATE OR DELETE ON passkey
FOR EACH ROW EXECUTE FUNCTION protect_passkey_credential();

CREATE TABLE "oauthClient" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL UNIQUE,
  "clientSecret" text,
  disabled boolean,
  "skipConsent" boolean,
  "enableEndSession" boolean,
  "subjectType" text,
  scopes jsonb,
  "userId" text REFERENCES "user"(id) ON DELETE CASCADE,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  name text,
  uri text,
  icon text,
  contacts jsonb,
  tos text,
  policy text,
  "softwareId" text,
  "softwareVersion" text,
  "softwareStatement" text,
  "redirectUris" jsonb NOT NULL,
  "postLogoutRedirectUris" jsonb,
  "tokenEndpointAuthMethod" text,
  "grantTypes" jsonb,
  "responseTypes" jsonb,
  public boolean,
  type text,
  "requirePKCE" boolean,
  "referenceId" text,
  metadata jsonb,
  "dpopBoundAccessTokens" boolean NOT NULL DEFAULT false
);
CREATE INDEX "oauthClient_userId_idx" ON "oauthClient"("userId");

CREATE TABLE "oauthRefreshToken" (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  "clientId" text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" text REFERENCES "session"(id) ON DELETE SET NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "referenceId" text,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  revoked timestamptz,
  "authTime" timestamptz,
  scopes jsonb NOT NULL,
  "authorizationCodeId" text,
  resources jsonb,
  "requestedUserInfoClaims" jsonb,
  "rotatedAt" timestamptz,
  "rotationReplayResponse" text,
  "rotationReplayExpiresAt" timestamptz,
  confirmation jsonb
);
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauthRefreshToken"("clientId");
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauthRefreshToken"("sessionId");
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauthRefreshToken"("userId");
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

CREATE TABLE "oauthAccessToken" (
  id text PRIMARY KEY,
  token text NOT NULL UNIQUE,
  "clientId" text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "sessionId" text REFERENCES "session"(id) ON DELETE SET NULL,
  "userId" text REFERENCES "user"(id) ON DELETE CASCADE,
  "referenceId" text,
  "refreshId" text REFERENCES "oauthRefreshToken"(id) ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL,
  scopes jsonb NOT NULL,
  "authorizationCodeId" text,
  resources jsonb,
  "requestedUserInfoClaims" jsonb,
  revoked timestamptz,
  confirmation jsonb
);
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauthAccessToken"("clientId");
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauthAccessToken"("sessionId");
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauthAccessToken"("userId");
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauthAccessToken"("refreshId");
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

CREATE TABLE "oauthConsent" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "userId" text REFERENCES "user"(id) ON DELETE CASCADE,
  "referenceId" text,
  scopes jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  resources jsonb,
  "requestedUserInfoClaims" jsonb
);
CREATE INDEX "oauthConsent_clientId_idx" ON "oauthConsent"("clientId");
CREATE INDEX "oauthConsent_userId_idx" ON "oauthConsent"("userId");

CREATE TABLE "oauthResource" (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  name text NOT NULL,
  "accessTokenTtl" integer,
  "refreshTokenTtl" integer,
  "signingAlgorithm" text,
  "signingKeyId" text,
  "allowedScopes" jsonb,
  "customClaims" jsonb,
  "dpopBoundAccessTokensRequired" boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "policyVersion" integer NOT NULL DEFAULT 1,
  metadata jsonb
);

CREATE TABLE "oauthClientResource" (
  id text PRIMARY KEY,
  "clientId" text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  "resourceId" text NOT NULL REFERENCES "oauthResource"(identifier) ON DELETE CASCADE,
  metadata jsonb,
  "createdAt" timestamptz
);
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

CREATE TABLE "oauthClientAssertion" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL
);

CREATE TABLE mcp_client_usage (
  client_id text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id,user_id)
);

-- Private knowledge and immutable history.
CREATE TABLE knowledge_pages (
  id uuid PRIMARY KEY,
  current_path text NOT NULL,
  current_version_id uuid NOT NULL,
  published_version_id uuid,
  public_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  automation_id uuid,
  required_public_path text,
  CONSTRAINT knowledge_pages_path_format CHECK (
    current_path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND current_path !~ '//'
    AND right(current_path,1)<>'/'
  ),
  CONSTRAINT knowledge_pages_public_path_format CHECK (
    public_path IS NULL OR (
      public_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND public_path !~ '//'
      AND right(public_path,1)<>'/'
    )
  ),
  CONSTRAINT knowledge_pages_publication_pair CHECK (
    (published_version_id IS NULL AND public_path IS NULL)
    OR (published_version_id IS NOT NULL AND public_path IS NOT NULL)
  ),
  CONSTRAINT knowledge_pages_required_public_path CHECK (
    required_public_path IS NULL OR (
      required_public_path='about'
      AND current_path='about/intro'
      AND public_path=required_public_path
      AND published_version_id IS NOT NULL
      AND archived_at IS NULL
    )
  ),
  CONSTRAINT knowledge_pages_about_is_folder CHECK (
    archived_at IS NOT NULL OR current_path<>'about'
  )
);
CREATE UNIQUE INDEX knowledge_pages_active_path_unique
  ON knowledge_pages(current_path) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX knowledge_pages_public_path_unique
  ON knowledge_pages(public_path) WHERE public_path IS NOT NULL;
CREATE UNIQUE INDEX knowledge_pages_required_public_path_unique
  ON knowledge_pages(required_public_path) WHERE required_public_path IS NOT NULL;
CREATE INDEX knowledge_pages_automation_idx
  ON knowledge_pages(automation_id,current_path) WHERE automation_id IS NOT NULL;

CREATE TABLE knowledge_page_versions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number>0),
  path text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  body_markdown text NOT NULL CHECK (octet_length(body_markdown)<=4000000),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',coalesce(path,'')),'A')
    || setweight(to_tsvector('simple',coalesce(title,'')),'A')
    || setweight(to_tsvector('english',coalesce(body_markdown,'')),'B')
  ) STORED,
  CONSTRAINT knowledge_page_versions_path_format CHECK (
    path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND path !~ '//'
    AND right(path,1)<>'/'
  ),
  UNIQUE (page_id,version_number),
  UNIQUE (id,page_id)
);
CREATE INDEX knowledge_page_versions_search_idx
  ON knowledge_page_versions USING gin(search_vector);
CREATE INDEX knowledge_page_versions_page_created_idx
  ON knowledge_page_versions(page_id,created_at DESC);

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_current_version_fk
  FOREIGN KEY (current_version_id,id)
  REFERENCES knowledge_page_versions(id,page_id)
  DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT knowledge_pages_published_version_fk
  FOREIGN KEY (published_version_id,id)
  REFERENCES knowledge_page_versions(id,page_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  current_path text NOT NULL,
  public_path text,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 1024),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes>=0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  s3_object_key text NOT NULL UNIQUE CHECK (s3_object_key ~ '^objects/[a-f0-9-]+$'),
  width integer CHECK (width IS NULL OR width>0),
  height integer CHECK (height IS NULL OR height>0),
  duration_seconds numeric CHECK (duration_seconds IS NULL OR duration_seconds>=0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT assets_path_format CHECK (
    current_path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND current_path !~ '//'
    AND right(current_path,1)<>'/'
  ),
  CONSTRAINT assets_public_path_format CHECK (
    public_path IS NULL OR (
      public_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND public_path !~ '//'
      AND right(public_path,1)<>'/'
    )
  ),
  CONSTRAINT assets_publication_pair CHECK (
    (published_at IS NULL AND public_path IS NULL)
    OR (published_at IS NOT NULL AND public_path IS NOT NULL)
  )
);
CREATE UNIQUE INDEX assets_active_path_unique
  ON assets(current_path) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX assets_public_path_unique
  ON assets(public_path) WHERE public_path IS NOT NULL;
CREATE INDEX assets_active_created_idx
  ON assets(created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE knowledge_asset_links (
  source_version_id uuid NOT NULL REFERENCES knowledge_page_versions(id) ON DELETE CASCADE,
  target_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_version_id,target_asset_id)
);
CREATE INDEX knowledge_asset_links_target_idx ON knowledge_asset_links(target_asset_id);

-- Skills and automations are private capabilities available to the owner and
-- owner-authorized private MCP clients only.
CREATE TABLE agent_skills (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (
    length(name) BETWEEN 1 AND 64
    AND name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  current_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX agent_skills_name_unique
  ON agent_skills(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE agent_skill_versions (
  id uuid PRIMARY KEY,
  skill_id uuid NOT NULL REFERENCES agent_skills(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number>0),
  instructions_markdown text NOT NULL CHECK (
    length(trim(instructions_markdown))>0
    AND octet_length(instructions_markdown)<=4000000
  ),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1024),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id,version_number),
  UNIQUE (id,skill_id)
);

ALTER TABLE agent_skills
  ADD CONSTRAINT agent_skills_current_version_fk
  FOREIGN KEY (current_version_id,id)
  REFERENCES agent_skill_versions(id,skill_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE cron_schedules (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  cron_expression text NOT NULL CHECK (length(trim(cron_expression)) BETWEEN 9 AND 160),
  timezone text NOT NULL CHECK (length(trim(timezone)) BETWEEN 1 AND 100),
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input)='object'),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  automation_key text NOT NULL CHECK (
    length(automation_key) BETWEEN 1 AND 64
    AND automation_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  knowledge_path text GENERATED ALWAYS AS ('automations/' || automation_key) STORED,
  current_version_id uuid NOT NULL
);
CREATE UNIQUE INDEX cron_schedules_name_unique
  ON cron_schedules(lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX cron_schedules_automation_key_unique ON cron_schedules(automation_key);
CREATE UNIQUE INDEX cron_schedules_knowledge_path_unique ON cron_schedules(knowledge_path);
CREATE INDEX cron_schedules_due_idx
  ON cron_schedules(next_run_at) WHERE enabled AND deleted_at IS NULL;

CREATE TABLE automation_versions (
  id uuid PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES cron_schedules(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number>0),
  instructions_markdown text NOT NULL CHECK (
    length(trim(instructions_markdown))>0
    AND octet_length(instructions_markdown)<=4000000
  ),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id,version_number),
  UNIQUE (id,automation_id)
);

ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_current_version_fk
  FOREIGN KEY (current_version_id,id)
  REFERENCES automation_versions(id,automation_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_automation_id_fk
  FOREIGN KEY (automation_id) REFERENCES cron_schedules(id) ON DELETE RESTRICT;

CREATE TABLE automation_runs (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES cron_schedules(id) ON DELETE RESTRICT,
  automation_version_id uuid NOT NULL,
  scheduled_for timestamptz NOT NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input)='object'),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','claimed','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  claimed_by text,
  claim_token uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  result_summary text CHECK (result_summary IS NULL OR length(result_summary)<=500),
  error_message text CHECK (error_message IS NULL OR length(error_message)<=10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id,scheduled_for),
  CONSTRAINT automation_runs_version_fk
    FOREIGN KEY (automation_version_id,schedule_id)
    REFERENCES automation_versions(id,automation_id) ON DELETE RESTRICT,
  CONSTRAINT automation_runs_claim_fields CHECK (
    (status='ready' AND claimed_by IS NULL AND claim_token IS NULL
      AND claimed_at IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL)
    OR (status='claimed' AND claimed_by IS NOT NULL AND claim_token IS NOT NULL
      AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded','failed') AND claimed_by IS NOT NULL AND claim_token IS NOT NULL
      AND claimed_at IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX automation_runs_claim_idx
  ON automation_runs(scheduled_for) WHERE status IN ('ready','claimed');
CREATE INDEX automation_runs_recent_idx ON automation_runs(scheduled_for DESC);
CREATE INDEX automation_runs_completed_idx
  ON automation_runs(completed_at DESC,id DESC)
  WHERE status IN ('succeeded','failed');

-- Visibility changes are staged as immutable, short-lived intents. Only the
-- execute-only boundary role can consume an intent after passkey verification.
CREATE TABLE publication_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action publication_action NOT NULL,
  target_kind publication_target NOT NULL,
  target_id uuid NOT NULL,
  version_id uuid,
  public_path text,
  owner_user_id text NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
  challenge text UNIQUE CHECK (
    challenge IS NULL OR challenge ~ '^[A-Za-z0-9_-]{43,128}$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT publication_intents_owner CHECK (owner_user_id='context-use-owner'),
  CONSTRAINT publication_intents_expiry CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '5 minutes'
  ),
  CONSTRAINT publication_intents_public_path_format CHECK (
    public_path IS NULL OR (
      public_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND public_path !~ '//'
      AND right(public_path,1)<>'/'
    )
  ),
  CONSTRAINT publication_intents_target_fields CHECK (
    (action='unpublish' AND version_id IS NULL AND public_path IS NULL)
    OR (
      action IN ('publish','republish') AND public_path IS NOT NULL
      AND (
        (target_kind='page' AND version_id IS NOT NULL)
        OR (target_kind='asset' AND version_id IS NULL)
      )
    )
  )
);
CREATE INDEX publication_intents_expiry_idx
  ON publication_intents(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL DEFAULT 'context-use-owner'
    REFERENCES "user"(id) ON DELETE CASCADE,
  reply_to text NOT NULL CHECK (length(reply_to) BETWEEN 3 AND 320),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_messages_owner CHECK (owner_user_id='context-use-owner')
);
CREATE INDEX inbound_messages_owner_created_idx
  ON inbound_messages(owner_user_id,created_at DESC,id DESC);

CREATE TABLE knowledge_export_intents (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
  challenge text UNIQUE CHECK (
    challenge IS NULL OR challenge ~ '^[A-Za-z0-9_-]{43,128}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  credential_id text,
  download_started_at timestamptz,
  CONSTRAINT knowledge_export_intents_owner CHECK (owner_user_id='context-use-owner'),
  CONSTRAINT knowledge_export_intents_expiry CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '5 minutes'
  ),
  CONSTRAINT knowledge_export_intents_confirmation CHECK (
    (confirmed_at IS NULL AND credential_id IS NULL AND download_started_at IS NULL)
    OR (confirmed_at IS NOT NULL AND credential_id IS NOT NULL)
  ),
  CONSTRAINT knowledge_export_intents_download CHECK (
    download_started_at IS NULL OR confirmed_at IS NOT NULL
  )
);
CREATE INDEX knowledge_export_intents_expiry_idx ON knowledge_export_intents(expires_at);

-- Challenges are generated only by the isolated confirmation service. This
-- single table makes them globally unique across publication and export so a
-- signed assertion for one operation cannot be replayed against the other.
CREATE TABLE confirmation_challenges (
  intent_kind confirmation_intent_kind NOT NULL,
  intent_id uuid NOT NULL,
  challenge text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (intent_kind,intent_id)
);

CREATE TABLE knowledge_export_pages (
  intent_id uuid NOT NULL REFERENCES knowledge_export_intents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL,
  PRIMARY KEY (intent_id,page_id),
  FOREIGN KEY (version_id,page_id)
    REFERENCES knowledge_page_versions(id,page_id) ON DELETE RESTRICT
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
  PRIMARY KEY (intent_id,asset_id)
);

-- Database-enforced ownership and reserved-path invariants.
CREATE FUNCTION enforce_automation_page_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  owner_automation_key text;
BEGIN
  IF NEW.automation_id IS NULL THEN
    IF NEW.current_path ~ '^automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT automation_key INTO owner_automation_key
  FROM cron_schedules
  WHERE id=NEW.automation_id;

  IF owner_automation_key IS NULL
     OR NEW.current_path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_pages_automation_path
BEFORE INSERT OR UPDATE OF current_path,automation_id ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION enforce_automation_page_path();

CREATE FUNCTION enforce_automation_page_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  owner_automation_id uuid;
  owner_automation_key text;
BEGIN
  SELECT page.automation_id,schedule.automation_key
  INTO owner_automation_id,owner_automation_key
  FROM knowledge_pages page
  LEFT JOIN cron_schedules schedule ON schedule.id=page.automation_id
  WHERE page.id=NEW.page_id;

  IF owner_automation_id IS NULL THEN
    IF NEW.path ~ '^automations(/|$)' THEN
      RAISE EXCEPTION 'reserved automation knowledge path' USING ERRCODE='23514';
    END IF;
  ELSIF owner_automation_key IS NULL
     OR NEW.path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
    RAISE EXCEPTION 'automation page path is outside its owned folder'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_page_versions_automation_path
BEFORE INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION enforce_automation_page_version_path();

CREATE FUNCTION keep_automation_key_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.automation_key IS DISTINCT FROM OLD.automation_key THEN
    RAISE EXCEPTION 'automation key is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cron_schedules_keep_automation_key
BEFORE UPDATE OF automation_key ON cron_schedules
FOR EACH ROW EXECUTE FUNCTION keep_automation_key_immutable();

CREATE FUNCTION keep_automation_pages_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.target_kind='page'
     AND NEW.action IN ('publish','republish')
     AND EXISTS (
       SELECT 1 FROM knowledge_pages
       WHERE id=NEW.target_id AND automation_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'automation-generated pages cannot be published'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_keep_automation_pages_private
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION keep_automation_pages_private();

CREATE FUNCTION protect_required_public_page_intent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  required_path text;
BEGIN
  IF NEW.target_kind<>'page' THEN RETURN NEW; END IF;

  SELECT required_public_path INTO required_path
  FROM knowledge_pages
  WHERE id=NEW.target_id;

  IF required_path IS NOT NULL
     AND (NEW.action='unpublish' OR NEW.public_path IS DISTINCT FROM required_path) THEN
    RAISE EXCEPTION 'the required /p/% page cannot be moved or unpublished',required_path
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_protect_required_public_page
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION protect_required_public_page_intent();

-- The sole bootstrap publication contains no owner data. Every later public
-- version still requires a publication intent and a user-verified passkey.
DO $$
DECLARE
  about_page_id uuid := gen_random_uuid();
  about_version_id uuid := gen_random_uuid();
  agents_page_id uuid := gen_random_uuid();
  agents_version_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO knowledge_pages(
    id,current_path,current_version_id,published_version_id,public_path,required_public_path
  ) VALUES (
    about_page_id,'about/intro',about_version_id,about_version_id,'about','about'
  );

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
  ) VALUES (
    about_version_id,about_page_id,1,'about/intro','Intro','',
    'Create required public about page','dashboard','context-use-bootstrap'
  );

  INSERT INTO knowledge_pages(id,current_path,current_version_id)
  VALUES (agents_page_id,'agents',agents_version_id);

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
  ) VALUES (
    agents_version_id,agents_page_id,1,'agents','AGENTS.md',
    E'# Knowledge base structure\n\n- Store information whose subject is the owner in `about/`. Start with `about/intro`.\n- Store other entities in separate top-level folders, such as `people/`, `companies/`, and `events/`.\n- Link related pages instead of nesting other entities under `about/`.\n',
    'Create knowledge base guide','dashboard','context-use-bootstrap'
  );
END;
$$;

-- Projection sources are private implementation details owned by a non-login
-- role. Anonymous application roles never receive these views because they
-- contain the internal identifiers needed to construct the safe projections.
GRANT SELECT (id,public_path,published_version_id,archived_at)
  ON knowledge_pages TO context_use_projection_owner;
GRANT SELECT (id,page_id,path,title,body_markdown,created_at)
  ON knowledge_page_versions TO context_use_projection_owner;
GRANT SELECT (
  id,public_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds,published_at,deleted_at
) ON assets TO context_use_projection_owner;

CREATE VIEW published_page_sources
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  page.id,
  page.public_path,
  page.published_version_id,
  version.path,
  version.title,
  version.body_markdown,
  version.created_at AS version_created_at
FROM knowledge_pages page
JOIN knowledge_page_versions version
  ON version.id=page.published_version_id AND version.page_id=page.id
WHERE page.published_version_id IS NOT NULL
  AND page.public_path IS NOT NULL
  AND page.archived_at IS NULL;

-- Resolve references inside the database boundary. Published targets become
-- public paths; private targets become inert labels. Neither anonymous role
-- nor the public renderer ever receives a UUID or private knowledge path.
CREATE FUNCTION project_public_markdown(p_public_path text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  p_body text;
  p_source_path text;
  projected text;
  matched text[];
  target_path text;
  label text;
  source_directory text;
BEGIN
  -- The executor can name only a page that is already public. Loading the raw
  -- body and private source path internally prevents the public EXECUTE grant
  -- required by the views from becoming an arbitrary private-path oracle.
  SELECT page.body_markdown,page.path
  INTO p_body,p_source_path
  FROM published_page_sources page
  WHERE page.public_path=p_public_path;
  IF NOT FOUND THEN RETURN ''; END IF;

  projected := regexp_replace(
    regexp_replace(coalesce(p_body,''),'<!--.*?-->','','gis'),
    '<!--.*$','','gis'
  );
  projected := regexp_replace(
    regexp_replace(projected,'<script([[:space:]][^>]*)?>.*?</script[[:space:]]*>','','gis'),
    '<script([[:space:]][^>]*)?>.*$','','gis'
  );
  projected := regexp_replace(
    regexp_replace(projected,'<style([[:space:]][^>]*)?>.*?</style[[:space:]]*>','','gis'),
    '<style([[:space:]][^>]*)?>.*$','','gis'
  );
  projected := regexp_replace(projected,'<[a-z!?/][^>]*(>|$)','','gis');

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(!\[([^]]*)\]\(context-use://asset/([0-9a-f-]{36})\)(\{[^}\r\n]*\})?)',
      'gi'
    )
  LOOP
    SELECT asset.public_path INTO target_path
    FROM assets asset
    WHERE asset.id=matched[3]::uuid
      AND asset.published_at IS NOT NULL
      AND asset.public_path IS NOT NULL
      AND asset.deleted_at IS NULL;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format(
             '![%s](context-use://public-asset/%s)%s',
             matched[2],target_path,coalesce(matched[4],'')
           )
      END
    );
  END LOOP;

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(context-use://page/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.id=matched[3]::uuid;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format('[%s](/p/%s)',matched[2],target_path)
      END
    );
  END LOOP;

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(/app/pages/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.id=matched[3]::uuid;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format('[%s](/p/%s)',matched[2],target_path)
      END
    );
  END LOOP;

  source_directory := regexp_replace(lower(p_source_path),'(^|/)[^/]+$','','');
  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[\[([a-z0-9][a-z0-9/_-]*)(\|([^]\r\n]+))?\]\])',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.path=lower(matched[2])
       OR page.path=concat_ws('/',nullif(source_directory,''),lower(matched[2]))
    ORDER BY
      CASE WHEN page.path=concat_ws('/',nullif(source_directory,''),lower(matched[2])) THEN 0 ELSE 1 END,
      page.path
    LIMIT 1;
    label := coalesce(
      nullif(btrim(matched[4]),''),
      CASE WHEN target_path IS NULL THEN 'Private page'
           ELSE regexp_replace(matched[2],'^.*/','')
      END
    );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN label
           ELSE format('[%s](/p/%s)',label,target_path)
      END
    );
  END LOOP;

  projected := regexp_replace(
    projected,'context-use://(page|asset)/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/app/pages/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/api/(dashboard|public)/assets/[0-9a-f-]{36}/content',
    '[private reference]','gi'
  );
  RETURN projected;
END;
$$;

-- The webpage role gets rendered source only: no UUIDs, version metadata,
-- private knowledge paths, hidden HTML, or unresolved stable references. A
-- compromise of that credential therefore cannot bypass the same disclosure
-- boundary enforced by the public HTTP renderer.
CREATE VIEW published_pages
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  page.public_path,
  page.title,
  project_public_markdown(page.public_path) AS body_markdown
FROM published_page_sources page;

-- The anonymous MCP role has no asset capability. Its separately executable
-- projector returns the same published page text but removes public asset
-- tokens, without granting that role the richer webpage projector.
CREATE FUNCTION project_public_mcp_markdown(p_public_path text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
RETURN regexp_replace(
  project_public_markdown(p_public_path),
  '!\[([^]]*)\]\(context-use://public-asset/[a-z0-9][a-z0-9/_-]*\)(\{[^}\r\n]*\})?',
  '\1','gi'
);

-- Public HTTP metadata contains only values observable while downloading an
-- independently published object. Integrity hashes, UUIDs, object keys,
-- dimensions, timestamps, and other storage metadata remain private.
CREATE VIEW published_assets
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  public_path,filename,content_type,size_bytes
FROM assets
WHERE published_at IS NOT NULL
  AND public_path IS NOT NULL
  AND deleted_at IS NULL;

-- Only the storage broker can translate a public path into an object key.
CREATE VIEW storage_published_assets
WITH (security_barrier=true,security_invoker=false)
AS
SELECT public_path,s3_object_key
FROM assets
WHERE published_at IS NOT NULL
  AND public_path IS NOT NULL
  AND deleted_at IS NULL;

-- Anonymous MCP reuses the already-lossy webpage projection and adds public
-- hierarchy only. It cannot select either private projection source.
CREATE VIEW public_mcp_pages
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  child.public_path,
  child.title,
  project_public_mcp_markdown(child.public_path) AS body_markdown,
  parent.public_path AS parent_path
FROM published_page_sources child
LEFT JOIN LATERAL (
  SELECT candidate.public_path
  FROM published_page_sources candidate
  WHERE left(child.public_path,length(candidate.public_path)+1)=candidate.public_path || '/'
  ORDER BY length(candidate.public_path) DESC,
           candidate.public_path
  LIMIT 1
) parent ON true;

GRANT CREATE ON SCHEMA public TO context_use_projection_owner;
ALTER VIEW published_page_sources OWNER TO context_use_projection_owner;
ALTER FUNCTION project_public_markdown(text) OWNER TO context_use_projection_owner;
ALTER FUNCTION project_public_mcp_markdown(text) OWNER TO context_use_projection_owner;
ALTER VIEW published_pages OWNER TO context_use_projection_owner;
ALTER VIEW published_assets OWNER TO context_use_projection_owner;
ALTER VIEW storage_published_assets OWNER TO context_use_projection_owner;
ALTER VIEW public_mcp_pages OWNER TO context_use_projection_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_projection_owner;
REVOKE ALL ON FUNCTION project_public_markdown(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_public_mcp_markdown(text) FROM PUBLIC;

-- These procedures are the only application-accessible private-to-public and
-- passkey-confirmed export transitions. Their owner is deliberately not the
-- PostgreSQL administrator and cannot log in.
CREATE FUNCTION issue_confirmation_challenge(
  p_intent_kind confirmation_intent_kind,
  p_intent_id uuid,
  p_challenge text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent_challenge text;
  intent_expires_at timestamptz;
  intent_inactive boolean;
BEGIN
  IF p_intent_kind IS NULL OR p_intent_id IS NULL OR p_challenge IS NULL
     OR p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' THEN
    RAISE EXCEPTION 'valid confirmation challenge required' USING ERRCODE='22023';
  END IF;

  IF p_intent_kind='publication' THEN
    SELECT challenge,expires_at,consumed_at IS NOT NULL
    INTO intent_challenge,intent_expires_at,intent_inactive
    FROM publication_intents
    WHERE id=p_intent_id
    FOR UPDATE;
  ELSE
    SELECT challenge,expires_at,confirmed_at IS NOT NULL OR download_started_at IS NOT NULL
    INTO intent_challenge,intent_expires_at,intent_inactive
    FROM knowledge_export_intents
    WHERE id=p_intent_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'confirmation intent not found' USING ERRCODE='P0002'; END IF;
  IF intent_inactive OR intent_expires_at<=now() THEN
    RAISE EXCEPTION 'confirmation intent is inactive' USING ERRCODE='22023';
  END IF;
  IF intent_challenge IS NOT NULL THEN
    RAISE EXCEPTION 'confirmation challenge already issued' USING ERRCODE='23505';
  END IF;

  INSERT INTO confirmation_challenges(intent_kind,intent_id,challenge)
  VALUES (p_intent_kind,p_intent_id,p_challenge);
  IF p_intent_kind='publication' THEN
    UPDATE publication_intents SET challenge=p_challenge WHERE id=p_intent_id;
  ELSE
    UPDATE knowledge_export_intents SET challenge=p_challenge WHERE id=p_intent_id;
  END IF;
END;
$$;

CREATE FUNCTION consume_confirmation_challenge(
  p_intent_kind confirmation_intent_kind,
  p_intent_id uuid,
  p_challenge text,
  p_owner_user_id text,
  p_credential_id text,
  p_expected_counter integer,
  p_new_counter integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  stored_counter integer;
BEGIN
  IF p_challenge IS NULL OR p_owner_user_id IS NULL OR p_credential_id IS NULL
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified passkey assertion required' USING ERRCODE='42501';
  END IF;

  SELECT counter INTO stored_counter
  FROM passkey
  WHERE "userId"=p_owner_user_id AND "credentialID"=p_credential_id
  FOR UPDATE;
  IF NOT FOUND OR stored_counter IS DISTINCT FROM p_expected_counter THEN
    RAISE EXCEPTION 'passkey counter changed during confirmation' USING ERRCODE='40001';
  END IF;
  IF p_new_counter<0
     OR ((stored_counter>0 OR p_new_counter>0) AND p_new_counter<=stored_counter) THEN
    RAISE EXCEPTION 'passkey counter did not advance' USING ERRCODE='42501';
  END IF;

  UPDATE confirmation_challenges
  SET consumed_at=now()
  WHERE intent_kind=p_intent_kind AND intent_id=p_intent_id
    AND challenge=p_challenge AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmation challenge is missing or consumed' USING ERRCODE='23505';
  END IF;

  UPDATE passkey SET counter=p_new_counter
  WHERE "userId"=p_owner_user_id AND "credentialID"=p_credential_id;
END;
$$;

CREATE FUNCTION confirm_publication_intent(
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
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified publication principal required' USING ERRCODE='42501';
  END IF;

  SELECT
    id,action,target_kind,target_id,version_id,public_path,
    owner_user_id,session_id,challenge,expires_at,consumed_at
  INTO intent
  FROM publication_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'publication intent already consumed' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'publication intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'publication intent principal mismatch' USING ERRCODE='42501';
  END IF;
  IF intent.challenge IS NULL THEN
    RAISE EXCEPTION 'publication challenge not issued' USING ERRCODE='42501';
  END IF;

  PERFORM consume_confirmation_challenge(
    'publication',intent.id,intent.challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  IF intent.target_kind='page' THEN
    IF intent.action IN ('publish','republish') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM knowledge_page_versions version
        JOIN knowledge_pages page ON page.id=version.page_id
        WHERE version.id=intent.version_id
          AND version.page_id=intent.target_id
          AND (
            version.path=intent.public_path
            OR page.required_public_path=intent.public_path
          )
      ) THEN
        RAISE EXCEPTION 'page version or public path mismatch' USING ERRCODE='23503';
      END IF;
      UPDATE knowledge_pages
      SET published_version_id=intent.version_id,
          public_path=intent.public_path,
          updated_at=now()
      WHERE id=intent.target_id AND archived_at IS NULL;
    ELSE
      UPDATE knowledge_pages
      SET published_version_id=NULL,public_path=NULL,updated_at=now()
      WHERE id=intent.target_id;
    END IF;
  ELSE
    IF intent.action IN ('publish','republish') THEN
      UPDATE assets
      SET published_at=now(),public_path=intent.public_path
      WHERE id=intent.target_id
        AND deleted_at IS NULL
        AND current_path=intent.public_path;
    ELSE
      UPDATE assets
      SET published_at=NULL,public_path=NULL
      WHERE id=intent.target_id;
    END IF;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE='P0002'; END IF;
  UPDATE publication_intents SET consumed_at=now() WHERE id=intent.id;
END;
$$;

CREATE FUNCTION confirm_knowledge_export_intent(
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
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified export principal required' USING ERRCODE='42501';
  END IF;

  SELECT
    id,owner_user_id,session_id,challenge,expires_at,
    confirmed_at,download_started_at
  INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge export intent not found' USING ERRCODE='P0002';
  END IF;
  IF intent.confirmed_at IS NOT NULL OR intent.download_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge export intent already used' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge export intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge export principal mismatch' USING ERRCODE='42501';
  END IF;
  IF intent.challenge IS NULL THEN
    RAISE EXCEPTION 'knowledge export challenge not issued' USING ERRCODE='42501';
  END IF;

  PERFORM consume_confirmation_challenge(
    'knowledge_export',intent.id,intent.challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  UPDATE knowledge_export_intents
  SET confirmed_at=now(),credential_id=p_credential_id
  WHERE id=p_intent_id;
END;
$$;

CREATE FUNCTION claim_knowledge_export_download(
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
    id,owner_user_id,session_id,expires_at,confirmed_at,download_started_at
  INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge export intent not found' USING ERRCODE='P0002';
  END IF;
  IF intent.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'knowledge export passkey confirmation required' USING ERRCODE='42501';
  END IF;
  IF intent.download_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge export download already started' USING ERRCODE='23505';
  END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'knowledge export intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'knowledge export principal mismatch' USING ERRCODE='42501';
  END IF;

  UPDATE knowledge_export_intents
  SET download_started_at=now()
  WHERE id=p_intent_id;
END;
$$;

GRANT SELECT (
  id,action,target_kind,target_id,version_id,public_path,owner_user_id,
  session_id,challenge,expires_at,consumed_at
) ON publication_intents TO context_use_boundary_owner;
GRANT UPDATE (challenge,consumed_at)
  ON publication_intents TO context_use_boundary_owner;
GRANT SELECT (id,page_id,path)
  ON knowledge_page_versions TO context_use_boundary_owner;
GRANT SELECT (id,required_public_path,archived_at)
  ON knowledge_pages TO context_use_boundary_owner;
GRANT UPDATE (published_version_id,public_path,updated_at)
  ON knowledge_pages TO context_use_boundary_owner;
GRANT SELECT (id,current_path,deleted_at)
  ON assets TO context_use_boundary_owner;
GRANT UPDATE (published_at,public_path)
  ON assets TO context_use_boundary_owner;
GRANT SELECT (
  id,owner_user_id,session_id,challenge,expires_at,confirmed_at,
  download_started_at
) ON knowledge_export_intents TO context_use_boundary_owner;
GRANT UPDATE (challenge,confirmed_at,credential_id,download_started_at)
  ON knowledge_export_intents TO context_use_boundary_owner;
GRANT SELECT (intent_kind,intent_id,challenge,consumed_at)
  ON confirmation_challenges TO context_use_boundary_owner;
GRANT INSERT (intent_kind,intent_id,challenge)
  ON confirmation_challenges TO context_use_boundary_owner;
GRANT UPDATE (consumed_at)
  ON confirmation_challenges TO context_use_boundary_owner;
GRANT SELECT ("userId","credentialID",counter)
  ON passkey TO context_use_boundary_owner;
GRANT UPDATE (counter) ON passkey TO context_use_boundary_owner;

GRANT CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION consume_confirmation_challenge(confirmation_intent_kind,uuid,text,text,text,integer,integer)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION confirm_publication_intent(uuid,text,text,text,integer,integer)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION confirm_knowledge_export_intent(uuid,text,text,text,integer,integer)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION claim_knowledge_export_download(uuid,text,text)
  OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

REVOKE ALL ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_confirmation_challenge(confirmation_intent_kind,uuid,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_publication_intent(uuid,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_knowledge_export_intent(uuid,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_knowledge_export_download(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION confirm_publication_intent(uuid,text,text,text,integer,integer)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION confirm_knowledge_export_intent(uuid,text,text,text,integer,integer)
  TO context_use_confirmation;
GRANT EXECUTE ON FUNCTION claim_knowledge_export_download(uuid,text,text)
  TO context_use_confirmation;

GRANT SELECT (
  id,name,"publicKey","userId","credentialID",counter,transports,"createdAt"
) ON passkey TO context_use_confirmation;
GRANT SELECT (
  id,action,target_kind,target_id,version_id,public_path,owner_user_id,
  session_id,challenge,payload_hash,expires_at,consumed_at
) ON publication_intents TO context_use_confirmation;
GRANT SELECT (
  id,owner_user_id,session_id,challenge,expires_at,confirmed_at,
  credential_id,download_started_at
) ON knowledge_export_intents TO context_use_confirmation;

-- Application-role capability manifest. Keep grants column-scoped wherever a
-- role mutates state so a future column is private until explicitly reviewed.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_version_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_key_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_pages_private() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_required_public_page_intent() FROM PUBLIC;

GRANT SELECT,INSERT,UPDATE (name,image,"updatedAt") ON "user" TO context_use_auth;
GRANT SELECT,INSERT,UPDATE (counter) ON passkey TO context_use_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON
  "session",
  account,
  verification,
  jwks,
  "oauthClient",
  "oauthRefreshToken",
  "oauthAccessToken",
  "oauthConsent",
  "oauthResource",
  "oauthClientResource",
  "oauthClientAssertion",
  mcp_client_usage
TO context_use_auth;

GRANT SELECT ON
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  publication_intents,
  agent_skills,
  agent_skill_versions,
  cron_schedules,
  automation_versions,
  automation_runs,
  inbound_messages,
  knowledge_export_intents,
  knowledge_export_pages,
  knowledge_export_assets
TO context_use_dashboard;
GRANT INSERT (id,current_path,current_version_id)
  ON knowledge_pages TO context_use_dashboard;
GRANT UPDATE (current_path,current_version_id,updated_at,archived_at)
  ON knowledge_pages TO context_use_dashboard;
GRANT INSERT (
  id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
) ON knowledge_page_versions TO context_use_dashboard;
GRANT INSERT ON knowledge_asset_links TO context_use_dashboard;
GRANT INSERT (
  id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds
) ON assets TO context_use_dashboard;
GRANT UPDATE (current_path,filename,deleted_at) ON assets TO context_use_dashboard;
GRANT INSERT (
  id,action,target_kind,target_id,version_id,public_path,owner_user_id,
  session_id,payload_hash,expires_at
) ON publication_intents TO context_use_dashboard;
GRANT INSERT (id,name,current_version_id) ON agent_skills TO context_use_dashboard;
GRANT UPDATE (current_version_id,updated_at,deleted_at)
  ON agent_skills TO context_use_dashboard;
GRANT INSERT (
  id,skill_id,version_number,instructions_markdown,description,
  commit_message,actor_kind,actor_subject
) ON agent_skill_versions TO context_use_dashboard;
GRANT INSERT (
  id,name,cron_expression,timezone,input,enabled,next_run_at,
  automation_key,current_version_id
) ON cron_schedules TO context_use_dashboard;
GRANT UPDATE (
  name,cron_expression,timezone,input,enabled,next_run_at,current_version_id,
  updated_at,deleted_at
) ON cron_schedules TO context_use_dashboard;
GRANT INSERT (
  id,automation_id,version_number,instructions_markdown,
  commit_message,actor_kind,actor_subject
) ON automation_versions TO context_use_dashboard;
GRANT INSERT (id,schedule_id,automation_version_id,scheduled_for,input)
  ON automation_runs TO context_use_dashboard;
GRANT INSERT (id,owner_user_id,session_id,expires_at)
  ON knowledge_export_intents TO context_use_dashboard;
GRANT INSERT ON knowledge_export_pages,knowledge_export_assets
  TO context_use_dashboard;
GRANT DELETE ON knowledge_export_intents TO context_use_dashboard;

GRANT SELECT ON
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  agent_skills,
  agent_skill_versions,
  cron_schedules,
  automation_versions,
  automation_runs
TO context_use_mcp;
GRANT INSERT (id,current_path,current_version_id,automation_id)
  ON knowledge_pages TO context_use_mcp;
GRANT UPDATE (current_path,current_version_id,updated_at,archived_at)
  ON knowledge_pages TO context_use_mcp;
GRANT INSERT (
  id,page_id,version_number,path,title,body_markdown,commit_message,actor_kind,actor_subject
) ON knowledge_page_versions TO context_use_mcp;
GRANT INSERT ON knowledge_asset_links TO context_use_mcp;
GRANT INSERT (
  id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds
) ON assets TO context_use_mcp;
GRANT INSERT (id,name,current_version_id) ON agent_skills TO context_use_mcp;
GRANT INSERT (
  id,skill_id,version_number,instructions_markdown,description,
  commit_message,actor_kind,actor_subject
) ON agent_skill_versions TO context_use_mcp;
GRANT INSERT (
  id,name,cron_expression,timezone,input,enabled,next_run_at,
  automation_key,current_version_id
) ON cron_schedules TO context_use_mcp;
GRANT UPDATE (next_run_at,updated_at) ON cron_schedules TO context_use_mcp;
GRANT INSERT (
  id,automation_id,version_number,instructions_markdown,
  commit_message,actor_kind,actor_subject
) ON automation_versions TO context_use_mcp;
GRANT INSERT (id,schedule_id,automation_version_id,scheduled_for,input)
  ON automation_runs TO context_use_mcp;
GRANT UPDATE (
  status,attempt_count,claimed_by,claim_token,claimed_at,lease_expires_at,
  completed_at,result_summary,error_message
) ON automation_runs TO context_use_mcp;

GRANT SELECT ON published_pages,published_assets TO context_use_public;
GRANT EXECUTE ON FUNCTION project_public_markdown(text)
  TO context_use_public;

-- The storage broker already controls every asset byte. This metadata-only
-- capability lets it authorize an immutable write against the database row
-- and recheck anonymous reads without granting any knowledge-page access.
GRANT SELECT (
  id,s3_object_key,filename,content_type,size_bytes,content_hash,deleted_at
) ON assets TO context_use_storage;
GRANT SELECT ON storage_published_assets TO context_use_storage;

GRANT SELECT ON public_mcp_pages TO context_use_public_mcp;
GRANT EXECUTE ON FUNCTION project_public_mcp_markdown(text)
  TO context_use_public_mcp;
GRANT INSERT (id,reply_to,message) ON inbound_messages TO context_use_public_mcp;

GRANT SELECT ON
  schema_migrations,
  "user",
  "session",
  account,
  verification,
  jwks,
  passkey,
  "oauthClient",
  "oauthRefreshToken",
  "oauthAccessToken",
  "oauthConsent",
  "oauthResource",
  "oauthClientResource",
  "oauthClientAssertion",
  mcp_client_usage,
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  publication_intents,
  agent_skills,
  agent_skill_versions,
  cron_schedules,
  automation_versions,
  automation_runs,
  inbound_messages,
  knowledge_export_intents,
  confirmation_challenges,
  knowledge_export_pages,
  knowledge_export_assets,
  published_pages,
  published_assets,
  public_mcp_pages
TO context_use_backup;
