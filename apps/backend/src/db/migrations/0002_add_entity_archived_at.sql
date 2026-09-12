alter table "entity" add column "archived_at" text
  check ("archived_at" is null or length(trim("archived_at")) > 0);

create index "entity_owner_type_active_name_idx"
  on "entity" ("owner_id", "entity_type", "name" collate nocase, "readable_id")
  where "archived_at" is null;
