-- Add the path-independent identity, graph, guide and public-routing substrate.
-- Existing filesystem behavior remains authoritative until a later audited
-- cutover; this migration neither creates directory hubs nor removes paths.

-- Raw connector records such as long agent conversations can legitimately be
-- larger than the authored-page limit. The application keeps page writes
-- bounded separately and rejects any record above this document ceiling.
ALTER TABLE hypermedia_document_revisions
  DROP CONSTRAINT hypermedia_document_revisions_body_size_bytes_check;
ALTER TABLE hypermedia_document_revisions
  ADD CONSTRAINT hypermedia_document_revisions_body_size_bytes_check
  CHECK (body_size_bytes BETWEEN 0 AND 67108864);

-- Assets participate in the same global identity namespace as Markdown
-- knowledge and connector-controlled records. Their bytes remain in the
-- existing asset substrate: this is identity unification, not representation
-- unification.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM knowledge_pages page
    LEFT JOIN hypermedia_documents document ON document.id=page.id
    WHERE document.id IS NULL
       OR document.authority<>'knowledge'
       OR document.representation<>'markdown'
  ) THEN
    RAISE EXCEPTION 'knowledge page identity collides with a non-Markdown knowledge document'
      USING ERRCODE='23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM source_records record
    LEFT JOIN hypermedia_documents document ON document.id=record.document_id
    WHERE document.id IS NULL
       OR document.authority<>'source'
       OR document.representation<>'markdown'
  ) THEN
    RAISE EXCEPTION 'source record identity collides with a non-source document'
      USING ERRCODE='23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM hypermedia_document_revisions revision
    JOIN hypermedia_documents document ON document.id=revision.document_id
    WHERE document.representation<>'markdown'
  ) THEN
    RAISE EXCEPTION 'document revisions require Markdown document identity'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM assets asset
    JOIN hypermedia_documents document ON document.id=asset.id
    WHERE document.authority<>'knowledge'
       OR document.representation<>'asset'
  ) THEN
    RAISE EXCEPTION 'asset identity collides with an existing hypermedia document'
      USING ERRCODE='23505';
  END IF;
END;
$$;

INSERT INTO hypermedia_documents(
  id,authority,representation,created_at,updated_at
)
SELECT id,'knowledge','asset',created_at,created_at
FROM assets
ON CONFLICT (id) DO NOTHING;

ALTER TABLE assets
  ADD CONSTRAINT assets_document_identity_fk
  FOREIGN KEY (id) REFERENCES hypermedia_documents(id) ON DELETE RESTRICT;

CREATE FUNCTION register_asset_document_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  existing_authority hypermedia_document_authority;
  existing_representation hypermedia_document_representation;
BEGIN
  INSERT INTO hypermedia_documents(
    id,authority,representation,created_at,updated_at
  ) VALUES (NEW.id,'knowledge','asset',NEW.created_at,NEW.created_at)
  ON CONFLICT (id) DO NOTHING;

  SELECT authority,representation
  INTO existing_authority,existing_representation
  FROM hypermedia_documents
  WHERE id=NEW.id;
  IF existing_authority IS DISTINCT FROM 'knowledge'::hypermedia_document_authority
     OR existing_representation IS DISTINCT FROM 'asset'::hypermedia_document_representation THEN
    RAISE EXCEPTION 'asset identity collides with an existing hypermedia document'
      USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION remove_deleted_asset_document_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM hypermedia_documents
  WHERE id=OLD.id AND authority='knowledge' AND representation='asset';
  RETURN NULL;
END;
$$;

