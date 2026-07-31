-- Directory summaries are public-listing copy, not structural knowledge. A
-- directory can exist privately before the owner chooses how it should be
-- described in a generated public parent index.
ALTER TABLE knowledge_directories
  DROP CONSTRAINT knowledge_directories_summary_check;

ALTER TABLE knowledge_directories
  ADD CONSTRAINT knowledge_directories_summary_check CHECK (
    length(summary)<=320 AND summary !~ E'[\r\n]'
  );
