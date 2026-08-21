-- Shared, object-backed document substrate. Knowledge paths remain unchanged in
-- this migration; the new tables separate durable identity/revision metadata
-- from Markdown bytes and are also the home for source records.
CREATE TYPE hypermedia_document_authority AS ENUM ('source','knowledge');

CREATE TABLE hypermedia_documents (
  id uuid PRIMARY KEY,
  authority hypermedia_document_authority NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hypermedia_document_revisions (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES hypermedia_documents(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number>0),
  body_object_key text NOT NULL UNIQUE CHECK (
    body_object_key ~ '^documents/private/[0-9a-f-]{36}\.md$'
  ),
  body_size_bytes integer NOT NULL CHECK (body_size_bytes BETWEEN 0 AND 4000000),
  body_content_hash text NOT NULL CHECK (body_content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id,revision_number),
  UNIQUE (id,document_id)
);
CREATE INDEX hypermedia_document_revisions_document_created_idx
  ON hypermedia_document_revisions(document_id,created_at DESC);

INSERT INTO hypermedia_documents(id,authority,created_at,updated_at)
SELECT id,'knowledge',created_at,updated_at
FROM knowledge_pages;

INSERT INTO hypermedia_document_revisions(
  id,document_id,revision_number,body_object_key,body_size_bytes,
  body_content_hash,created_at
)
SELECT
  id,page_id,version_number,'documents/private/'||id::text||'.md',
  octet_length(body_markdown),
  encode(digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex'),
  created_at
FROM knowledge_page_versions;

-- During the one supported forward migration this column is a fail-safe queue:
-- the storage service clears each value only after the corresponding object is
-- written and verified. Normal application writes leave it NULL.
ALTER TABLE knowledge_page_versions ALTER COLUMN body_markdown DROP NOT NULL;
CREATE INDEX knowledge_page_versions_legacy_body_queue_idx
  ON knowledge_page_versions(page_id,version_number)
  WHERE body_markdown IS NOT NULL;

CREATE FUNCTION register_knowledge_document_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  INSERT INTO hypermedia_documents(id,authority,created_at,updated_at)
  VALUES (NEW.id,'knowledge',NEW.created_at,NEW.updated_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_pages_register_document
AFTER INSERT ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION register_knowledge_document_metadata();

CREATE FUNCTION register_legacy_knowledge_revision_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  INSERT INTO hypermedia_documents(id,authority,created_at,updated_at)
  SELECT page.id,'knowledge',page.created_at,page.updated_at
  FROM knowledge_pages page WHERE page.id=NEW.page_id
  ON CONFLICT (id) DO NOTHING;
  IF NEW.body_markdown IS NOT NULL THEN
    INSERT INTO hypermedia_document_revisions(
      id,document_id,revision_number,body_object_key,body_size_bytes,
      body_content_hash,created_at
    ) VALUES (
      NEW.id,NEW.page_id,NEW.version_number,
      'documents/private/'||NEW.id::text||'.md',octet_length(NEW.body_markdown),
      encode(digest(convert_to(NEW.body_markdown,'UTF8'),'sha256'),'hex'),NEW.created_at
    ) ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_page_versions_register_document_revision
AFTER INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION register_legacy_knowledge_revision_metadata();

REVOKE ALL ON FUNCTION register_knowledge_document_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION register_legacy_knowledge_revision_metadata() FROM PUBLIC;

CREATE FUNCTION remove_deleted_knowledge_revision_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM hypermedia_document_revisions WHERE id=OLD.id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_page_versions_remove_document_revision
AFTER DELETE ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION remove_deleted_knowledge_revision_metadata();

CREATE FUNCTION remove_deleted_knowledge_document_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM hypermedia_documents WHERE id=OLD.id AND authority='knowledge';
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_pages_remove_document
AFTER DELETE ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION remove_deleted_knowledge_document_metadata();

CREATE FUNCTION replace_knowledge_document_identity_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM hypermedia_documents WHERE id=OLD.id AND authority='knowledge';
  INSERT INTO hypermedia_documents(id,authority,created_at,updated_at)
  VALUES (NEW.id,'knowledge',NEW.created_at,NEW.updated_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NULL;
END;
$$;
CREATE TRIGGER knowledge_pages_replace_document_identity
AFTER UPDATE OF id ON knowledge_pages
FOR EACH ROW
WHEN (OLD.id IS DISTINCT FROM NEW.id)
EXECUTE FUNCTION replace_knowledge_document_identity_metadata();

REVOKE ALL ON FUNCTION remove_deleted_knowledge_revision_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_deleted_knowledge_document_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION replace_knowledge_document_identity_metadata() FROM PUBLIC;
-- Revision history is now cheap object metadata plus immutable Markdown objects.
-- Writers retain every application revision rather than invoking the old cap.
REVOKE EXECUTE ON FUNCTION prune_page_versions(uuid)
  FROM context_use_dashboard,context_use_mcp;
REVOKE EXECUTE ON FUNCTION project_public_markdown(text) FROM context_use_public;

CREATE TABLE source_records (
  document_id uuid PRIMARY KEY REFERENCES hypermedia_documents(id) ON DELETE CASCADE,
  current_revision_id uuid,
  integration text NOT NULL CHECK (length(integration) BETWEEN 1 AND 255),
  connection_id text NOT NULL CHECK (length(connection_id) BETWEEN 1 AND 512),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 255),
  source_record_id text NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 1024),
  source_created_at timestamptz,
  source_updated_at timestamptz NOT NULL,
  search_vector tsvector NOT NULL DEFAULT ''::tsvector,
  deleted_at timestamptz,
  UNIQUE (integration,connection_id,model,source_record_id),
  FOREIGN KEY (current_revision_id,document_id)
    REFERENCES hypermedia_document_revisions(id,document_id) ON DELETE RESTRICT
);
CREATE INDEX source_records_connection_idx ON source_records(connection_id,source_updated_at DESC);
CREATE INDEX source_records_search_idx ON source_records USING gin(search_vector);

-- Public Markdown is a derived artifact, not a readable private revision. A
-- projection generation changes whenever page/asset visibility changes. The
-- public views expose only artifacts reconciled against the current generation.
CREATE TABLE public_projection_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public_projection_state(singleton) VALUES (true);

CREATE TABLE published_page_artifacts (
  page_id uuid NOT NULL REFERENCES knowledge_pages(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  projection_generation bigint NOT NULL CHECK (projection_generation>0),
  artifact_id uuid NOT NULL UNIQUE,
  body_object_key text NOT NULL UNIQUE CHECK (
    body_object_key ~ '^documents/public/[0-9a-f-]{36}\.md$'
  ),
  body_size_bytes integer NOT NULL CHECK (body_size_bytes BETWEEN 0 AND 4000000),
  body_content_hash text NOT NULL CHECK (body_content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id,version_id,projection_generation),
  FOREIGN KEY (version_id,page_id)
    REFERENCES knowledge_page_versions(id,page_id) ON DELETE CASCADE
);

CREATE FUNCTION advance_public_projection_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  UPDATE public_projection_state
  SET generation=generation+1,updated_at=now()
  WHERE singleton;
  RETURN NULL;
END;
$$;

CREATE TRIGGER knowledge_pages_advance_public_projection
AFTER UPDATE OF published_version_id,public_path ON knowledge_pages
FOR EACH STATEMENT EXECUTE FUNCTION advance_public_projection_generation();

CREATE TRIGGER assets_advance_public_projection
AFTER UPDATE OF public_path ON assets
FOR EACH STATEMENT EXECUTE FUNCTION advance_public_projection_generation();

REVOKE ALL ON FUNCTION advance_public_projection_generation() FROM PUBLIC;

-- The public landing page is an explicit owner-controlled pointer. Seed the
-- current convention once, without making the convention part of the model.
CREATE TABLE public_knowledge_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  entrypoint_page_id uuid REFERENCES knowledge_pages(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public_knowledge_settings(singleton,entrypoint_page_id)
SELECT true,(
  SELECT id FROM knowledge_pages
  WHERE current_path='about/intro'
    AND published_version_id IS NOT NULL
    AND public_path IS NOT NULL
    AND archived_at IS NULL
  ORDER BY updated_at DESC LIMIT 1
);

-- Keep the private projection source shape stable for generated directory
-- indexes, but stop exposing a body from Postgres.
CREATE OR REPLACE VIEW published_page_sources
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  page.id,
  page.public_path,
  page.published_version_id,
  version.path,
  version.title,
  version.summary,
  NULL::text AS body_markdown,
  version.created_at AS version_created_at
FROM knowledge_pages page
JOIN knowledge_page_versions version
  ON version.id=page.published_version_id AND version.page_id=page.id
WHERE page.published_version_id IS NOT NULL
  AND page.public_path IS NOT NULL
  AND page.archived_at IS NULL;

CREATE OR REPLACE VIEW published_pages
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  source.public_path,
  source.title,
  source.summary,
  NULL::text AS body_markdown,
  source.version_created_at AS last_edited_at
FROM published_page_sources source
JOIN public_projection_state state ON state.singleton
JOIN published_page_artifacts artifact
  ON artifact.page_id=source.id
 AND artifact.version_id=source.published_version_id
 AND artifact.projection_generation=state.generation;

CREATE VIEW storage_published_pages
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  source.public_path,
  artifact.body_object_key,
  artifact.body_size_bytes,
  artifact.body_content_hash
FROM published_page_sources source
JOIN public_projection_state state ON state.singleton
JOIN published_page_artifacts artifact
  ON artifact.page_id=source.id
 AND artifact.version_id=source.published_version_id
 AND artifact.projection_generation=state.generation;

CREATE VIEW published_site_settings
WITH (security_barrier=true,security_invoker=false)
AS
SELECT page.public_path AS entrypoint_public_path
FROM public_knowledge_settings settings
LEFT JOIN published_pages page
  ON page.public_path=(
    SELECT public_path FROM knowledge_pages
    WHERE id=settings.entrypoint_page_id
  )
WHERE settings.singleton;

GRANT SELECT ON hypermedia_documents,hypermedia_document_revisions
  TO context_use_dashboard,context_use_mcp,context_use_storage,context_use_backup;
GRANT INSERT,UPDATE ON hypermedia_documents TO context_use_dashboard,context_use_mcp;
GRANT INSERT ON hypermedia_document_revisions TO context_use_dashboard,context_use_mcp;
GRANT SELECT,INSERT,UPDATE ON source_records TO context_use_mcp;
GRANT SELECT ON source_records TO context_use_dashboard,context_use_backup;

GRANT SELECT (
  id,page_id,version_number,path,title,summary,body_markdown,created_at
),UPDATE (body_markdown) ON knowledge_page_versions TO context_use_storage;
GRANT SELECT (
  id,published_version_id,public_path,archived_at,created_at,updated_at
) ON knowledge_pages TO context_use_storage;
GRANT SELECT (id,current_path) ON knowledge_directories TO context_use_storage;
GRANT SELECT (id,public_path,deleted_at) ON assets TO context_use_storage;
GRANT SELECT,INSERT ON hypermedia_documents,hypermedia_document_revisions
  TO context_use_storage;
GRANT SELECT,INSERT,UPDATE ON published_page_artifacts TO context_use_storage;
GRANT SELECT,UPDATE ON public_projection_state TO context_use_storage;
GRANT SELECT ON storage_published_pages TO context_use_storage;

GRANT SELECT,UPDATE ON public_knowledge_settings TO context_use_dashboard;
GRANT SELECT ON published_site_settings TO context_use_public,context_use_backup;

GRANT CREATE ON SCHEMA public TO context_use_projection_owner;
GRANT SELECT ON public_projection_state,published_page_artifacts,public_knowledge_settings
  TO context_use_projection_owner;
ALTER VIEW published_page_sources OWNER TO context_use_projection_owner;
ALTER VIEW published_pages OWNER TO context_use_projection_owner;
ALTER VIEW published_site_settings OWNER TO context_use_projection_owner;
ALTER VIEW storage_published_pages OWNER TO context_use_projection_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_projection_owner;

GRANT SELECT ON published_pages,published_site_settings TO context_use_public;
GRANT SELECT ON
  hypermedia_documents,hypermedia_document_revisions,source_records,
  public_projection_state,published_page_artifacts,public_knowledge_settings
TO context_use_backup;
