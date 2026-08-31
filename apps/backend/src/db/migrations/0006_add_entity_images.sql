create table "entity_image" (
  "owner_id" text not null,
  "entity_id" text not null,
  "asset_id" text not null,
  primary key ("entity_id"),
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id") on delete cascade,
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id") on delete cascade
);

create index "entity_image_asset_idx" on "entity_image" ("owner_id", "asset_id");
