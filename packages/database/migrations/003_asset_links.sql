CREATE TABLE knowledge_asset_links (
  source_version_id uuid NOT NULL REFERENCES knowledge_page_versions(id) ON DELETE CASCADE,
  target_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_version_id, target_asset_id)
);
CREATE INDEX knowledge_asset_links_target_idx ON knowledge_asset_links(target_asset_id);

REVOKE ALL ON knowledge_asset_links FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON knowledge_asset_links TO context_use_dashboard;
GRANT SELECT, INSERT, DELETE ON knowledge_asset_links TO context_use_mcp;
GRANT SELECT ON knowledge_asset_links TO context_use_backup;
