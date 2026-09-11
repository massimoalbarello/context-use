create table "knowledge_page_record_reference" (
  "owner_id" text not null,
  "source_revision_id" text not null,
  "target_record_readable_id" text not null,
  primary key ("owner_id", "source_revision_id", "target_record_readable_id"),
  foreign key ("source_revision_id", "owner_id")
    references "knowledge_page_revision" ("id", "owner_id") on delete cascade,
  foreign key ("owner_id", "target_record_readable_id")
    references "record" ("owner_id", "readable_id") on delete cascade
);

create index "knowledge_page_record_reference_target_idx"
  on "knowledge_page_record_reference" ("owner_id", "target_record_readable_id");
