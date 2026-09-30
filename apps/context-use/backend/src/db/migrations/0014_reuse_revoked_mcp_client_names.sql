drop index "mcp_client_authorization_owner_name_uidx";

create unique index "mcp_client_authorization_active_owner_name_uidx"
  on "mcp_client_authorization" ("owner_id", "name" collate nocase)
  where "archived_at" is null;
