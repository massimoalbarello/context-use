alter table "entity" add column "entity_type" text
  check ("entity_type" in ('person', 'organization', 'location'));

create index "entity_owner_type_active_name_idx"
  on "entity" ("owner_id", "entity_type", "name" collate nocase, "readable_id")
  where "archived_at" is null;
