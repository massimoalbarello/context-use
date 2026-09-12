create table "asset_import" (
  "owner_id" text not null,
  "sync_id" text not null,
  "import_key" text not null,
  "asset_id" text not null,
  primary key ("owner_id", "sync_id", "import_key"),
  unique ("asset_id"),
  foreign key ("sync_id", "owner_id") references "record_sync" ("id", "owner_id"),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id"),
  check (length("import_key") between 1 and 128),
  check ("import_key" not glob '*[^a-zA-Z0-9_-]*')
);
