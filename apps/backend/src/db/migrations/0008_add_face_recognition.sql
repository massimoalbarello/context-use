create table "asset_face_analysis" (
  "asset_id" text not null,
  "owner_id" text not null,
  "analysis_version" text not null,
  "content_hash" text not null,
  "attempt_id" text not null,
  "state" text not null check ("state" in ('processing', 'ready', 'failed')),
  "error" text,
  "updated_at" text not null,
  primary key ("asset_id", "analysis_version"),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id") on delete cascade
);

create table "asset_face" (
  "id" text primary key,
  "readable_id" text not null,
  "owner_id" text not null,
  "asset_id" text not null,
  "box" text not null check (json_valid("box") and json_array_length("box") = 4),
  "crop_key" text not null,
  "detection_score" real not null check ("detection_score" between 0 and 1),
  "analysis_version" text not null,
  "current" integer not null check ("current" in (0, 1)),
  "needs_review" integer not null check ("needs_review" in (0, 1)),
  unique ("id", "owner_id"),
  unique ("owner_id", "asset_id", "readable_id"),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id") on delete cascade
);

create table "face_embedding" (
  "face_id" text primary key,
  "owner_id" text not null,
  "embedding_space" text not null,
  "revision" text not null,
  "vector" blob not null,
  "dimensions" integer not null check ("dimensions" > 0 and length("vector") = "dimensions" * 4),
  foreign key ("face_id", "owner_id") references "asset_face" ("id", "owner_id") on delete cascade
);

create table "face_annotation" (
  "face_id" text primary key,
  "owner_id" text not null,
  "decision" text not null check ("decision" in ('person', 'unknown', 'dismissed')),
  "entity_id" text,
  "updated_at" text not null,
  check (("decision" = 'person' and "entity_id" is not null) or ("decision" <> 'person' and "entity_id" is null)),
  foreign key ("face_id", "owner_id") references "asset_face" ("id", "owner_id") on delete cascade,
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id")
);

create table "entity_face_reference" (
  "entity_id" text primary key,
  "owner_id" text not null,
  "face_id" text not null,
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id") on delete cascade,
  foreign key ("face_id", "owner_id") references "asset_face" ("id", "owner_id")
);

create table "face_match" (
  "face_id" text primary key,
  "owner_id" text not null,
  "entity_id" text not null,
  "reference_face_id" text not null,
  "similarity" real not null check ("similarity" between -1 and 1),
  "threshold" real not null,
  "embedding_space" text not null,
  foreign key ("face_id", "owner_id") references "asset_face" ("id", "owner_id") on delete cascade,
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id") on delete cascade,
  foreign key ("reference_face_id", "owner_id") references "asset_face" ("id", "owner_id") on delete cascade
);

create table "face_recognition_setting" (
  "owner_id" text not null,
  "embedding_space" text not null,
  "threshold" real not null check ("threshold" between -1 and 1),
  primary key ("owner_id", "embedding_space"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade
);

create index "asset_face_owner_asset_idx" on "asset_face" ("owner_id", "asset_id");
create index "face_annotation_entity_idx" on "face_annotation" ("owner_id", "entity_id");
create index "face_match_entity_idx" on "face_match" ("owner_id", "entity_id");
