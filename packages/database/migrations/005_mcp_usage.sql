CREATE TABLE mcp_client_usage (
  client_id text NOT NULL REFERENCES "oauthClient"("clientId") ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);

REVOKE ALL ON mcp_client_usage FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_client_usage TO context_use_auth;
GRANT SELECT ON security_audit_events TO context_use_auth;
GRANT SELECT ON mcp_client_usage TO context_use_backup;
