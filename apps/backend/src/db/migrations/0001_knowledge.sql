create table "entity" (
  "id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "name" text not null,
  "description" text not null,
  "image_asset_id" text,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("id"),
  unique ("id", "owner_id"),
  unique ("owner_id", "readable_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  foreign key ("image_asset_id", "owner_id") references "asset" ("id", "owner_id")
    deferrable initially deferred,
  check (length("readable_id") between 1 and 120),
  check ("readable_id" = lower("readable_id")),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check ("readable_id" not like '-%' and "readable_id" not like '%-' and "readable_id" not like '%--%'),
  check (length(trim("name")) between 1 and 160),
  check (length(trim("description")) between 1 and 600)
);

create table "knowledge_profile" (
  "owner_id" text not null,
  "self_entity_id" text not null,
  primary key ("owner_id"),
  unique ("self_entity_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  foreign key ("self_entity_id", "owner_id") references "entity" ("id", "owner_id")
    on delete cascade
);

create table "knowledge_page" (
  "id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "current_revision_id" text not null,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("id"),
  unique ("id", "owner_id"),
  unique ("owner_id", "readable_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  foreign key ("current_revision_id", "id", "owner_id")
    references "knowledge_page_revision" ("id", "page_id", "owner_id")
    deferrable initially deferred,
  check (length("readable_id") between 1 and 120),
  check ("readable_id" = lower("readable_id")),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check ("readable_id" not like '-%' and "readable_id" not like '%-' and "readable_id" not like '%--%')
);

create table "knowledge_page_revision" (
  "id" text not null,
  "page_id" text not null,
  "owner_id" text not null,
  "revision_number" integer not null,
  "title" text not null,
  "excerpt" text not null,
  "temporal_coverage" text,
  "storage_key" text not null,
  "size_bytes" integer not null,
  "content_hash" text not null,
  "author_kind" text not null,
  "author_mcp_client_authorization_id" text,
  "author_name" text not null,
  "created_at" text not null,
  primary key ("id"),
  unique ("id", "owner_id"),
  unique ("id", "page_id", "owner_id"),
  unique ("page_id", "revision_number"),
  unique ("storage_key"),
  foreign key ("page_id", "owner_id") references "knowledge_page" ("id", "owner_id")
    on delete cascade deferrable initially deferred,
  foreign key ("author_mcp_client_authorization_id", "owner_id")
    references "mcp_client_authorization" ("id", "owner_id"),
  check ("revision_number" > 0),
  check (length(trim("title")) between 1 and 240),
  check (length("excerpt") <= 280),
  check (
    "temporal_coverage" is null
    or (
      length("temporal_coverage") between 1 and 23
      and "temporal_coverage" = trim("temporal_coverage")
    )
  ),
  check ("size_bytes" between 1 and 1000000),
  check ("content_hash" not glob '*[^a-f0-9]*' and length("content_hash") = 64),
  check (
    (
      "author_kind" = 'owner'
      and "author_mcp_client_authorization_id" is null
      and length(trim("author_name")) between 1 and 160
    )
    or (
      "author_kind" = 'mcp_client'
      and "author_mcp_client_authorization_id" is not null
      and length(trim("author_name")) between 1 and 80
    )
  )
);

create table "knowledge_page_entity_mention" (
  "owner_id" text not null,
  "source_revision_id" text not null,
  "target_entity_id" text not null,
  primary key ("source_revision_id", "target_entity_id"),
  foreign key ("source_revision_id", "owner_id")
    references "knowledge_page_revision" ("id", "owner_id") on delete cascade,
  foreign key ("target_entity_id", "owner_id")
    references "entity" ("id", "owner_id") on delete cascade
);

create table "knowledge_page_reference" (
  "owner_id" text not null,
  "source_revision_id" text not null,
  "target_page_id" text not null,
  "target_fragment" text not null default '',
  primary key ("source_revision_id", "target_page_id", "target_fragment"),
  foreign key ("source_revision_id", "owner_id")
    references "knowledge_page_revision" ("id", "owner_id") on delete cascade,
  foreign key ("target_page_id", "owner_id")
    references "knowledge_page" ("id", "owner_id") on delete cascade
);

create index "entity_owner_updated_idx" on "entity" ("owner_id", "updated_at" desc);
create unique index "entity_owner_image_asset_idx"
  on "entity" ("owner_id", "image_asset_id") where "image_asset_id" is not null;
create index "knowledge_page_owner_updated_idx" on "knowledge_page" ("owner_id", "updated_at" desc);
create index "knowledge_page_mention_target_idx"
  on "knowledge_page_entity_mention" ("owner_id", "target_entity_id");
create index "knowledge_page_reference_target_idx"
  on "knowledge_page_reference" ("owner_id", "target_page_id");
