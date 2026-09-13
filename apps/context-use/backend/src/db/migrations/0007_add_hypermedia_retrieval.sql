create table "hypermedia_search_document" (
  "id" integer primary key,
  "owner_id" text not null,
  "resource_type" text not null,
  "readable_id" text not null,
  "participant_names" text not null default '[]',
  unique ("owner_id", "resource_type", "readable_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  check ("resource_type" in ('entity', 'knowledge_page', 'asset', 'record')),
  check (json_valid("participant_names") and json_type("participant_names") = 'array')
);

create virtual table "hypermedia_search_fts" using fts5(
  "readable_id",
  "label",
  "summary",
  "body",
  "metadata",
  content='',
  contentless_delete=1,
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3'
);

create trigger "hypermedia_search_document_delete"
after delete on "hypermedia_search_document"
begin
  delete from "hypermedia_search_fts" where "rowid" = old."id";
end;