CREATE FUNCTION keep_asset_document_identity_stable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'asset document identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION remove_truncated_asset_document_identities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  DELETE FROM hypermedia_documents document
  WHERE document.authority='knowledge' AND document.representation='asset'
    AND NOT EXISTS (SELECT 1 FROM assets asset WHERE asset.id=document.id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER assets_register_document_identity
BEFORE INSERT ON assets
FOR EACH ROW EXECUTE FUNCTION register_asset_document_identity();

CREATE TRIGGER assets_keep_document_identity_stable
BEFORE UPDATE OF id ON assets
FOR EACH ROW EXECUTE FUNCTION keep_asset_document_identity_stable();

CREATE TRIGGER assets_remove_document_identity
AFTER DELETE ON assets
FOR EACH ROW EXECUTE FUNCTION remove_deleted_asset_document_identity();

CREATE TRIGGER assets_remove_document_identities_after_truncate
AFTER TRUNCATE ON assets
FOR EACH STATEMENT EXECUTE FUNCTION remove_truncated_asset_document_identities();

-- Every attachment table verifies both sides of the identity boundary. The
-- legacy page trigger intentionally uses ON CONFLICT DO NOTHING, so this
-- independent check is what turns a UUID collision into a failed transaction.
CREATE FUNCTION validate_knowledge_page_document_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hypermedia_documents document
    WHERE document.id=NEW.id
      AND document.authority='knowledge'
      AND document.representation='markdown'
  ) THEN
    RAISE EXCEPTION 'knowledge page identity collides with a non-Markdown knowledge document'
      USING ERRCODE='23505';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_source_record_document_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hypermedia_documents document
    WHERE document.id=NEW.document_id
      AND document.authority='source'
      AND document.representation='markdown'
  ) THEN
    RAISE EXCEPTION 'source record identity collides with a non-source document'
      USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_markdown_document_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hypermedia_documents document
    WHERE document.id=NEW.document_id
      AND document.representation='markdown'
  ) THEN
    RAISE EXCEPTION 'document revisions require Markdown document identity'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION keep_hypermedia_document_identity_stable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.authority IS DISTINCT FROM OLD.authority
     OR NEW.representation IS DISTINCT FROM OLD.representation THEN
    RAISE EXCEPTION 'document authority and representation are immutable'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

-- The existing registration trigger sorts immediately before this validation
-- trigger, so direct legacy page inserts remain supported without weakening
-- collision handling.
CREATE TRIGGER knowledge_pages_register_document_identity_validation
AFTER INSERT OR UPDATE OF id ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION validate_knowledge_page_document_identity();

CREATE TRIGGER source_records_validate_document_identity
BEFORE INSERT OR UPDATE OF document_id ON source_records
FOR EACH ROW EXECUTE FUNCTION validate_source_record_document_identity();

CREATE TRIGGER hypermedia_document_revisions_validate_representation
BEFORE INSERT OR UPDATE OF document_id ON hypermedia_document_revisions
FOR EACH ROW EXECUTE FUNCTION validate_markdown_document_revision();

CREATE TRIGGER hypermedia_documents_keep_identity_stable
BEFORE UPDATE OF id,authority,representation ON hypermedia_documents
FOR EACH ROW EXECUTE FUNCTION keep_hypermedia_document_identity_stable();

REVOKE ALL ON FUNCTION register_asset_document_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_deleted_asset_document_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_asset_document_identity_stable() FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_truncated_asset_document_identities() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_knowledge_page_document_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_source_record_document_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_markdown_document_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION keep_hypermedia_document_identity_stable() FROM PUBLIC;

-- Existing service grants predate the authority/representation split. Narrow
-- them now that those identity fields have explicit database meaning.
REVOKE UPDATE ON hypermedia_documents FROM context_use_dashboard,context_use_mcp;
GRANT UPDATE (updated_at) ON hypermedia_documents
  TO context_use_dashboard,context_use_mcp;
-- Storage now maintains derived projections and indexes only. Object-backed
-- document identities and revisions are created by their authority-specific
-- dashboard/MCP writers, so the broad transitional grants from migration 021
-- are no longer necessary.
REVOKE INSERT ON hypermedia_documents,hypermedia_document_revisions
  FROM context_use_storage;
