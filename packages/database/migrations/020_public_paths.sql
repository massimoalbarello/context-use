-- Public URLs use the exact knowledge path of the published page version or
-- asset. Publication state remains the only gateway into the public views.

DROP VIEW public_mcp_pages;
DROP VIEW published_pages;
DROP VIEW published_assets;

DROP TRIGGER publication_intents_protect_required_public_page ON publication_intents;
DROP FUNCTION protect_required_public_page_intent();

ALTER TABLE knowledge_pages DROP CONSTRAINT knowledge_pages_slug_format;
ALTER TABLE knowledge_pages DROP CONSTRAINT knowledge_pages_required_public_slug;
ALTER TABLE publication_intents DROP CONSTRAINT publication_intents_page_fields;

ALTER TABLE knowledge_pages RENAME COLUMN public_slug TO public_path;
ALTER TABLE knowledge_pages RENAME COLUMN required_public_slug TO required_public_path;
ALTER TABLE publication_intents RENAME COLUMN public_slug TO public_path;
ALTER INDEX knowledge_pages_public_slug_unique RENAME TO knowledge_pages_public_path_unique;
ALTER INDEX knowledge_pages_required_public_slug_unique RENAME TO knowledge_pages_required_public_path_unique;
DROP INDEX knowledge_pages_public_path_unique;

ALTER TABLE assets ADD COLUMN public_path text;
UPDATE assets SET public_path=current_path WHERE published_at IS NOT NULL;

-- An in-flight intent was reviewed under the previous URL model. Expire it
-- instead of allowing it to publish at a path the owner did not confirm.
UPDATE publication_intents
SET consumed_at=now()
WHERE consumed_at IS NULL;

UPDATE publication_intents intent
SET public_path=version.path
FROM knowledge_page_versions version
WHERE intent.action IN ('publish','republish')
  AND intent.target_kind='page'
  AND version.id=intent.version_id
  AND version.page_id=intent.target_id;

UPDATE publication_intents intent
SET public_path=asset.current_path
FROM assets asset
WHERE intent.action IN ('publish','republish')
  AND intent.target_kind='asset'
  AND asset.id=intent.target_id;

