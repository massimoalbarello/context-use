-- Directory deletion is intentionally leaf-only and non-cascading. Keep the
-- invariant in one narrowly granted database function so neither dashboard nor
-- MCP roles can bypass the content checks with a direct DELETE.
CREATE FUNCTION serialize_asset_directory_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public
AS $$
BEGIN
  -- Assets have path metadata rather than a directory foreign key. Serialize
  -- every insert with directory deletion so a low-level writer cannot race the
  -- emptiness check and leave an asset beneath a just-deleted directory.
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-directory-delete',0));
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_serialize_directory_deletion
BEFORE INSERT ON assets
FOR EACH STATEMENT EXECUTE FUNCTION serialize_asset_directory_changes();

REVOKE ALL ON FUNCTION serialize_asset_directory_changes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION serialize_asset_directory_changes()
  TO context_use_dashboard,context_use_mcp;

CREATE FUNCTION delete_empty_knowledge_directory(
  p_directory_id uuid,
  p_expected_version_number integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  target record;
  active_page_count integer;
  archived_page_count integer;
  asset_count integer;
  child_directory_count integer;
  deleted_count integer;
  current_version integer;
  deletion_blocked boolean := false;
BEGIN
  -- Assets do not have a directory foreign key, so asset creation takes the
  -- same transaction lock before inserting path metadata.
  PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-directory-delete',0));

  SELECT id,current_path,version_number INTO target
  FROM knowledge_directories
  WHERE id=p_directory_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  IF target.current_path='' THEN
    RETURN jsonb_build_object('status','protected');
  END IF;
  IF p_expected_version_number IS NULL OR target.version_number<>p_expected_version_number THEN
    RETURN jsonb_build_object(
      'status','version_conflict',
      'current_version_number',target.version_number
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE archived_at IS NULL),
    count(*) FILTER (WHERE archived_at IS NOT NULL)
  INTO active_page_count,archived_page_count
  FROM knowledge_pages
  WHERE left(current_path,length(target.current_path)+1)=target.current_path||'/';

  SELECT count(*) INTO asset_count
  FROM assets
  WHERE deleted_at IS NULL
    AND left(current_path,length(target.current_path)+1)=target.current_path||'/';

  SELECT count(*) INTO child_directory_count
  FROM knowledge_directories
  WHERE left(current_path,length(target.current_path)+1)=target.current_path||'/';

  IF active_page_count>0 OR archived_page_count>0 OR asset_count>0 OR child_directory_count>0 THEN
    RETURN jsonb_build_object(
      'status','not_empty',
      'active_pages',active_page_count,
      'archived_pages',archived_page_count,
      'assets',asset_count,
      'directories',child_directory_count
    );
  END IF;

  BEGIN
    DELETE FROM knowledge_directories
    WHERE id=target.id AND version_number=p_expected_version_number;
    GET DIAGNOSTICS deleted_count=ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    -- A child directory or page may have been inserted after the first count.
    -- The foreign key still prevents deletion; refresh the useful blocker
    -- counts instead of leaking a generic constraint error.
    deletion_blocked := true;
  END;

  IF deletion_blocked THEN
    SELECT
      count(*) FILTER (WHERE archived_at IS NULL),
      count(*) FILTER (WHERE archived_at IS NOT NULL)
    INTO active_page_count,archived_page_count
    FROM knowledge_pages
    WHERE left(current_path,length(target.current_path)+1)=target.current_path||'/';

    SELECT count(*) INTO asset_count
    FROM assets
    WHERE deleted_at IS NULL
      AND left(current_path,length(target.current_path)+1)=target.current_path||'/';

    SELECT count(*) INTO child_directory_count
    FROM knowledge_directories
    WHERE left(current_path,length(target.current_path)+1)=target.current_path||'/';

    RETURN jsonb_build_object(
      'status','not_empty',
      'active_pages',active_page_count,
      'archived_pages',archived_page_count,
      'assets',asset_count,
      'directories',child_directory_count
    );
  END IF;

  IF deleted_count=0 THEN
    SELECT version_number INTO current_version
    FROM knowledge_directories
    WHERE id=p_directory_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status','not_found');
    END IF;
    RETURN jsonb_build_object(
      'status','version_conflict',
      'current_version_number',current_version
    );
  END IF;

  RETURN jsonb_build_object(
    'status','deleted',
    'id',target.id,
    'current_path',target.current_path
  );
END;
$$;

ALTER FUNCTION delete_empty_knowledge_directory(uuid,integer)
  OWNER TO context_use_boundary_owner;
REVOKE ALL ON FUNCTION delete_empty_knowledge_directory(uuid,integer) FROM PUBLIC;
GRANT DELETE ON knowledge_directories TO context_use_boundary_owner;
GRANT SELECT (id,current_path,version_number) ON knowledge_directories
  TO context_use_boundary_owner;
GRANT SELECT (id,current_path,archived_at) ON knowledge_pages
  TO context_use_boundary_owner;
GRANT SELECT (id,current_path,deleted_at) ON assets
  TO context_use_boundary_owner;
GRANT EXECUTE ON FUNCTION delete_empty_knowledge_directory(uuid,integer)
  TO context_use_dashboard,context_use_mcp;
