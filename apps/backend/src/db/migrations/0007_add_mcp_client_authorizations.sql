create table "mcp_client_authorization" (
  "id" text not null primary key,
  "owner_id" text not null references "auth_user" ("id") on delete cascade,
  "name" text not null,
  "oauth_client_id" text not null references "auth_oauthClient" ("clientId"),
  "verified_client_id" text,
  "created_at" text not null,
  "updated_at" text not null,
  "archived_at" text
);

create index "mcp_client_authorization_owner_status_idx"
  on "mcp_client_authorization" ("owner_id", "archived_at");

create unique index "mcp_client_authorization_active_oauth_client_uidx"
  on "mcp_client_authorization" ("owner_id", "oauth_client_id")
  where "archived_at" is null;
