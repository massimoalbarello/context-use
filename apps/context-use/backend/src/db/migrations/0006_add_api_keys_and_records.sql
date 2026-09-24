create table "api_key" (
  "id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "name" text not null,
  "api_key_sha256" text not null,
  "created_at" text not null,
  "revoked_at" text,
  primary key ("id"),
  unique ("owner_id", "readable_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  check (length("id") = 36),
  check (length("readable_id") between 1 and 120),
  check (substr("readable_id", 1, 1) glob '[a-z0-9]'),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check (length(trim("name")) between 1 and 160),
  check ("api_key_sha256" not glob '*[^a-f0-9]*' and length("api_key_sha256") = 64),
  check (length(trim("created_at")) > 0),
  check ("revoked_at" is null or length(trim("revoked_at")) > 0)
);

create unique index "api_key_fingerprint_uidx" on "api_key" ("api_key_sha256");
create unique index "api_key_active_name_uidx" on "api_key" ("owner_id", "name")
  where "revoked_at" is null;

create table "record" (
  "owner_id" text not null,
  "sync_id" text not null default '',
  "sync_revision" integer not null default 0,
  "readable_id" text not null,
  "provider" text not null,
  "kind" text not null,
  "source_id" text not null,
  "source_url" text,
  "title" text,
  "source_created_at" text,
  "source_updated_at" text,
  "deleted_at" text,
  "storage_key" text,
  "content_hash" text,
  "size_bytes" integer,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("owner_id", "sync_id", "provider", "kind", "source_id"),
  unique ("owner_id", "readable_id"),
  unique ("storage_key"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  check (length("readable_id") between 1 and 120),
  check (substr("readable_id", 1, 1) glob '[a-z0-9]'),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check (("sync_id" = '' and "sync_revision" = 0) or (length("sync_id") > 0 and "sync_revision" > 0)),
  check (length(trim("source_id")) > 0),
  check (length(trim("kind")) > 0),
  check (length(trim("provider")) > 0),
  check ("deleted_at" is not null or ("title" is not null and length(trim("title")) > 0
    and "storage_key" is not null and "content_hash" is not null and "size_bytes" is not null and "size_bytes" >= 0)),
  check ("deleted_at" is null or ("source_updated_at" is not null and "storage_key" is null and "content_hash" is null and "size_bytes" is null)),
  check ("content_hash" is null or ("content_hash" not glob '*[^a-f0-9]*' and length("content_hash") = 64)),
  check (length(trim("created_at")) > 0),
  check (length(trim("updated_at")) > 0)
);
create index "record_owner_updated_idx" on "record" ("owner_id", "updated_at" desc, "readable_id") where "deleted_at" is null;
create index "record_source_created_idx" on "record" ("owner_id", julianday("source_created_at")) where "deleted_at" is null;
create index "record_source_updated_idx" on "record" ("owner_id", julianday("source_updated_at")) where "deleted_at" is null;
create index "record_provider_kind_idx" on "record" ("owner_id", "provider", "kind") where "deleted_at" is null;

create table "record_asset_usage" (
  "owner_id" text not null,
  "source_record_readable_id" text not null,
  "target_asset_id" text not null,
  "presentation" text not null,
  primary key ("owner_id", "source_record_readable_id", "target_asset_id", "presentation"),
  foreign key ("owner_id", "source_record_readable_id") references "record" ("owner_id", "readable_id") on delete cascade,
  foreign key ("target_asset_id", "owner_id") references "asset" ("id", "owner_id") on delete cascade,
  check ("presentation" in ('embed', 'attachment'))
);
create index "record_asset_usage_target_idx" on "record_asset_usage" ("owner_id", "target_asset_id");
