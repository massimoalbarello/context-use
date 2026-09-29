alter table "asset" add column "preview_metadata" text
  check ("preview_metadata" is null or json_valid("preview_metadata"));
alter table "asset" add column "preview_attempted_at" text;
create index "asset_pending_preview" on "asset" ("created_at", "id")
  where "archived_at" is null and "preview_attempted_at" is null
    and ("media_type" like 'image/%' or "media_type" like 'video/%');
