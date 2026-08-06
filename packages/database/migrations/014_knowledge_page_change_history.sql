-- Durable, body-free page history for incremental harness jobs and the owner
-- dashboard. Full page versions remain independently retention-bound; this
-- ledger records only which current page version changed and never stores a
-- body or diff.
CREATE TABLE knowledge_page_changes (
  change_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id uuid NOT NULL,
  version_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  change_kind text NOT NULL CHECK (
    change_kind IN ('created','updated','archived','deleted')
  ),
  path text NOT NULL,
  title text NOT NULL,
  commit_message text NOT NULL,
  actor_kind actor_kind,
  actor_subject text,
  changed_at timestamptz NOT NULL,
  UNIQUE (version_id,change_kind)
);

CREATE INDEX knowledge_page_changes_page_sequence_idx
  ON knowledge_page_changes(page_id,change_sequence DESC);
CREATE INDEX knowledge_page_changes_recent_idx
  ON knowledge_page_changes(change_sequence DESC);

-- Preserve every retained commit that predates this ledger. Earlier versions
-- already removed by the content-retention policy cannot be reconstructed and
-- are intentionally not invented.
INSERT INTO knowledge_page_changes(
  page_id,version_id,version_number,change_kind,path,title,commit_message,
  actor_kind,actor_subject,changed_at
)
SELECT
  version.page_id,
  version.id,
  version.version_number,
  CASE
    WHEN page.current_version_id=version.id AND page.archived_at IS NOT NULL
      THEN 'archived'
    WHEN version.version_number=1 THEN 'created'
    ELSE 'updated'
  END,
  version.path,
  version.title,
  version.commit_message,
  version.actor_kind,
  version.actor_subject,
  version.created_at
FROM knowledge_page_versions version
JOIN knowledge_pages page ON page.id=version.page_id
ORDER BY version.created_at,version.page_id,version.version_number;

-- A new version is a live knowledge change only when it is the page's current
-- projection. This covers creates and callers that update the projection before
-- inserting the deferred version row.
CREATE FUNCTION capture_inserted_current_page_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  -- Allocate ledger sequence numbers only while holding the transaction lock
  -- used by scan-cutoff reads. This makes sequence order follow commit
  -- serialization rather than PostgreSQL sequence-allocation timing.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('knowledge-page-change-ledger',0)
  );
  INSERT INTO knowledge_page_changes(
    page_id,version_id,version_number,change_kind,path,title,commit_message,
    actor_kind,actor_subject,changed_at
  )
  SELECT
    NEW.page_id,
    NEW.id,
    NEW.version_number,
    CASE
      WHEN page.archived_at IS NOT NULL THEN 'archived'
      WHEN NEW.version_number=1 THEN 'created'
      ELSE 'updated'
    END,
    NEW.path,
    NEW.title,
    NEW.commit_message,
    NEW.actor_kind,
    NEW.actor_subject,
    NEW.created_at
  FROM knowledge_pages page
  WHERE page.id=NEW.page_id AND page.current_version_id=NEW.id
  ON CONFLICT (version_id,change_kind) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_page_versions_capture_current_change
AFTER INSERT ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION capture_inserted_current_page_version();

-- The normal repositories insert the immutable version first and then point
-- the current projection at it. Capture that half of the deferred write here.
CREATE FUNCTION capture_updated_current_page_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('knowledge-page-change-ledger',0)
  );
  INSERT INTO knowledge_page_changes(
    page_id,version_id,version_number,change_kind,path,title,commit_message,
    actor_kind,actor_subject,changed_at
  )
  SELECT
    version.page_id,
    version.id,
    version.version_number,
    CASE
      WHEN NEW.archived_at IS NOT NULL THEN 'archived'
      WHEN version.version_number=1 THEN 'created'
      ELSE 'updated'
    END,
    version.path,
    version.title,
    version.commit_message,
    version.actor_kind,
    version.actor_subject,
    version.created_at
  FROM knowledge_page_versions version
  WHERE version.page_id=NEW.id AND version.id=NEW.current_version_id
  ON CONFLICT (version_id,change_kind) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_pages_capture_current_change
AFTER UPDATE OF current_version_id ON knowledge_pages
FOR EACH ROW
WHEN (OLD.current_version_id IS DISTINCT FROM NEW.current_version_id)
EXECUTE FUNCTION capture_updated_current_page_version();

-- Permanent page deletion removes versions before the page because of the
-- immutable-version foreign key. The current archived version is therefore the
-- one reliable database-level boundary at which to retain a tombstone.
CREATE FUNCTION capture_deleted_current_page_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('knowledge-page-change-ledger',0)
  );
  INSERT INTO knowledge_page_changes(
    page_id,version_id,version_number,change_kind,path,title,commit_message,
    actor_kind,actor_subject,changed_at
  )
  SELECT
    OLD.page_id,
    OLD.id,
    OLD.version_number,
    'deleted',
    OLD.path,
    OLD.title,
    'Permanently delete page',
    NULL,
    NULL,
    now()
  FROM knowledge_pages page
  WHERE page.id=OLD.page_id
    AND page.current_version_id=OLD.id
    AND page.archived_at IS NOT NULL
  ON CONFLICT (version_id,change_kind) DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER knowledge_page_versions_capture_deletion
BEFORE DELETE ON knowledge_page_versions
FOR EACH ROW EXECUTE FUNCTION capture_deleted_current_page_version();

REVOKE ALL ON FUNCTION capture_inserted_current_page_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION capture_updated_current_page_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION capture_deleted_current_page_version() FROM PUBLIC;

-- Writers can read the ledger but cannot author, rewrite, or remove its rows.
-- Trigger functions run as their migration owner and are the only write path.
GRANT SELECT ON knowledge_page_changes
  TO context_use_dashboard,context_use_mcp,context_use_backup;
