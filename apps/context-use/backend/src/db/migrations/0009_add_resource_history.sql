create table "resource_change" (
  "sequence" integer primary key autoincrement,
  "owner_id" text not null references "auth_user" ("id") on delete cascade,
  "resource_type" text not null check ("resource_type" in ('entity', 'page', 'asset', 'record')),
  "readable_id" text not null,
  "name" text not null,
  "action" text not null check ("action" in ('created', 'updated', 'archived', 'deleted')),
  "message" text not null check (length(trim("message")) between 1 and 280),
  "author_kind" text not null check ("author_kind" in ('owner', 'mcp_client', 'sync', 'api_key')),
  "author_name" text not null,
  "author_reference" text,
  "details" text not null check (json_valid("details") and json_type("details") = 'array'),
  "revision_number" integer check ("revision_number" > 0),
  "created_at" text not null
);

create index "resource_change_owner_order" on "resource_change" ("owner_id", "created_at" desc, "sequence" desc);
