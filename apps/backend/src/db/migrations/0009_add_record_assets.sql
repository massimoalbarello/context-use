create table "record_asset_reference" (
  "owner_id" text not null,
  "record_readable_id" text not null,
  "asset_id" text not null,
  primary key ("owner_id", "record_readable_id", "asset_id"),
  foreign key ("owner_id", "record_readable_id") references "record" ("owner_id", "readable_id"),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id")
);

create index "record_asset_usage_idx" on "record_asset_reference" ("owner_id", "asset_id");