-- Link-index maintenance prioritizes live revisions without exposing source
-- payload metadata or granting storage any source/page mutation capability.
GRANT SELECT (id,current_version_id,archived_at) ON knowledge_pages
  TO context_use_storage;
GRANT SELECT (document_id,current_revision_id,deleted_at) ON source_records
  TO context_use_storage;
REVOKE UPDATE ON source_records FROM context_use_mcp;
GRANT UPDATE (
  current_revision_id,source_created_at,source_updated_at,search_vector,deleted_at
) ON source_records TO context_use_mcp;

GRANT SELECT (id,authority,representation),
  INSERT (id,authority,representation,created_at,updated_at)
  ON hypermedia_documents TO context_use_boundary_owner;
GRANT DELETE ON hypermedia_documents TO context_use_boundary_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION register_asset_document_identity() OWNER TO context_use_boundary_owner;
ALTER FUNCTION remove_deleted_asset_document_identity() OWNER TO context_use_boundary_owner;
ALTER FUNCTION remove_truncated_asset_document_identities() OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

-- PostgreSQL caps one tsvector at 1 MiB, while an exact connector-controlled
-- Markdown record can be 64 MiB. Index bounded chunks so the full raw body
-- remains searchable without putting its bytes or an oversized vector in one
-- database row. The legacy source_records vector remains as an upgrade fallback
-- for records written before this migration.
CREATE TABLE source_record_search_chunks (
  document_id uuid NOT NULL REFERENCES source_records(document_id) ON DELETE CASCADE,
  chunk_number integer NOT NULL CHECK (chunk_number>=0),
  search_vector tsvector NOT NULL,
  PRIMARY KEY (document_id,chunk_number)
);
CREATE INDEX source_record_search_chunks_vector_idx
  ON source_record_search_chunks USING gin(search_vector);

