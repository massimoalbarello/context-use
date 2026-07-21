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
    'GRANT CONNECT ON DATABASE %I TO context_use_auth,context_use_dashboard,context_use_mcp,context_use_public,context_use_confirmation,context_use_storage,context_use_backup',
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
CREATE TYPE publication_action AS ENUM ('publish','unpublish');
CREATE TYPE publication_target AS ENUM ('page','asset');
CREATE TYPE confirmation_intent_kind AS ENUM ('publication','knowledge_export','page_deletion');

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

-- Directories are first-class, linkable resources. Their rendered index is a
-- live projection of direct child directories and pages rather than stored
-- Markdown that can become stale.
CREATE FUNCTION directory_search_vector(
  p_path text,p_title text,p_summary text,p_intro_markdown text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog
RETURN (
  setweight(to_tsvector('simple',coalesce(p_path,'')),'A')
  || setweight(to_tsvector('simple',coalesce(p_title,'')),'A')
  || setweight(to_tsvector('english',coalesce(p_summary,'')),'A')
  || setweight(to_tsvector('english',coalesce(p_intro_markdown,'')),'B')
);

CREATE TABLE knowledge_directories (
  id uuid PRIMARY KEY,
  current_path text NOT NULL UNIQUE,
  parent_path text GENERATED ALWAYS AS (
    CASE
      WHEN current_path='' THEN NULL
      WHEN strpos(current_path,'/')=0 THEN ''
      ELSE regexp_replace(current_path,'/[^/]+$','')
    END
  ) STORED,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number>0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  summary text NOT NULL CHECK (
    length(trim(summary)) BETWEEN 1 AND 320 AND summary !~ E'[\r\n]'
  ),
  intro_markdown text NOT NULL DEFAULT '' CHECK (octet_length(intro_markdown)<=4000000),
  search_vector tsvector NOT NULL DEFAULT ''::tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_directories_path_format CHECK (
    current_path='' OR (
      current_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND current_path !~ '//'
      AND right(current_path,1)<>'/'
    )
  ),
  CONSTRAINT knowledge_directories_parent_fk
    FOREIGN KEY (parent_path) REFERENCES knowledge_directories(current_path)
    ON DELETE RESTRICT
);
CREATE INDEX knowledge_directories_parent_idx ON knowledge_directories(parent_path);
CREATE INDEX knowledge_directories_search_idx ON knowledge_directories USING gin(search_vector);

CREATE FUNCTION page_search_vector(
  p_path text,p_title text,p_summary text,p_body_markdown text
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path=pg_catalog
RETURN (
  setweight(to_tsvector('simple',coalesce(p_path,'')),'A')
  || setweight(to_tsvector('simple',coalesce(p_title,'')),'A')
  || setweight(to_tsvector('english',coalesce(p_summary,'')),'A')
  || setweight(to_tsvector('english',coalesce(p_body_markdown,'')),'B')
);

-- Private knowledge and immutable page history.
CREATE TABLE knowledge_pages (
  id uuid PRIMARY KEY,
  current_path text NOT NULL,
  parent_path text GENERATED ALWAYS AS (
    CASE
      WHEN strpos(current_path,'/')=0 THEN ''
      ELSE regexp_replace(current_path,'/[^/]+$','')
    END
  ) STORED,
  current_version_id uuid NOT NULL,
  published_version_id uuid,
  public_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  automation_id uuid,
  search_vector tsvector NOT NULL DEFAULT ''::tsvector,
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
  CONSTRAINT knowledge_pages_published_active CHECK (
    published_version_id IS NULL OR archived_at IS NULL
  ),
  CONSTRAINT knowledge_pages_parent_fk
    FOREIGN KEY (parent_path) REFERENCES knowledge_directories(current_path)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX knowledge_pages_active_path_unique
  ON knowledge_pages(current_path) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX knowledge_pages_public_path_unique
  ON knowledge_pages(public_path) WHERE public_path IS NOT NULL;
CREATE INDEX knowledge_pages_automation_idx
  ON knowledge_pages(automation_id,current_path) WHERE automation_id IS NOT NULL;
CREATE INDEX knowledge_pages_parent_idx
  ON knowledge_pages(parent_path) WHERE archived_at IS NULL;
CREATE INDEX knowledge_pages_search_idx
  ON knowledge_pages USING gin(search_vector);

CREATE TABLE knowledge_page_versions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number>0),
  path text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  summary text NOT NULL CHECK (
    length(trim(summary)) BETWEEN 1 AND 320 AND summary !~ E'[\r\n]'
  ),
  body_markdown text NOT NULL CHECK (octet_length(body_markdown)<=4000000),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_page_versions_path_format CHECK (
    path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND path !~ '//'
    AND right(path,1)<>'/'
  ),
  UNIQUE (page_id,version_number),
  UNIQUE (id,page_id)
);
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

CREATE FUNCTION enforce_current_page_version_path()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
DECLARE
  version_path text;
BEGIN
  SELECT path INTO version_path
  FROM knowledge_page_versions
  WHERE id=NEW.current_version_id AND page_id=NEW.id;
  IF FOUND AND version_path IS DISTINCT FROM NEW.current_path THEN
    RAISE EXCEPTION 'current page path must match its current version path'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER knowledge_pages_current_version_path
AFTER INSERT OR UPDATE OF current_path,current_version_id ON knowledge_pages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_current_page_version_path();

CREATE FUNCTION prevent_knowledge_path_collision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.current_path,0));
  IF TG_TABLE_NAME='knowledge_directories' THEN
    IF NEW.current_path<>'' AND EXISTS (
      SELECT 1 FROM knowledge_pages
      WHERE current_path=NEW.current_path AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'knowledge path is already used by a page' USING ERRCODE='23505';
    END IF;
  ELSIF NEW.archived_at IS NULL AND EXISTS (
    SELECT 1 FROM knowledge_directories WHERE current_path=NEW.current_path
  ) THEN
    RAISE EXCEPTION 'knowledge path is already used by a directory' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_directories_path_collision
BEFORE INSERT OR UPDATE OF current_path ON knowledge_directories
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_path_collision();
CREATE TRIGGER knowledge_pages_path_collision
BEFORE INSERT OR UPDATE OF current_path,archived_at ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION prevent_knowledge_path_collision();

-- The root guide is the durable entry point for every agent. Its contents are
-- ordinary versioned knowledge, but the page itself must always remain active
-- at the stable root path used by get_knowledge_base_guide.
CREATE FUNCTION protect_root_knowledge_guide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.current_path='agents' THEN
      RAISE EXCEPTION 'the root AGENTS.md page cannot be deleted'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.current_path='agents'
     AND (NEW.current_path IS DISTINCT FROM 'agents' OR NEW.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the root AGENTS.md page must remain active at agents'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_pages_keep_root_guide
BEFORE UPDATE OF current_path,archived_at ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION protect_root_knowledge_guide();
CREATE TRIGGER knowledge_pages_prevent_root_guide_deletion
BEFORE DELETE ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION protect_root_knowledge_guide();

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
  CONSTRAINT assets_published_active CHECK (
    public_path IS NULL OR deleted_at IS NULL
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

-- Automations are private capabilities available to the owner and
-- owner-authorized private MCP clients only. Skills use ordinary knowledge
-- pages under skills/<skill-name>.
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
  current_version_id uuid NOT NULL,
  instructions_page_id uuid NOT NULL
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

ALTER TABLE cron_schedules
  ADD CONSTRAINT cron_schedules_instructions_page_fk
  FOREIGN KEY (instructions_page_id)
  REFERENCES knowledge_pages(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

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
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
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
      action='publish' AND public_path IS NOT NULL
      AND (
        (target_kind='page' AND version_id IS NOT NULL)
        OR (target_kind='asset' AND version_id IS NULL)
      )
    )
  )
);
CREATE INDEX publication_intents_expiry_idx
  ON publication_intents(expires_at);

-- Run output remains publishable through the owner's passkey flow. Only the
-- workflow definition itself is permanently private.
CREATE FUNCTION keep_automation_instruction_pages_private()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.target_kind='page'
     AND NEW.action='publish'
     AND EXISTS (
       SELECT 1 FROM cron_schedules
       WHERE instructions_page_id=NEW.target_id
     ) THEN
    RAISE EXCEPTION 'automation instruction pages cannot be published'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_keep_automation_instructions_private
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION keep_automation_instruction_pages_private();

CREATE TABLE knowledge_export_intents (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  download_started_at timestamptz,
  CONSTRAINT knowledge_export_intents_owner CHECK (owner_user_id='context-use-owner'),
  CONSTRAINT knowledge_export_intents_expiry CHECK (
    expires_at>created_at AND expires_at<=created_at+interval '5 minutes'
  ),
  CONSTRAINT knowledge_export_intents_confirmation CHECK (
    confirmed_at IS NOT NULL OR download_started_at IS NULL
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
  PRIMARY KEY (intent_kind,intent_id)
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

  IF owner_automation_key IS NULL THEN
    RAISE EXCEPTION 'automation page has no owning automation'
      USING ERRCODE='23514';
  END IF;

  IF NEW.current_path ~ '^automations(/|$)'
     AND NEW.current_path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
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
  ELSIF owner_automation_key IS NULL THEN
    RAISE EXCEPTION 'automation page has no owning automation'
      USING ERRCODE='23514';
  ELSIF NEW.path ~ '^automations(/|$)'
     AND NEW.path NOT LIKE ('automations/' || owner_automation_key || '/%') THEN
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

INSERT INTO knowledge_directories(
  id,current_path,title,summary,intro_markdown,search_vector
) VALUES
  (
    gen_random_uuid(),'','Knowledge',
    'The root of the owner''s private, progressively discoverable knowledge base.','',
    directory_search_vector('','Knowledge','The root of the owner''s private, progressively discoverable knowledge base.','')
  ),
  (
    gen_random_uuid(),'automations','Automations',
    'Private instructions and durable outputs created by scheduled automations.','',
    directory_search_vector('automations','Automations','Private instructions and durable outputs created by scheduled automations.','')
  );

-- The bootstrap guide tells agents how to structure owner context. It remains
-- private until the owner chooses to publish an independently created page.
DO $$
DECLARE
  agents_page_id uuid := gen_random_uuid();
  agents_version_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
  VALUES (
    agents_page_id,'agents',agents_version_id,
    page_search_vector(
      'agents','AGENTS.md',
      'The global editorial and structural rules for maintaining this knowledge base.',
      $guide$
# Knowledge base structure

This knowledge base should develop into a durable hypermedia representation of the owner's life, work, interests, and thinking. Design it from the beginning as though it will eventually contain more than 100,000 pages.

## Organizing knowledge

- Prefer many small, focused pages over long documents that combine unrelated subjects. A page should represent the smallest coherent unit that is useful to read, retrieve, or link independently, not merely an isolated fact.
- Organize pages into meaningful, multi-level directories. Give each page one canonical location based on its primary subject; use links to express relationships that cross the directory hierarchy.
- Avoid catch-all pages and directories. When a page begins covering several independently meaningful subjects, split it and connect the resulting pages.
- Keep pages understandable on their own, but do not leave them isolated. Link related people, places, periods, experiences, projects, ideas, decisions, and works using internal knowledge links.
- Avoid repeating background information across pages. Preserve it in its own page and link to it from every relevant context.
- Give every page a concise, one-sentence summary. Summaries are required because the framework uses them to generate directory indexes and search results.

Store information whose subject is the owner under `about/`. Create `about/intro` if it is missing and keep it as the concise introduction people and agents should read first.

Store other entities in separate top-level directories, such as `people/`, `companies/`, `places/`, `events/`, and `works/`. Link those entities to the owner's experiences instead of nesting them under `about/`.

## Preserve the story

The knowledge base should tell a connected story, not merely accumulate facts.

When relevant, record when and where something happened, who or what was involved, what preceded it, why it mattered, and what followed from it. Connect experiences to the work, relationships, places, ideas, books, music, and other influences surrounding them.

Make temporal, spatial, and causal relationships visible through links. Use timelines and authored overview pages to provide narrative paths through the smaller source pages. Do not invent motivations or causal relationships: record them when known and clearly distinguish the owner's account from an agent's inference.

## Progressive discovery

Every directory is a first-class, linkable resource with a title, one-sentence summary, and optional Markdown introduction. Its index is generated automatically from its immediate child directories and active pages.

Indexes describe direct children only. Agents should explore progressively, beginning with the root directory and following increasingly specific directory indexes. Do not create or manually maintain `index` pages; the framework keeps indexes current when knowledge changes.

Generated indexes are navigational aids, not substitutes for authored overview pages, timelines, or other pages that explain narrative and causal relationships.

Publishing a page automatically makes its directory ancestry navigable through framework-generated public indexes. Public indexes use the exact published page titles and summaries, include only branches with published descendants, and never reveal private sibling pages or private directory introductions.

## Local directory guides

The root `AGENTS.md` is required and applies throughout the knowledge base. A directory may contain an `AGENTS.md` page when it needs conventions that cannot be inferred from its name, index, and surrounding structure. Store a local guide at `<directory>/agents` with the title `AGENTS.md`; the URL-safe path omits the extension. Local guides are optional and should refine the root rules rather than repeat them.

Before creating or updating knowledge, read any `AGENTS.md` pages exposed by the directory indexes from the root through the target page's parent directory.

Create a local guide when a directory has special inclusion criteria, naming conventions, page templates, granularity requirements, required relationships, or other rules that agents need in order to add knowledge consistently.

## Privacy

Knowledge is private by default. If the owner wants the landing page to introduce them, ask them to review and publish `about/intro`; an agent cannot publish it.

## Skills

- Discover reusable Agent Skills by exploring the `skills/` directory.
- Store each skill at the stable semantic path `skills/<skill-name>`.
- The page body is the complete standard `SKILL.md`: YAML frontmatter with `name` and `description`, followed by the skill instructions. Use the frontmatter to decide whether a skill is relevant before following its instructions.
- Create, update, and archive skills with the ordinary page tools; page history and commit messages provide versioning.
$guide$
    )
  );

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
  ) VALUES (
    agents_version_id,agents_page_id,1,'agents','AGENTS.md',
    'The global editorial and structural rules for maintaining this knowledge base.',
    $guide$
# Knowledge base structure

This knowledge base should develop into a durable hypermedia representation of the owner's life, work, interests, and thinking. Design it from the beginning as though it will eventually contain more than 100,000 pages.

## Organizing knowledge

- Prefer many small, focused pages over long documents that combine unrelated subjects. A page should represent the smallest coherent unit that is useful to read, retrieve, or link independently, not merely an isolated fact.
- Organize pages into meaningful, multi-level directories. Give each page one canonical location based on its primary subject; use links to express relationships that cross the directory hierarchy.
- Avoid catch-all pages and directories. When a page begins covering several independently meaningful subjects, split it and connect the resulting pages.
- Keep pages understandable on their own, but do not leave them isolated. Link related people, places, periods, experiences, projects, ideas, decisions, and works using internal knowledge links.
- Avoid repeating background information across pages. Preserve it in its own page and link to it from every relevant context.
- Give every page a concise, one-sentence summary. Summaries are required because the framework uses them to generate directory indexes and search results.

Store information whose subject is the owner under `about/`. Create `about/intro` if it is missing and keep it as the concise introduction people and agents should read first.

Store other entities in separate top-level directories, such as `people/`, `companies/`, `places/`, `events/`, and `works/`. Link those entities to the owner's experiences instead of nesting them under `about/`.

## Preserve the story

The knowledge base should tell a connected story, not merely accumulate facts.

When relevant, record when and where something happened, who or what was involved, what preceded it, why it mattered, and what followed from it. Connect experiences to the work, relationships, places, ideas, books, music, and other influences surrounding them.

Make temporal, spatial, and causal relationships visible through links. Use timelines and authored overview pages to provide narrative paths through the smaller source pages. Do not invent motivations or causal relationships: record them when known and clearly distinguish the owner's account from an agent's inference.

## Progressive discovery

Every directory is a first-class, linkable resource with a title, one-sentence summary, and optional Markdown introduction. Its index is generated automatically from its immediate child directories and active pages.

Indexes describe direct children only. Agents should explore progressively, beginning with the root directory and following increasingly specific directory indexes. Do not create or manually maintain `index` pages; the framework keeps indexes current when knowledge changes.

Generated indexes are navigational aids, not substitutes for authored overview pages, timelines, or other pages that explain narrative and causal relationships.

Publishing a page automatically makes its directory ancestry navigable through framework-generated public indexes. Public indexes use the exact published page titles and summaries, include only branches with published descendants, and never reveal private sibling pages or private directory introductions.

## Local directory guides

The root `AGENTS.md` is required and applies throughout the knowledge base. A directory may contain an `AGENTS.md` page when it needs conventions that cannot be inferred from its name, index, and surrounding structure. Store a local guide at `<directory>/agents` with the title `AGENTS.md`; the URL-safe path omits the extension. Local guides are optional and should refine the root rules rather than repeat them.

Before creating or updating knowledge, read any `AGENTS.md` pages exposed by the directory indexes from the root through the target page's parent directory.

Create a local guide when a directory has special inclusion criteria, naming conventions, page templates, granularity requirements, required relationships, or other rules that agents need in order to add knowledge consistently.

## Privacy

Knowledge is private by default. If the owner wants the landing page to introduce them, ask them to review and publish `about/intro`; an agent cannot publish it.

## Skills

- Discover reusable Agent Skills by exploring the `skills/` directory.
- Store each skill at the stable semantic path `skills/<skill-name>`.
- The page body is the complete standard `SKILL.md`: YAML frontmatter with `name` and `description`, followed by the skill instructions. Use the frontmatter to decide whether a skill is relevant before following its instructions.
- Create, update, and archive skills with the ordinary page tools; page history and commit messages provide versioning.
$guide$,
    'Create knowledge base guide','dashboard','context-use-bootstrap'
  );
END;
$$;

-- Projection sources are private implementation details owned by a non-login
-- role. Anonymous application roles never receive these views because they
-- contain the internal identifiers needed to construct the safe projections.
GRANT SELECT (id,public_path,published_version_id,archived_at)
  ON knowledge_pages TO context_use_projection_owner;
GRANT SELECT (id,page_id,path,title,summary,body_markdown,created_at)
  ON knowledge_page_versions TO context_use_projection_owner;
GRANT SELECT (id,current_path)
  ON knowledge_directories TO context_use_projection_owner;
GRANT SELECT (
  id,public_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds,deleted_at
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
  version.summary,
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
  target_href text;
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

  -- A directory reference becomes public only when its generated index has at
  -- least one published descendant. The projection never exposes private
  -- siblings or mutable directory metadata.
  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(context-use://directory/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT directory.current_path INTO target_path
    FROM knowledge_directories directory
    WHERE directory.id=matched[3]::uuid
      AND EXISTS (
        SELECT 1 FROM published_page_sources page
        WHERE directory.current_path=''
           OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
      );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           WHEN target_path='' THEN format('[%s](/i)',matched[2])
           ELSE format('[%s](/i/%s)',matched[2],target_path)
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

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(/app/directories/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT directory.current_path INTO target_path
    FROM knowledge_directories directory
    WHERE directory.id=matched[3]::uuid
      AND EXISTS (
        SELECT 1 FROM published_page_sources page
        WHERE directory.current_path=''
           OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
      );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           WHEN target_path='' THEN format('[%s](/i)',matched[2])
           ELSE format('[%s](/i/%s)',matched[2],target_path)
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
    target_href := CASE WHEN target_path IS NULL THEN NULL ELSE format('/p/%s',target_path) END;
    IF target_href IS NULL THEN
      SELECT directory.current_path INTO target_path
      FROM knowledge_directories directory
      WHERE (
          directory.current_path=lower(matched[2])
          OR directory.current_path=concat_ws('/',nullif(source_directory,''),lower(matched[2]))
        )
        AND EXISTS (
          SELECT 1 FROM published_page_sources page
          WHERE directory.current_path=''
             OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
        )
      ORDER BY
        CASE WHEN directory.current_path=concat_ws('/',nullif(source_directory,''),lower(matched[2])) THEN 0 ELSE 1 END,
        directory.current_path
      LIMIT 1;
      target_href := CASE WHEN target_path IS NULL THEN NULL
                          WHEN target_path='' THEN '/i'
                          ELSE format('/i/%s',target_path)
                     END;
    END IF;
    label := coalesce(
      nullif(btrim(matched[4]),''),
      CASE WHEN target_href IS NULL THEN 'Private page'
           ELSE regexp_replace(matched[2],'^.*/','')
      END
    );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_href IS NULL THEN label
           ELSE format('[%s](%s)',label,target_href)
      END
    );
  END LOOP;

  projected := regexp_replace(
    projected,'context-use://(page|directory|asset)/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/app/(pages|directories)/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/api/(dashboard|mcp|public)/assets/[0-9a-f-]{36}(/(content|status))?',
    '[private asset reference]','gi'
  );
  -- Last-resort identifier minimization covers legacy/absolute URL shapes and
  -- malformed references that do not match any supported Markdown construct.
  projected := regexp_replace(
    projected,'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '[private identifier]','gi'
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
  page.summary,
  project_public_markdown(page.public_path) AS body_markdown
FROM published_page_sources page;

-- Public HTTP metadata contains only values observable while downloading an
-- independently published object. Integrity hashes, UUIDs, object keys,
-- dimensions, timestamps, and other storage metadata remain private.
CREATE VIEW published_assets
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  public_path,filename,content_type,size_bytes
FROM assets
WHERE public_path IS NOT NULL
  AND deleted_at IS NULL;

-- Only the storage broker can translate a public path into an object key.
CREATE VIEW storage_published_assets
WITH (security_barrier=true,security_invoker=false)
AS
SELECT public_path,s3_object_key
FROM assets
WHERE public_path IS NOT NULL
  AND deleted_at IS NULL;

GRANT CREATE ON SCHEMA public TO context_use_projection_owner;
ALTER VIEW published_page_sources OWNER TO context_use_projection_owner;
ALTER FUNCTION project_public_markdown(text) OWNER TO context_use_projection_owner;
ALTER VIEW published_pages OWNER TO context_use_projection_owner;
ALTER VIEW published_assets OWNER TO context_use_projection_owner;
ALTER VIEW storage_published_assets OWNER TO context_use_projection_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_projection_owner;
REVOKE ALL ON FUNCTION project_public_markdown(text) FROM PUBLIC;

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
  intent_expires_at timestamptz;
  intent_inactive boolean;
BEGIN
  IF p_intent_kind IS NULL OR p_intent_id IS NULL OR p_challenge IS NULL
     OR p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' THEN
    RAISE EXCEPTION 'valid confirmation challenge required' USING ERRCODE='22023';
  END IF;

  DELETE FROM publication_intents WHERE expires_at<=now();
  DELETE FROM knowledge_export_intents WHERE expires_at<=now();
  DELETE FROM confirmation_challenges challenge
  WHERE (
    challenge.intent_kind='publication'
    AND NOT EXISTS (SELECT 1 FROM publication_intents intent WHERE intent.id=challenge.intent_id)
  ) OR (
    challenge.intent_kind='knowledge_export'
    AND NOT EXISTS (SELECT 1 FROM knowledge_export_intents intent WHERE intent.id=challenge.intent_id)
  );

  IF p_intent_kind='publication' THEN
    SELECT expires_at,false
    INTO intent_expires_at,intent_inactive
    FROM publication_intents
    WHERE id=p_intent_id;
  ELSE
    SELECT expires_at,confirmed_at IS NOT NULL OR download_started_at IS NOT NULL
    INTO intent_expires_at,intent_inactive
    FROM knowledge_export_intents
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

  DELETE FROM confirmation_challenges
  WHERE intent_kind=p_intent_kind AND intent_id=p_intent_id
    AND challenge=p_challenge;
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
  intent_challenge text;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified publication principal required' USING ERRCODE='42501';
  END IF;

  SELECT
    id,action,target_kind,target_id,version_id,public_path,
    owner_user_id,session_id,expires_at
  INTO intent
  FROM publication_intents
  WHERE id=p_intent_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'publication intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'publication intent principal mismatch' USING ERRCODE='42501';
  END IF;
  SELECT challenge INTO intent_challenge
  FROM confirmation_challenges
  WHERE intent_kind='publication' AND intent_id=intent.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication challenge not issued' USING ERRCODE='42501';
  END IF;

  PERFORM consume_confirmation_challenge(
    'publication',intent.id,intent_challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  IF intent.target_kind='page' THEN
    IF intent.action='publish' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM knowledge_page_versions version
        JOIN knowledge_pages page ON page.id=version.page_id
        WHERE version.id=intent.version_id
          AND version.page_id=intent.target_id
          AND version.path=intent.public_path
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
    IF intent.action='publish' THEN
      UPDATE assets
      SET public_path=intent.public_path
      WHERE id=intent.target_id
        AND deleted_at IS NULL
        AND current_path=intent.public_path;
    ELSE
      UPDATE assets
      SET public_path=NULL
      WHERE id=intent.target_id;
    END IF;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE='P0002'; END IF;
  DELETE FROM publication_intents WHERE id=intent.id;
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
  intent_challenge text;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified export principal required' USING ERRCODE='42501';
  END IF;

  SELECT
    id,owner_user_id,session_id,expires_at,
    confirmed_at,download_started_at
  INTO intent
  FROM knowledge_export_intents
  WHERE id=p_intent_id;

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
  SELECT challenge INTO intent_challenge
  FROM confirmation_challenges
  WHERE intent_kind='knowledge_export' AND intent_id=intent.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge export challenge not issued' USING ERRCODE='42501';
  END IF;

  PERFORM consume_confirmation_challenge(
    'knowledge_export',intent.id,intent_challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  UPDATE knowledge_export_intents
  SET confirmed_at=now()
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
  session_id,expires_at
) ON publication_intents TO context_use_boundary_owner;
GRANT DELETE ON publication_intents TO context_use_boundary_owner;
GRANT SELECT (id,page_id,path)
  ON knowledge_page_versions TO context_use_boundary_owner;
GRANT SELECT (id,archived_at)
  ON knowledge_pages TO context_use_boundary_owner;
GRANT UPDATE (published_version_id,public_path,updated_at)
  ON knowledge_pages TO context_use_boundary_owner;
GRANT SELECT (id,current_path,deleted_at)
  ON assets TO context_use_boundary_owner;
GRANT UPDATE (public_path)
  ON assets TO context_use_boundary_owner;
GRANT SELECT (
  id,owner_user_id,session_id,expires_at,confirmed_at,
  download_started_at
) ON knowledge_export_intents TO context_use_boundary_owner;
GRANT UPDATE (confirmed_at,download_started_at)
  ON knowledge_export_intents TO context_use_boundary_owner;
GRANT DELETE ON knowledge_export_intents TO context_use_boundary_owner;
GRANT SELECT (intent_kind,intent_id,challenge)
  ON confirmation_challenges TO context_use_boundary_owner;
GRANT INSERT (intent_kind,intent_id,challenge)
  ON confirmation_challenges TO context_use_boundary_owner;
GRANT DELETE ON confirmation_challenges TO context_use_boundary_owner;
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
  session_id,expires_at
) ON publication_intents TO context_use_confirmation;
GRANT SELECT (
  id,owner_user_id,session_id,expires_at,confirmed_at,
  download_started_at
) ON knowledge_export_intents TO context_use_confirmation;
GRANT SELECT (intent_kind,intent_id,challenge)
  ON confirmation_challenges TO context_use_confirmation;

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

REVOKE ALL ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_confirmation_challenge(confirmation_intent_kind,uuid,text)
  TO context_use_confirmation;

-- Application-role capability manifest. Keep grants column-scoped wherever a
-- role mutates state so a future column is private until explicitly reviewed.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_current_page_version_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_knowledge_path_collision() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_root_knowledge_guide() FROM PUBLIC;
REVOKE ALL ON FUNCTION directory_search_vector(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION page_search_vector(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_automation_page_version_path() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_key_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_automation_instruction_pages_private() FROM PUBLIC;

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
  "oauthClientAssertion"
TO context_use_auth;

GRANT SELECT ON
  knowledge_directories,
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  publication_intents,
  cron_schedules,
  automation_versions,
  automation_runs,
  knowledge_export_intents
TO context_use_dashboard;
GRANT INSERT (id,current_path,title,summary,intro_markdown,search_vector)
  ON knowledge_directories TO context_use_dashboard;
GRANT UPDATE (title,summary,intro_markdown,version_number,search_vector,updated_at)
  ON knowledge_directories TO context_use_dashboard;
GRANT INSERT (id,current_path,current_version_id,automation_id,search_vector)
  ON knowledge_pages TO context_use_dashboard;
GRANT UPDATE (current_path,current_version_id,search_vector,updated_at,archived_at)
  ON knowledge_pages TO context_use_dashboard;
GRANT INSERT (
  id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
) ON knowledge_page_versions TO context_use_dashboard;
GRANT INSERT ON knowledge_asset_links TO context_use_dashboard;
GRANT INSERT (
  id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds
) ON assets TO context_use_dashboard;
GRANT UPDATE (deleted_at) ON assets TO context_use_dashboard;
GRANT INSERT (
  id,action,target_kind,target_id,version_id,public_path,owner_user_id,
  session_id,expires_at
) ON publication_intents TO context_use_dashboard;
GRANT INSERT (
  id,name,cron_expression,timezone,input,enabled,next_run_at,
  automation_key,current_version_id,instructions_page_id
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
GRANT DELETE ON knowledge_export_intents TO context_use_dashboard;
GRANT EXECUTE ON FUNCTION directory_search_vector(text,text,text,text)
  TO context_use_dashboard;
GRANT EXECUTE ON FUNCTION page_search_vector(text,text,text,text)
  TO context_use_dashboard;

GRANT SELECT ON
  knowledge_directories,
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  cron_schedules,
  automation_versions,
  automation_runs
TO context_use_mcp;
GRANT INSERT (id,current_path,title,summary,intro_markdown,search_vector)
  ON knowledge_directories TO context_use_mcp;
GRANT UPDATE (title,summary,intro_markdown,version_number,search_vector,updated_at)
  ON knowledge_directories TO context_use_mcp;
GRANT INSERT (id,current_path,current_version_id,automation_id,search_vector)
  ON knowledge_pages TO context_use_mcp;
GRANT UPDATE (current_path,current_version_id,search_vector,updated_at,archived_at)
  ON knowledge_pages TO context_use_mcp;
GRANT INSERT (
  id,page_id,version_number,path,title,summary,body_markdown,commit_message,actor_kind,actor_subject
) ON knowledge_page_versions TO context_use_mcp;
GRANT INSERT ON knowledge_asset_links TO context_use_mcp;
GRANT INSERT (
  id,current_path,filename,content_type,size_bytes,content_hash,s3_object_key,
  width,height,duration_seconds
) ON assets TO context_use_mcp;
GRANT INSERT (
  id,name,cron_expression,timezone,input,enabled,next_run_at,
  automation_key,current_version_id,instructions_page_id
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
GRANT EXECUTE ON FUNCTION directory_search_vector(text,text,text,text)
  TO context_use_mcp;
GRANT EXECUTE ON FUNCTION page_search_vector(text,text,text,text)
  TO context_use_mcp;

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
  knowledge_directories,
  knowledge_pages,
  knowledge_page_versions,
  assets,
  knowledge_asset_links,
  publication_intents,
  cron_schedules,
  automation_versions,
  automation_runs,
  knowledge_export_intents,
  confirmation_challenges,
  published_pages,
  published_assets
TO context_use_backup;
