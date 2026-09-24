create table "knowledge_page_publication" (
  "page_id" text not null,
  "owner_id" text not null,
  "public_id" text not null,
  "revision_id" text,
  "published_at" text,
  primary key ("page_id"),
  unique ("public_id"),
  foreign key ("page_id", "owner_id") references "knowledge_page" ("id", "owner_id")
    on delete cascade,
  foreign key ("revision_id", "page_id", "owner_id")
    references "knowledge_page_revision" ("id", "page_id", "owner_id"),
  check ("public_id" glob 'page_?*' and "public_id" not glob '*[^a-z0-9_-]*'),
  check ("public_id" != "page_id"),
  check (
    ("published_at" is null and "revision_id" is null)
    or ("published_at" is not null and length(trim("published_at")) > 0 and "revision_id" is not null)
  )
);

create table "entity_publication" (
  "entity_id" text not null,
  "owner_id" text not null,
  "public_id" text not null,
  "published_at" text check ("published_at" is null or length(trim("published_at")) > 0),
  primary key ("entity_id"),
  unique ("public_id"),
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id")
    on delete cascade,
  check ("public_id" glob 'entity_?*' and "public_id" not glob '*[^a-z0-9_-]*'),
  check ("public_id" != "entity_id")
);

create table "asset_publication" (
  "asset_id" text not null,
  "owner_id" text not null,
  "public_id" text not null,
  "published_at" text check ("published_at" is null or length(trim("published_at")) > 0),
  primary key ("asset_id"),
  unique ("public_id"),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id")
    on delete cascade,
  check ("public_id" glob 'asset_?*' and "public_id" not glob '*[^a-z0-9_-]*'),
  check ("public_id" != "asset_id")
);

create index "knowledge_page_publication_owner_idx" on "knowledge_page_publication" ("owner_id");
create index "entity_publication_owner_idx" on "entity_publication" ("owner_id");
create index "asset_publication_owner_idx" on "asset_publication" ("owner_id");
