create table "hypermedia_search_document" (
  "id" integer primary key,
  "owner_id" text not null,
  "resource_type" text not null,
  "readable_id" text not null,
  "label" text not null,
  "summary" text not null,
  "body" text not null,
  "metadata" text not null default '',
  unique ("owner_id", "resource_type", "readable_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  check ("resource_type" in ('entity', 'knowledge_page', 'asset', 'record'))
);

create virtual table "hypermedia_search_fts" using fts5(
  "readable_id",
  "label",
  "summary",
  "body",
  "metadata",
  content='hypermedia_search_document',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3'
);

create trigger "hypermedia_search_document_insert"
after insert on "hypermedia_search_document"
begin
  insert into "hypermedia_search_fts" (
    "rowid", "readable_id", "label", "summary", "body", "metadata"
  ) values (
    new."id", new."readable_id", new."label", new."summary", new."body", new."metadata"
  );
end;

create trigger "hypermedia_search_document_delete"
after delete on "hypermedia_search_document"
begin
  insert into "hypermedia_search_fts" (
    "hypermedia_search_fts", "rowid", "readable_id", "label", "summary", "body", "metadata"
  ) values (
    'delete', old."id", old."readable_id", old."label", old."summary", old."body", old."metadata"
  );
end;

create trigger "hypermedia_search_document_update"
after update on "hypermedia_search_document"
begin
  insert into "hypermedia_search_fts" (
    "hypermedia_search_fts", "rowid", "readable_id", "label", "summary", "body", "metadata"
  ) values (
    'delete', old."id", old."readable_id", old."label", old."summary", old."body", old."metadata"
  );
  insert into "hypermedia_search_fts" (
    "rowid", "readable_id", "label", "summary", "body", "metadata"
  ) values (
    new."id", new."readable_id", new."label", new."summary", new."body", new."metadata"
  );
end;
