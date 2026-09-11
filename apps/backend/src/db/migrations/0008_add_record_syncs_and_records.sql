create table "record_sync" (
  "id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "name" text not null,
  "api_key_sha256" text not null,
  "created_at" text not null,
  "revoked_at" text,
  primary key ("id"),
  unique ("id", "owner_id"),
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

create unique index "record_sync_api_key_uidx" on "record_sync" ("api_key_sha256");
create unique index "record_sync_active_name_uidx" on "record_sync" ("owner_id", "name")
  where "revoked_at" is null;

create table "record" (
  "sync_id" text not null,
  "owner_id" text not null,
  "readable_id" text not null,
  "source_id" text not null,
  "kind" text not null,
  "record_id" text not null,
  "revision" integer not null,
  "operation" text not null,
  "revision_hash" text not null,
  "storage_key" text not null,
  "content_hash" text not null,
  "size_bytes" integer not null,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("owner_id", "sync_id", "source_id", "kind", "record_id"),
  unique ("owner_id", "readable_id"),
  unique ("storage_key"),
  foreign key ("sync_id", "owner_id")
    references "record_sync" ("id", "owner_id") on delete cascade,
  check (length("readable_id") between 1 and 120),
  check (substr("readable_id", 1, 1) glob '[a-z0-9]'),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check (length(trim("source_id")) > 0),
  check (length(trim("kind")) > 0),
  check (length(trim("record_id")) > 0),
  check ("revision" between 1 and 9007199254740991),
  check ("operation" in ('added', 'updated', 'deleted')),
  check ("revision_hash" not glob '*[^a-f0-9]*' and length("revision_hash") = 64),
  check ("content_hash" not glob '*[^a-f0-9]*' and length("content_hash") = 64),
  check (length(trim("storage_key")) > 0),
  check ("size_bytes" > 0),
  check (length(trim("created_at")) > 0),
  check (length(trim("updated_at")) > 0)
);

create index "record_owner_updated_idx"
  on "record" ("owner_id", "updated_at" desc, "readable_id")
  where "operation" <> 'deleted';
