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
  "title" text not null,
  "excerpt" text not null,
  "provider" text not null,
  "source_id" text not null,
  "kind" text not null,
  "record_id" text not null,
  "revision" integer not null,
  "operation" text not null,
  "content_hash" text not null,
  "committed_at" text not null,
  "markdown" text,
  "revision_fingerprint" text not null,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("sync_id", "source_id", "kind", "record_id"),
  unique ("owner_id", "readable_id"),
  foreign key ("sync_id", "owner_id")
    references "record_sync" ("id", "owner_id") on delete cascade,
  check (length(trim("provider")) > 0),
  check (length("readable_id") between 1 and 120),
  check (substr("readable_id", 1, 1) glob '[a-z0-9]'),
  check ("readable_id" not glob '*[^a-z0-9-]*'),
  check (length("title") between 1 and 240),
  check (length("excerpt") between 1 and 280),
  check (length(trim("source_id")) > 0),
  check (length(trim("kind")) > 0),
  check (length(trim("record_id")) > 0),
  check ("revision" between 1 and 9007199254740991),
  check ("operation" in ('added', 'updated', 'deleted')),
  check ("content_hash" not glob '*[^a-f0-9]*' and length("content_hash") = 64),
  check (length(trim("committed_at")) > 0),
  check (
    ("operation" = 'deleted' and "markdown" is null)
    or ("operation" in ('added', 'updated') and length("markdown") > 0)
  ),
  check (
    "revision_fingerprint" not glob '*[^a-f0-9]*' and length("revision_fingerprint") = 64
  ),
  check (length(trim("created_at")) > 0),
  check (length(trim("updated_at")) > 0)
);

create table "record_search_document" (
  "id" integer primary key,
  "sync_id" text not null,
  "owner_id" text not null,
  "provider" text not null,
  "source_id" text not null,
  "kind" text not null,
  "record_id" text not null,
  "revision" integer not null,
  "label" text not null,
  "body" text not null,
  unique ("sync_id", "source_id", "kind", "record_id"),
  foreign key ("sync_id", "owner_id")
    references "record_sync" ("id", "owner_id") on delete cascade,
  foreign key ("sync_id", "source_id", "kind", "record_id")
    references "record" ("sync_id", "source_id", "kind", "record_id") on delete cascade,
  check ("revision" between 1 and 9007199254740991),
  check (length(trim("label")) > 0),
  check (length("body") > 0)
);

create virtual table "record_search_fts" using fts5(
  "provider",
  "source_id",
  "kind",
  "record_id",
  "label",
  "body",
  content='record_search_document',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3'
);

create trigger "record_search_document_insert"
after insert on "record_search_document"
begin
  insert into "record_search_fts" (
    "rowid", "provider", "source_id", "kind", "record_id", "label", "body"
  ) values (
    new."id", new."provider", new."source_id", new."kind", new."record_id", new."label",
    new."body"
  );
end;

create trigger "record_search_document_delete"
after delete on "record_search_document"
begin
  insert into "record_search_fts" (
    "record_search_fts", "rowid", "provider", "source_id", "kind", "record_id", "label", "body"
  ) values (
    'delete', old."id", old."provider", old."source_id", old."kind", old."record_id", old."label",
    old."body"
  );
end;

create trigger "record_search_document_update"
after update on "record_search_document"
begin
  insert into "record_search_fts" (
    "record_search_fts", "rowid", "provider", "source_id", "kind", "record_id", "label", "body"
  ) values (
    'delete', old."id", old."provider", old."source_id", old."kind", old."record_id", old."label",
    old."body"
  );
  insert into "record_search_fts" (
    "rowid", "provider", "source_id", "kind", "record_id", "label", "body"
  ) values (
    new."id", new."provider", new."source_id", new."kind", new."record_id", new."label",
    new."body"
  );
end;

create index "record_owner_kind_idx" on "record" ("owner_id", "provider", "kind", "updated_at" desc);
create index "record_search_owner_idx"
  on "record_search_document" ("owner_id", "sync_id", "kind", "id");
