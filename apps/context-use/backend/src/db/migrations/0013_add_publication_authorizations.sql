create table "publication_authorization" (
  "session_id" text not null primary key references "auth_session" ("id") on delete cascade,
  "owner_id" text not null references "auth_user" ("id") on delete cascade,
  "passkey_id" text not null references "auth_passkey" ("id") on delete cascade,
  "credential_id" text not null,
  "public_key" text not null,
  "expires_at" text not null
);