UPDATE publication_intents SET public_path=NULL WHERE action='unpublish';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM knowledge_pages page
    JOIN knowledge_page_versions version
      ON version.id=page.published_version_id AND version.page_id=page.id
    WHERE page.required_public_path IS NOT NULL
      AND version.path IS DISTINCT FROM page.required_public_path
  ) THEN
    RAISE EXCEPTION 'the required public page must have the knowledge path about before this migration';
  END IF;

  IF EXISTS (
    SELECT version.path
    FROM knowledge_pages page
    JOIN knowledge_page_versions version
      ON version.id=page.published_version_id AND version.page_id=page.id
    WHERE page.published_version_id IS NOT NULL AND page.archived_at IS NULL
    GROUP BY version.path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'published page versions contain duplicate knowledge paths';
  END IF;
END;
$$;

UPDATE knowledge_pages page
SET public_path=version.path
FROM knowledge_page_versions version
WHERE version.id=page.published_version_id AND version.page_id=page.id;

CREATE UNIQUE INDEX knowledge_pages_public_path_unique
  ON knowledge_pages(public_path) WHERE public_path IS NOT NULL;

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_public_path_format CHECK (
    public_path IS NULL
    OR (
      public_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND public_path !~ '//'
      AND right(public_path, 1) <> '/'
    )
  ),
  ADD CONSTRAINT knowledge_pages_required_public_path CHECK (
    required_public_path IS NULL
    OR (
      required_public_path = 'about'
      AND public_path = required_public_path
      AND published_version_id IS NOT NULL
      AND archived_at IS NULL
    )
  );

ALTER TABLE assets
  ADD CONSTRAINT assets_public_path_format CHECK (
    public_path IS NULL
    OR (
      public_path ~ '^[a-z0-9][a-z0-9/_-]*$'
      AND public_path !~ '//'
      AND right(public_path, 1) <> '/'
    )
  ),
  ADD CONSTRAINT assets_publication_pair CHECK (
    (published_at IS NULL AND public_path IS NULL)
    OR (published_at IS NOT NULL AND public_path IS NOT NULL)
  );

CREATE UNIQUE INDEX assets_public_path_unique
  ON assets(public_path) WHERE public_path IS NOT NULL;

ALTER TABLE publication_intents
  ADD CONSTRAINT publication_intents_target_fields CHECK (
    (
      action = 'unpublish'
      AND version_id IS NULL
      AND public_path IS NULL
    )
    OR (
      action IN ('publish', 'republish')
      AND public_path IS NOT NULL
      AND (
        (target_kind = 'page' AND version_id IS NOT NULL)
        OR (target_kind = 'asset' AND version_id IS NULL)
      )
    )
  );

CREATE VIEW published_pages
WITH (security_barrier = true)
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

CREATE VIEW published_assets
WITH (security_barrier = true)
AS
SELECT id,public_path,filename,content_type,size_bytes,content_hash,s3_object_key,
       width,height,duration_seconds,published_at
FROM assets
WHERE published_at IS NOT NULL AND public_path IS NOT NULL AND deleted_at IS NULL;

CREATE VIEW public_mcp_pages
WITH (security_barrier = true)
AS
WITH without_comments AS (
  SELECT
    page.public_path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(page.body_markdown,'<!--.*?-->','','gis'),
      '<!--.*$','','gis'
    ) AS body_markdown
  FROM published_pages page
),
without_scripts AS (
  SELECT
    page.public_path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(page.body_markdown,'<script([[:space:]][^>]*)?>.*?</script[[:space:]]*>','','gis'),
      '<script([[:space:]][^>]*)?>.*$','','gis'
    ) AS body_markdown
  FROM without_comments page
),
without_styles AS (
  SELECT
    page.public_path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(page.body_markdown,'<style([[:space:]][^>]*)?>.*?</style[[:space:]]*>','','gis'),
      '<style([[:space:]][^>]*)?>.*$','','gis'
    ) AS body_markdown
  FROM without_scripts page
),
without_hidden_html AS (
  SELECT
    page.public_path,
    page.title,
    page.version_created_at,
    regexp_replace(page.body_markdown,'<[a-z!?/][^>]*(>|$)','','gis') AS body_markdown
  FROM without_styles page
),
safe_pages AS (
  SELECT
    page.public_path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              page.body_markdown,
              '!\[([^]]*)\]\(context-use://asset/[0-9a-f-]{36}\)(\{[^}\r\n]*\})?',
              '\1','gi'
            ),
            '\[([^]]*)\]\(context-use://page/[0-9a-f-]{36}\)',
            '\1','gi'
          ),
          '\[\[[a-z0-9][a-z0-9/_-]*\|([^]\r\n]+)\]\]',
          '\1','gi'
        ),
        '\[\[[a-z0-9][a-z0-9/_-]*\]\]',
        '[linked page]','gi'
      ),
      'context-use://(page|asset)/[0-9a-f-]{36}',
      '[private reference]','gi'
    ) AS body_markdown
  FROM without_hidden_html page
)
SELECT
  child.public_path,
  child.title,
  child.body_markdown,
  parent.public_path AS parent_path
FROM safe_pages child
LEFT JOIN LATERAL (
  SELECT candidate.public_path
  FROM safe_pages candidate
  WHERE left(child.public_path, length(candidate.public_path) + 1) = candidate.public_path || '/'
  ORDER BY length(candidate.public_path) DESC,
           candidate.version_created_at DESC,
           candidate.public_path
  LIMIT 1
) parent ON true;

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
      IF NOT EXISTS (
        SELECT 1 FROM knowledge_page_versions
        WHERE id=intent.version_id AND page_id=intent.target_id AND path=intent.public_path
      ) THEN
        RAISE EXCEPTION 'page version or public path mismatch' USING ERRCODE = '23503';
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
    IF intent.action IN ('publish', 'republish') THEN
      UPDATE assets
      SET published_at=now(),public_path=intent.public_path
      WHERE id=intent.target_id AND deleted_at IS NULL AND current_path=intent.public_path;
    ELSE
      UPDATE assets SET published_at=NULL,public_path=NULL WHERE id=intent.target_id;
    END IF;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE publication_intents SET consumed_at=now() WHERE id=intent.id;
END;
$$;

CREATE OR REPLACE FUNCTION protect_required_public_page_intent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  required_path text;
BEGIN
  IF NEW.target_kind <> 'page' THEN RETURN NEW; END IF;

  SELECT required_public_path INTO required_path
  FROM knowledge_pages
  WHERE id=NEW.target_id;

  IF required_path IS NOT NULL
     AND (NEW.action='unpublish' OR NEW.public_path IS DISTINCT FROM required_path) THEN
    RAISE EXCEPTION 'the required /p/% page cannot be moved or unpublished', required_path
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_protect_required_public_page
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION protect_required_public_page_intent();

REVOKE ALL ON published_pages,published_assets,public_mcp_pages FROM PUBLIC;
GRANT SELECT ON published_pages,published_assets TO context_use_public;
GRANT SELECT ON public_mcp_pages TO context_use_public_mcp;
REVOKE ALL ON FUNCTION protect_required_public_page_intent() FROM PUBLIC;
