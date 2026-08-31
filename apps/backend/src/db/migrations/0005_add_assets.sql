create table "asset" (
  "id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "name" text not null,
  "media_type" text not null,
  "extension" text,
  "size_bytes" integer not null,
  "content_hash" text not null,
  "storage_key" text not null,
  "created_at" text not null,
  "updated_at" text not null,
  "archived_at" text,
  primary key ("id"),
  unique ("id", "owner_id"),
  unique ("owner_id", "readable_id"),
  unique ("storage_key"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  check (length("readable_id") between 1 and 120),
  check ("readable_id" = lower("readable_id")),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check ("readable_id" not like '-%' and "readable_id" not like '%-' and "readable_id" not like '%--%'),
  check (length(trim("name")) between 1 and 160),
  check (length(trim("media_type")) between 1 and 160),
  check ("extension" is null or "extension" not glob '*[^a-z0-9]*'),
  check ("size_bytes" between 1 and 5242880),
  check ("content_hash" not glob '*[^a-f0-9]*' and length("content_hash") = 64)
);

create table "knowledge_page_asset_usage" (
  "owner_id" text not null,
  "source_revision_id" text not null,
  "target_asset_id" text not null,
  "presentation" text not null,
  primary key ("source_revision_id", "target_asset_id", "presentation"),
  foreign key ("source_revision_id", "owner_id")
    references "knowledge_page_revision" ("id", "owner_id") on delete cascade,
  foreign key ("target_asset_id", "owner_id")
    references "asset" ("id", "owner_id") on delete cascade,
  check ("presentation" in ('embed', 'attachment'))
);

create index "asset_owner_updated_idx" on "asset" ("owner_id", "updated_at" desc);
create index "knowledge_page_asset_usage_target_idx"
  on "knowledge_page_asset_usage" ("owner_id", "target_asset_id");
