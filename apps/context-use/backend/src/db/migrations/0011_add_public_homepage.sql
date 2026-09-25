alter table "knowledge_page" add column "public_homepage" integer not null default 0
  check ("public_homepage" in (0, 1))
  check ("public_homepage" = 0 or (
    "published_at" is not null and "published_revision_id" is not null and "archived_at" is null
  ));

create unique index "knowledge_page_owner_public_homepage_idx"
  on "knowledge_page" ("owner_id") where "public_homepage" = 1;