CREATE FUNCTION replace_source_record_search_chunks(
  p_document_id uuid,
  p_chunks text[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF p_document_id IS NULL OR p_chunks IS NULL
     OR cardinality(p_chunks)>2048
     OR array_position(p_chunks,NULL) IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM unnest(p_chunks) AS value(chunk)
       WHERE octet_length(chunk)>65536
     ) THEN
    RAISE EXCEPTION 'source record search chunks are invalid' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM source_records WHERE document_id=p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source record not found' USING ERRCODE='P0002';
  END IF;

  DELETE FROM source_record_search_chunks WHERE document_id=p_document_id;
  INSERT INTO source_record_search_chunks(document_id,chunk_number,search_vector)
  SELECT p_document_id,ordinality-1,to_tsvector('english',chunk)
  FROM unnest(p_chunks) WITH ORDINALITY AS value(chunk,ordinality);
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  RETURN inserted_count;
END;
$$;

GRANT SELECT (document_id) ON source_records TO context_use_boundary_owner;
GRANT SELECT,INSERT,DELETE ON source_record_search_chunks TO context_use_boundary_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION replace_source_record_search_chunks(uuid,text[])
  OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;
REVOKE ALL ON FUNCTION replace_source_record_search_chunks(uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_source_record_search_chunks(uuid,text[])
  TO context_use_mcp;
GRANT SELECT ON source_record_search_chunks TO context_use_mcp,context_use_backup;

-- Links are immutable-revision-scoped derived data. links_indexed_at separates
-- a reliable empty result from a revision whose Markdown has not been indexed.
ALTER TABLE hypermedia_document_revisions
  ADD COLUMN links_indexed_at timestamptz,
  ADD COLUMN links_index_attempted_at timestamptz;
CREATE INDEX hypermedia_document_revisions_unindexed_links_idx
  ON hypermedia_document_revisions(links_index_attempted_at NULLS FIRST,created_at,id)
  WHERE links_indexed_at IS NULL;

CREATE TABLE document_links (
  source_revision_id uuid NOT NULL
    REFERENCES hypermedia_document_revisions(id) ON DELETE CASCADE,
  target_document_id uuid NOT NULL
    REFERENCES hypermedia_documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_revision_id,target_document_id)
);
CREATE INDEX document_links_target_idx
  ON document_links(target_document_id,source_revision_id);

-- Writers receive one checked replacement operation rather than direct write
-- privileges. Replacing and marking a zero-link revision are one transaction.
CREATE FUNCTION replace_document_links(
  p_source_revision_id uuid,
  p_target_document_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  linked_count integer;
BEGIN
  IF p_source_revision_id IS NULL OR p_target_document_ids IS NULL THEN
    RAISE EXCEPTION 'source revision and target document array are required'
      USING ERRCODE='22023';
  END IF;
  IF cardinality(p_target_document_ids)>100000
     OR array_position(p_target_document_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'target document array is invalid' USING ERRCODE='22023';
  END IF;

  PERFORM 1
  FROM hypermedia_document_revisions
  WHERE id=p_source_revision_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source revision not found' USING ERRCODE='P0002';
  END IF;

  DELETE FROM document_links
  WHERE source_revision_id=p_source_revision_id;

  INSERT INTO document_links(source_revision_id,target_document_id)
  SELECT p_source_revision_id,document.id
  FROM (
    SELECT DISTINCT unnest(p_target_document_ids) AS id
  ) target
  JOIN hypermedia_documents document ON document.id=target.id;
  GET DIAGNOSTICS linked_count=ROW_COUNT;

  UPDATE hypermedia_document_revisions
  SET links_indexed_at=now(),links_index_attempted_at=now()
  WHERE id=p_source_revision_id;

  RETURN linked_count;
END;
$$;

-- A missing or corrupt historical object must not pin every newer revision
-- behind it. Storage records the attempt without pretending the links were
-- indexed; the least-recently-attempted ordering retries it after fresh work.
CREATE FUNCTION defer_document_link_index(p_source_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  UPDATE hypermedia_document_revisions
  SET links_index_attempted_at=now()
  WHERE id=p_source_revision_id AND links_indexed_at IS NULL;
END;
$$;

GRANT SELECT (id,links_indexed_at)
  ON hypermedia_document_revisions TO context_use_boundary_owner;
GRANT UPDATE (links_indexed_at,links_index_attempted_at)
  ON hypermedia_document_revisions TO context_use_boundary_owner;
GRANT SELECT,INSERT,DELETE ON document_links TO context_use_boundary_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION replace_document_links(uuid,uuid[]) OWNER TO context_use_boundary_owner;
ALTER FUNCTION defer_document_link_index(uuid) OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;
REVOKE ALL ON FUNCTION replace_document_links(uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION defer_document_link_index(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_document_links(uuid,uuid[])
  TO context_use_dashboard,context_use_mcp,context_use_storage;
GRANT EXECUTE ON FUNCTION defer_document_link_index(uuid) TO context_use_storage;

GRANT SELECT ON document_links TO context_use_dashboard,context_use_mcp,context_use_backup;

-- Operational configuration names the one global maintenance guide without
-- giving its old path any permanent meaning. A nullable bootstrap state is
-- necessary because a fresh database installs its object-backed guide only
-- after SQL migrations finish.
CREATE TABLE knowledge_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  global_guide_document_id uuid UNIQUE
    REFERENCES hypermedia_documents(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO knowledge_settings(singleton,global_guide_document_id)
VALUES (true,(
  SELECT id
  FROM knowledge_pages
  WHERE current_path='agents' AND archived_at IS NULL
  ORDER BY updated_at DESC
  LIMIT 1
));

CREATE FUNCTION validate_global_knowledge_guide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.global_guide_document_id IS NOT NULL THEN
    -- The page-lifecycle statement trigger takes the settings row first. Take
    -- the target page second so concurrent configuration and archive/delete
    -- operations share one lock order and cannot validate stale state.
    PERFORM 1
    FROM knowledge_pages page
    JOIN hypermedia_documents document ON document.id=page.id
    WHERE page.id=NEW.global_guide_document_id
      AND page.archived_at IS NULL
      AND document.authority='knowledge'
    FOR UPDATE OF page;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'global guide must be an active knowledge document'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION lock_knowledge_settings_for_page_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  -- A statement-level trigger runs before PostgreSQL locks any target page row.
  -- This gives guide configuration and page lifecycle changes the same
  -- settings-then-page lock order and avoids both stale validation and deadlock.
  PERFORM 1 FROM knowledge_settings WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'knowledge settings singleton is missing' USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION register_bootstrap_global_knowledge_guide()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.current_path='agents' AND NEW.archived_at IS NULL THEN
    UPDATE knowledge_settings settings
    SET global_guide_document_id=NEW.id,updated_at=now()
    WHERE settings.singleton
      AND (
        settings.global_guide_document_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM knowledge_pages configured
          WHERE configured.id=settings.global_guide_document_id
            AND configured.archived_at IS NULL
        )
      );
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION protect_configured_global_knowledge_guide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM knowledge_settings
      WHERE singleton AND global_guide_document_id=OLD.id
    ) THEN
      RAISE EXCEPTION 'the configured global knowledge guide cannot be archived or deleted'
        USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;

  IF (
    NEW.archived_at IS NOT NULL
    OR NEW.current_path IS DISTINCT FROM OLD.current_path
  ) AND EXISTS (
    SELECT 1 FROM knowledge_settings
    WHERE singleton AND global_guide_document_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'the configured global knowledge guide cannot be moved, archived or deleted'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_settings_validate_global_guide
BEFORE INSERT OR UPDATE OF global_guide_document_id ON knowledge_settings
FOR EACH ROW EXECUTE FUNCTION validate_global_knowledge_guide();

-- Deferred execution guarantees the knowledge-page identity trigger has
-- registered the new document before this setting's FK is assigned.
CREATE CONSTRAINT TRIGGER knowledge_pages_register_bootstrap_global_guide
AFTER INSERT OR UPDATE ON knowledge_pages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION register_bootstrap_global_knowledge_guide();

CREATE TRIGGER knowledge_pages_lock_settings_before_guide_update
BEFORE UPDATE OF current_path,archived_at ON knowledge_pages
FOR EACH STATEMENT EXECUTE FUNCTION lock_knowledge_settings_for_page_lifecycle();

CREATE TRIGGER knowledge_pages_lock_settings_before_guide_delete
BEFORE DELETE ON knowledge_pages
FOR EACH STATEMENT EXECUTE FUNCTION lock_knowledge_settings_for_page_lifecycle();

CREATE TRIGGER knowledge_pages_protect_configured_global_guide_update
BEFORE UPDATE OF current_path,archived_at ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION protect_configured_global_knowledge_guide();

CREATE TRIGGER knowledge_pages_protect_configured_global_guide_delete
BEFORE DELETE ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION protect_configured_global_knowledge_guide();

REVOKE ALL ON FUNCTION validate_global_knowledge_guide() FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_knowledge_settings_for_page_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION register_bootstrap_global_knowledge_guide() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_configured_global_knowledge_guide() FROM PUBLIC;

GRANT SELECT ON knowledge_settings TO context_use_dashboard,context_use_mcp,context_use_backup;
GRANT SELECT (singleton,global_guide_document_id)
  ON knowledge_settings TO context_use_reset_owner;
GRANT UPDATE (global_guide_document_id,updated_at)
  ON knowledge_settings TO context_use_dashboard;
GRANT SELECT,UPDATE (global_guide_document_id,updated_at)
  ON knowledge_settings TO context_use_boundary_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION lock_knowledge_settings_for_page_lifecycle()
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION register_bootstrap_global_knowledge_guide()
  OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

-- Public identity is permanent and opaque. Publication state remains on the
-- existing page/asset projections during the additive phase. A deleted private
-- document nulls only the private mapping; its public ID and aliases survive as
-- tombstones and therefore can never be reassigned.
CREATE TYPE public_route_kind AS ENUM ('page','directory','markdown','asset');

CREATE TABLE public_resources (
  public_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid UNIQUE
    REFERENCES hypermedia_documents(id) ON DELETE SET NULL,
  resource_kind publication_target NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public_route_aliases (
  alias_path text PRIMARY KEY,
  route_kind public_route_kind NOT NULL,
  public_id uuid NOT NULL REFERENCES public_resources(public_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_route_aliases_exact_path CHECK (
    CASE route_kind
      WHEN 'page' THEN alias_path ~ '^/p/[a-z0-9][a-z0-9/_-]*$'
      WHEN 'directory' THEN alias_path='/p/' OR (
        alias_path ~ '^/p/[a-z0-9][a-z0-9/_-]*/$'
        AND alias_path !~ '//'
      )
      WHEN 'markdown' THEN alias_path ~ '^/p/[a-z0-9][a-z0-9/_-]*[.]md$'
      WHEN 'asset' THEN alias_path ~ '^/a/[a-z0-9][a-z0-9/_-]*$'
    END
  )
);
CREATE INDEX public_route_aliases_public_resource_idx
  ON public_route_aliases(public_id,route_kind);

CREATE FUNCTION validate_public_resource_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.document_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.resource_kind='page' AND EXISTS (
    SELECT 1 FROM knowledge_pages WHERE id=NEW.document_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.resource_kind='asset' AND EXISTS (
    SELECT 1 FROM assets WHERE id=NEW.document_id
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'public resource kind does not match its private document'
    USING ERRCODE='23514';
END;
$$;

CREATE TRIGGER public_resources_validate_mapping
BEFORE INSERT OR UPDATE OF document_id,resource_kind ON public_resources
FOR EACH ROW EXECUTE FUNCTION validate_public_resource_mapping();

CREATE FUNCTION register_public_resource_routes(
  p_document_id uuid,
  p_resource_kind publication_target,
  p_public_path text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  resolved_public_id uuid;
  route record;
BEGIN
  IF p_document_id IS NULL OR p_resource_kind IS NULL OR p_public_path IS NULL THEN
    RAISE EXCEPTION 'public document, kind and path are required' USING ERRCODE='22023';
  END IF;

  SELECT public_id INTO resolved_public_id
  FROM public_resources
  WHERE document_id=p_document_id;

  IF resolved_public_id IS NULL THEN
    INSERT INTO public_resources(document_id,resource_kind)
    VALUES (p_document_id,p_resource_kind)
    RETURNING public_id INTO resolved_public_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public_resources
    WHERE public_id=resolved_public_id AND resource_kind=p_resource_kind
  ) THEN
    RAISE EXCEPTION 'public resource kind is immutable' USING ERRCODE='23514';
  END IF;

  FOR route IN
    SELECT value.alias_path,value.route_kind
    FROM (
      SELECT '/p/'||p_public_path AS alias_path,'page'::public_route_kind AS route_kind
      WHERE p_resource_kind='page'
      UNION ALL
      SELECT '/p/'||p_public_path||'.md','markdown'::public_route_kind
      WHERE p_resource_kind='page'
      UNION ALL
      SELECT '/a/'||p_public_path,'asset'::public_route_kind
      WHERE p_resource_kind='asset'
    ) value
  LOOP
    INSERT INTO public_route_aliases(alias_path,route_kind,public_id)
    VALUES (route.alias_path,route.route_kind,resolved_public_id)
    ON CONFLICT (alias_path) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM public_route_aliases alias
      WHERE alias.alias_path=route.alias_path
        AND alias.route_kind=route.route_kind
        AND alias.public_id=resolved_public_id
    ) THEN
      RAISE EXCEPTION 'public route alias is permanently assigned'
        USING ERRCODE='23505';
    END IF;
  END LOOP;

  RETURN resolved_public_id;
END;
$$;

CREATE FUNCTION register_published_page_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.published_version_id IS NOT NULL AND NEW.public_path IS NOT NULL THEN
    PERFORM register_public_resource_routes(NEW.id,'page',NEW.public_path);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION register_published_asset_routes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.public_path IS NOT NULL THEN
    PERFORM register_public_resource_routes(NEW.id,'asset',NEW.public_path);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER knowledge_pages_register_public_routes
AFTER INSERT OR UPDATE OF published_version_id,public_path ON knowledge_pages
FOR EACH ROW EXECUTE FUNCTION register_published_page_routes();

CREATE TRIGGER assets_register_public_routes
AFTER INSERT OR UPDATE OF public_path ON assets
FOR EACH ROW EXECUTE FUNCTION register_published_asset_routes();

-- Backfill only routes that are observable today. Private current paths never
-- enter the alias table. Directory aliases wait for their hub documents.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT id,public_path
    FROM knowledge_pages
    WHERE published_version_id IS NOT NULL
      AND public_path IS NOT NULL
      AND archived_at IS NULL
  LOOP
    PERFORM register_public_resource_routes(target.id,'page',target.public_path);
  END LOOP;

  FOR target IN
    SELECT id,public_path
    FROM assets
    WHERE public_path IS NOT NULL AND deleted_at IS NULL
  LOOP
    PERFORM register_public_resource_routes(target.id,'asset',target.public_path);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION validate_public_resource_mapping() FROM PUBLIC;
REVOKE ALL ON FUNCTION register_public_resource_routes(uuid,publication_target,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_published_page_routes() FROM PUBLIC;
REVOKE ALL ON FUNCTION register_published_asset_routes() FROM PUBLIC;

GRANT SELECT,INSERT ON public_resources,public_route_aliases
  TO context_use_boundary_owner;
GRANT USAGE,CREATE ON SCHEMA public TO context_use_boundary_owner;
ALTER FUNCTION register_public_resource_routes(uuid,publication_target,text)
  OWNER TO context_use_boundary_owner;
ALTER FUNCTION register_published_page_routes() OWNER TO context_use_boundary_owner;
ALTER FUNCTION register_published_asset_routes() OWNER TO context_use_boundary_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_boundary_owner;

-- Anonymous and storage-facing roles see only opaque identities that are
-- currently public. Neither view exposes a private document UUID.
CREATE VIEW published_public_resources
WITH (security_barrier=true,security_invoker=false)
AS
SELECT resource.public_id,resource.resource_kind
FROM public_resources resource
JOIN knowledge_pages page ON page.id=resource.document_id
WHERE resource.resource_kind='page'
  AND page.published_version_id IS NOT NULL
  AND page.public_path IS NOT NULL
  AND page.archived_at IS NULL
UNION ALL
SELECT resource.public_id,resource.resource_kind
FROM public_resources resource
JOIN assets asset ON asset.id=resource.document_id
WHERE resource.resource_kind='asset'
  AND asset.public_path IS NOT NULL
  AND asset.deleted_at IS NULL;

CREATE VIEW published_route_aliases
WITH (security_barrier=true,security_invoker=false)
AS
SELECT alias.alias_path,alias.route_kind,alias.public_id
FROM public_route_aliases alias
JOIN published_public_resources resource
  ON resource.public_id=alias.public_id;

GRANT SELECT ON public_resources,public_route_aliases
  TO context_use_dashboard,context_use_mcp,context_use_backup;

GRANT CREATE ON SCHEMA public TO context_use_projection_owner;
GRANT SELECT ON public_resources,public_route_aliases
  TO context_use_projection_owner;
ALTER VIEW published_public_resources OWNER TO context_use_projection_owner;
ALTER VIEW published_route_aliases OWNER TO context_use_projection_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_projection_owner;

GRANT SELECT ON published_public_resources,published_route_aliases
  TO context_use_public,context_use_storage,context_use_backup;

GRANT SELECT ON
  document_links,knowledge_settings,public_resources,public_route_aliases,
  published_public_resources,published_route_aliases
TO context_use_backup;
