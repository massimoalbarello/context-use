-- A directory's required title and one-sentence summary describe its generated
-- index. Expose them only while the directory has at least one published
-- descendant; introductions and private child metadata remain private.
GRANT SELECT (title,summary)
  ON knowledge_directories TO context_use_projection_owner;

CREATE VIEW published_directories
WITH (security_barrier=true,security_invoker=false)
AS
SELECT
  directory.current_path AS path,
  directory.title,
  directory.summary
FROM knowledge_directories directory
WHERE EXISTS (
  SELECT 1
  FROM published_page_sources page
  WHERE directory.current_path=''
     OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
);

GRANT CREATE ON SCHEMA public TO context_use_projection_owner;
ALTER VIEW published_directories OWNER TO context_use_projection_owner;
REVOKE CREATE ON SCHEMA public FROM context_use_projection_owner;

GRANT SELECT ON published_directories TO context_use_public;
GRANT SELECT ON published_directories TO context_use_backup;
