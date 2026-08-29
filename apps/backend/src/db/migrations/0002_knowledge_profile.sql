create table "knowledge_profile" (
  "owner_id" text not null,
  "self_entity_id" text not null,
  primary key ("owner_id"),
  unique ("self_entity_id"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade,
  foreign key ("self_entity_id", "owner_id") references "entity" ("id", "owner_id")
    on delete cascade
);
