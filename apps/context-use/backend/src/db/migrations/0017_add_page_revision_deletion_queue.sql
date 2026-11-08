create table "knowledge_page_revision_deletion_queue" (
  "storage_key" text not null primary key,
  "owner_id" text not null,
  "page_id" text not null,
  foreign key ("page_id", "owner_id") references "knowledge_page" ("id", "owner_id") on delete cascade
);

create index "knowledge_page_revision_deletion_queue_page_idx"
  on "knowledge_page_revision_deletion_queue" ("owner_id", "page_id", "storage_key");
