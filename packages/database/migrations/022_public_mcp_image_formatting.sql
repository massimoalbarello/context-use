-- Public webpage rendering understands a fixed attribute grammar after stable
-- image references. The anonymous Markdown projection exposes neither asset
-- identities nor presentation-only attributes, so consume both together.
CREATE OR REPLACE VIEW public_mcp_pages
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
