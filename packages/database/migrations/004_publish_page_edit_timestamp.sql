-- A public page may disclose when its immutable published version was created.
-- This is the content's edit time, independent of later publish/unpublish state.
CREATE OR REPLACE VIEW published_pages
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  page.public_path,
  page.title,
  page.summary,
  project_public_markdown(page.public_path) AS body_markdown,
  page.version_created_at AS last_edited_at
FROM published_page_sources page;
