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
  "embedding_space" text not null,
  "embedding_revision" text not null,
  "embedding" blob not null,
  "embedding_dimensions" integer not null check ("embedding_dimensions" > 0 and length("embedding") = "embedding_dimensions" * 4),
  "matched_entity_id" text,
  "matched_reference_face_id" text,
  "match_similarity" real check ("match_similarity" between -1 and 1),
  "match_threshold" real check ("match_threshold" between -1 and 1),
  "annotation_decision" text check ("annotation_decision" in ('person', 'unknown', 'dismissed')),
  "annotation_entity_id" text,
  "annotation_updated_at" text,
  unique ("id", "owner_id"),
  unique ("id", "owner_id", "asset_id"),
  unique ("owner_id", "asset_id", "readable_id"),
  check (
    ("matched_entity_id" is null and "matched_reference_face_id" is null and "match_similarity" is null and "match_threshold" is null)
    or ("matched_entity_id" is not null and "matched_reference_face_id" is not null and "match_similarity" is not null and "match_threshold" is not null)
  ),
  check (
    ("annotation_decision" is null and "annotation_entity_id" is null and "annotation_updated_at" is null)
    or ("annotation_decision" is not null and "annotation_updated_at" is not null and (
      ("annotation_decision" = 'person' and "annotation_entity_id" is not null)
      or ("annotation_decision" in ('unknown', 'dismissed') and "annotation_entity_id" is null)
    ))
  ),
  foreign key ("asset_id", "owner_id") references "asset" ("id", "owner_id") on delete cascade,
  foreign key ("matched_entity_id", "owner_id") references "entity" ("id", "owner_id"),
  foreign key ("matched_reference_face_id", "owner_id") references "asset_face" ("id", "owner_id"),
  foreign key ("annotation_entity_id", "owner_id") references "entity" ("id", "owner_id")
);

create table "entity_face_reference" (
  "entity_id" text primary key,
  "owner_id" text not null,
  "face_id" text not null,
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id") on delete cascade,
  foreign key ("face_id", "owner_id") references "asset_face" ("id", "owner_id")
);

create table "asset_depicts_entity" (
  "face_id" text primary key,
  "owner_id" text not null,
  "asset_id" text not null,
  "entity_id" text not null,
  "source" text not null check ("source" in ('detected', 'confirmed')),
  foreign key ("face_id", "owner_id", "asset_id") references "asset_face" ("id", "owner_id", "asset_id") on delete cascade,
  foreign key ("entity_id", "owner_id") references "entity" ("id", "owner_id") on delete cascade
);

create table "face_recognition_setting" (
  "owner_id" text not null,
  "embedding_space" text not null,
  "threshold" real not null check ("threshold" between -1 and 1),
  primary key ("owner_id", "embedding_space"),
  foreign key ("owner_id") references "auth_user" ("id") on delete cascade
);

create index "asset_face_matched_entity_idx" on "asset_face" ("owner_id", "matched_entity_id");
create index "asset_face_matched_reference_idx" on "asset_face" ("owner_id", "matched_reference_face_id");
create index "asset_depicts_entity_asset_idx" on "asset_depicts_entity" ("owner_id", "asset_id");
create index "asset_depicts_entity_entity_idx" on "asset_depicts_entity" ("owner_id", "entity_id");
