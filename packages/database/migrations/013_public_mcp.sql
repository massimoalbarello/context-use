DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'context_use_public_mcp') THEN
    CREATE ROLE context_use_public_mcp
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

-- The anonymous MCP role receives a deliberately lossy projection. Internal UUIDs,
-- version metadata, asset metadata, raw knowledge paths, and unresolved reference
-- targets never cross this database boundary.
CREATE VIEW public_mcp_pages
WITH (security_barrier = true)
AS
WITH without_comments AS (
  SELECT
    page.public_slug,
    page.path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(
        page.body_markdown,
        '<!--.*?-->',
        '',
        'gis'
      ),
      '<!--.*$',
      '',
      'gis'
    ) AS body_markdown
  FROM published_pages page
),
without_scripts AS (
  SELECT
    page.public_slug,
    page.path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(
        page.body_markdown,
        '<script([[:space:]][^>]*)?>.*?</script[[:space:]]*>',
        '',
        'gis'
      ),
      '<script([[:space:]][^>]*)?>.*$',
      '',
      'gis'
    ) AS body_markdown
  FROM without_comments page
),
without_styles AS (
  SELECT
    page.public_slug,
    page.path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(
        page.body_markdown,
        '<style([[:space:]][^>]*)?>.*?</style[[:space:]]*>',
        '',
        'gis'
      ),
      '<style([[:space:]][^>]*)?>.*$',
      '',
      'gis'
    ) AS body_markdown
  FROM without_scripts page
),
without_hidden_html AS (
  SELECT
    page.public_slug,
    page.path,
    page.title,
    page.version_created_at,
    regexp_replace(
      page.body_markdown,
      '<[a-z!?/][^>]*(>|$)',
      '',
      'gis'
    ) AS body_markdown
  FROM without_styles page
),
safe_pages AS (
  SELECT
    page.public_slug,
    page.path,
    page.title,
    page.version_created_at,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              page.body_markdown,
              '!\[([^]]*)\]\(context-use://asset/[0-9a-f-]{36}\)',
              '\1',
              'gi'
            ),
            '\[([^]]*)\]\(context-use://page/[0-9a-f-]{36}\)',
            '\1',
            'gi'
          ),
          '\[\[[a-z0-9][a-z0-9/_-]*\|([^]\r\n]+)\]\]',
          '\1',
          'gi'
        ),
        '\[\[[a-z0-9][a-z0-9/_-]*\]\]',
        '[linked page]',
        'gi'
      ),
      'context-use://(page|asset)/[0-9a-f-]{36}',
      '[private reference]',
      'gi'
    ) AS body_markdown
  FROM without_hidden_html page
)
SELECT
  child.public_slug,
  child.title,
  child.body_markdown,
  parent.public_slug AS parent_slug
FROM safe_pages child
LEFT JOIN LATERAL (
  SELECT candidate.public_slug
  FROM safe_pages candidate
  WHERE left(child.path, length(candidate.path) + 1) = candidate.path || '/'
  ORDER BY length(candidate.path) DESC,
           candidate.version_created_at DESC,
           candidate.public_slug
  LIMIT 1
) parent ON true;

REVOKE ALL ON public_mcp_pages FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO context_use_public_mcp;
GRANT SELECT ON public_mcp_pages TO context_use_public_mcp;
