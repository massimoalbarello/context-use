CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL DEFAULT 'context-use-owner'
    REFERENCES "user"(id) ON DELETE CASCADE,
  reply_to text NOT NULL CHECK (length(reply_to) BETWEEN 3 AND 320),
  message text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbound_messages_owner_created_idx
  ON inbound_messages(owner_user_id, created_at DESC, id DESC);

REVOKE ALL ON inbound_messages FROM PUBLIC;

GRANT SELECT ON inbound_messages TO context_use_dashboard;
GRANT INSERT (id, reply_to, message) ON inbound_messages TO context_use_public_mcp;
GRANT SELECT ON inbound_messages TO context_use_backup;
