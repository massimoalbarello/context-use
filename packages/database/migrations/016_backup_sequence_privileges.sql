-- pg_dump reads sequence state separately from table data. Keep the scoped
-- backup role able to dump existing and future identity/serial sequences.
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO context_use_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO context_use_backup;
