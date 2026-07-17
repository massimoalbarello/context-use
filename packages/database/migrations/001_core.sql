CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE actor_kind AS ENUM ('dashboard', 'mcp');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE publication_action AS ENUM ('publish', 'republish', 'unpublish');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE publication_target AS ENUM ('page', 'asset');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_pages (
  id uuid PRIMARY KEY,
  current_path text NOT NULL,
  current_version_id uuid NOT NULL,
  published_version_id uuid,
  public_slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT knowledge_pages_path_format CHECK (
    current_path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND current_path !~ '//'
    AND right(current_path, 1) <> '/'
  ),
  CONSTRAINT knowledge_pages_slug_format CHECK (
    public_slug IS NULL OR public_slug ~ '^[a-z0-9][a-z0-9-]*$'
  ),
  CONSTRAINT publication_pair CHECK (
    (published_version_id IS NULL AND public_slug IS NULL)
    OR (published_version_id IS NOT NULL AND public_slug IS NOT NULL)
  )
);

CREATE UNIQUE INDEX knowledge_pages_active_path_unique
  ON knowledge_pages (current_path) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX knowledge_pages_public_slug_unique
  ON knowledge_pages (public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE knowledge_page_versions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  path text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  body_markdown text NOT NULL CHECK (octet_length(body_markdown) <= 4000000),
  commit_message text NOT NULL CHECK (length(trim(commit_message)) BETWEEN 3 AND 240),
  actor_kind actor_kind NOT NULL,
  actor_subject text NOT NULL CHECK (length(actor_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_markdown, '')), 'B')
  ) STORED,
  UNIQUE (page_id, version_number),
  UNIQUE (id, page_id)
);

CREATE INDEX knowledge_page_versions_search_idx
  ON knowledge_page_versions USING gin(search_vector);
CREATE INDEX knowledge_page_versions_page_created_idx
  ON knowledge_page_versions(page_id, created_at DESC);

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_current_version_fk
  FOREIGN KEY (current_version_id, id)
  REFERENCES knowledge_page_versions(id, page_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_published_version_fk
  FOREIGN KEY (published_version_id, id)
  REFERENCES knowledge_page_versions(id, page_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 1024),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  s3_object_key text NOT NULL UNIQUE CHECK (s3_object_key ~ '^objects/[a-f0-9-]+$'),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_seconds numeric CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX assets_active_created_idx ON assets(created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE publication_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action publication_action NOT NULL,
  target_kind publication_target NOT NULL,
  target_id uuid NOT NULL,
  version_id uuid,
  public_slug text,
  owner_user_id text NOT NULL,
  session_id text NOT NULL,
  challenge text NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT publication_intents_expiry CHECK (expires_at > created_at),
  CONSTRAINT publication_intents_page_fields CHECK (
    (target_kind = 'asset' AND version_id IS NULL AND public_slug IS NULL)
    OR target_kind = 'page'
  )
);
CREATE INDEX publication_intents_expiry_idx ON publication_intents(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL UNIQUE REFERENCES publication_intents(id) ON DELETE RESTRICT,
  action publication_action NOT NULL,
  target_kind publication_target NOT NULL,
  target_id uuid NOT NULL,
  version_id uuid,
  public_slug text,
  owner_user_id text NOT NULL,
  credential_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 120),
  actor_type text NOT NULL CHECK (actor_type IN ('owner', 'mcp_client', 'deployment', 'system')),
  actor_id text NOT NULL,
  target_type text,
  target_id text,
  request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_events_created_idx ON security_audit_events(created_at DESC);

CREATE VIEW published_pages
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.public_slug,
  p.published_version_id,
  v.path,
  v.title,
  v.body_markdown,
  v.created_at AS version_created_at
FROM knowledge_pages p
JOIN knowledge_page_versions v ON v.id = p.published_version_id AND v.page_id = p.id
WHERE p.published_version_id IS NOT NULL
  AND p.public_slug IS NOT NULL
  AND p.archived_at IS NULL;

CREATE VIEW published_assets
WITH (security_barrier = true)
AS
SELECT id, filename, content_type, size_bytes, content_hash, s3_object_key, width, height,
       duration_seconds, published_at
FROM assets
WHERE published_at IS NOT NULL AND deleted_at IS NULL;

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
  INSERT INTO publication_events (
    intent_id, action, target_kind, target_id, version_id, public_slug,
    owner_user_id, credential_id
  ) VALUES (
    intent.id, intent.action, intent.target_kind, intent.target_id, intent.version_id,
    intent.public_slug, p_owner_user_id, p_credential_id
  );
END;
$$;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'context_use_auth', 'context_use_dashboard', 'context_use_mcp', 'context_use_public',
    'context_use_publisher', 'context_use_backup'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', role_name);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_publication_intent(uuid, text, text, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO context_use_auth, context_use_dashboard, context_use_mcp, context_use_public, context_use_publisher, context_use_backup;

GRANT SELECT ON knowledge_pages, knowledge_page_versions, assets,
  publication_intents, publication_events, security_audit_events TO context_use_dashboard;
GRANT INSERT (id, current_path, current_version_id, created_at, updated_at, archived_at)
  ON knowledge_pages TO context_use_dashboard;
GRANT UPDATE (current_path, current_version_id, updated_at, archived_at)
  ON knowledge_pages TO context_use_dashboard;
GRANT INSERT ON knowledge_page_versions, publication_intents, security_audit_events
  TO context_use_dashboard;
GRANT INSERT (id,filename,content_type,size_bytes,content_hash,s3_object_key,width,height,duration_seconds,created_at)
  ON assets TO context_use_dashboard;
GRANT UPDATE (filename, deleted_at) ON assets TO context_use_dashboard;

GRANT SELECT ON knowledge_pages, knowledge_page_versions, assets TO context_use_mcp;
GRANT INSERT (id, current_path, current_version_id, created_at, updated_at, archived_at)
  ON knowledge_pages TO context_use_mcp;
GRANT UPDATE (current_path, current_version_id, updated_at, archived_at)
  ON knowledge_pages TO context_use_mcp;
GRANT INSERT ON knowledge_page_versions TO context_use_mcp;

GRANT SELECT ON published_pages, published_assets TO context_use_public;
GRANT EXECUTE ON FUNCTION confirm_publication_intent(uuid, text, text, text) TO context_use_publisher;
GRANT SELECT ON publication_intents, publication_events TO context_use_publisher;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO context_use_backup;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
