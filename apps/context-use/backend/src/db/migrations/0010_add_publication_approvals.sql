create table "publication_approval" (
  "id" text not null primary key,
  "owner_id" text not null references "auth_user" ("id") on delete cascade,
  "session_id" text not null references "auth_session" ("id") on delete cascade,
  "challenge" text not null unique,
  "resource_type" text not null check ("resource_type" in ('page', 'entity', 'asset', 'record')),
  "readable_id" text not null,
  "action" text not null check ("action" in ('publish', 'unpublish')),
  "revision_number" integer,
  "expected_state" text not null,
  "expires_at" text not null,
  check (
    ("resource_type" = 'page' and "action" = 'publish' and "revision_number" is not null and "revision_number" > 0)
    or (("resource_type" != 'page' or "action" != 'publish') and "revision_number" is null)
  )
);

create index "publication_approval_owner_expiry_idx" on "publication_approval" ("owner_id", "expires_at");
create index "publication_approval_session_idx" on "publication_approval" ("session_id");
