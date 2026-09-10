alter table "record" add column "metadata" text
  check ("metadata" is null or (json_valid("metadata") and json_type("metadata") = 'object'));
