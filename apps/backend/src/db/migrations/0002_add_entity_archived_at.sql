alter table "entity" add column "archived_at" text
  check ("archived_at" is null or length(trim("archived_at")) > 0);
