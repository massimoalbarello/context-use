ALTER TABLE assets ADD COLUMN current_path text;

UPDATE assets SET current_path = 'assets/' || id::text WHERE current_path IS NULL;

ALTER TABLE assets
  ALTER COLUMN current_path SET NOT NULL,
  ADD CONSTRAINT assets_path_format CHECK (
    current_path ~ '^[a-z0-9][a-z0-9/_-]*$'
    AND current_path !~ '//'
    AND right(current_path, 1) <> '/'
  );

CREATE UNIQUE INDEX assets_active_path_unique
  ON assets (current_path) WHERE deleted_at IS NULL;

GRANT INSERT (current_path) ON assets TO context_use_dashboard;
GRANT UPDATE (current_path) ON assets TO context_use_dashboard;
