-- Nango's public connection_id is display metadata and may be reused after a
-- connection is deleted. Its numeric connection row ID is the durable source
-- stream identity. Legacy mirrored records keep a NULL instance ID: they stay
-- readable and uniquely constrained without being silently attached to a
-- newly created Nango connection.
ALTER TABLE source_records
  ADD COLUMN connection_instance_id bigint CHECK (
    connection_instance_id IS NULL
    OR connection_instance_id BETWEEN 1 AND 9007199254740991
  );

DO $$
DECLARE
  legacy_identity_constraint name;
BEGIN
  SELECT constraint_row.conname
  INTO legacy_identity_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid='source_records'::regclass
    AND constraint_row.contype='u'
    AND (
      SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum,ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid=constraint_row.conrelid
       AND attribute.attnum=key.attnum
    )=ARRAY['integration','connection_id','model','source_record_id']::text[];

  IF legacy_identity_constraint IS NULL THEN
    RAISE EXCEPTION 'legacy source-record identity constraint is missing'
      USING ERRCODE='55000';
  END IF;
  EXECUTE format(
    'ALTER TABLE source_records DROP CONSTRAINT %I',
    legacy_identity_constraint
  );
END;
$$;

CREATE UNIQUE INDEX source_records_connection_instance_identity_unique
  ON source_records(
    integration,connection_instance_id,model,source_record_id
  )
  WHERE connection_instance_id IS NOT NULL;

CREATE UNIQUE INDEX source_records_legacy_connection_identity_unique
  ON source_records(integration,connection_id,model,source_record_id)
  WHERE connection_instance_id IS NULL;

-- The MCP writer may refresh public/display metadata for an existing numeric
-- stream, but it cannot move a record between Nango connection instances.
GRANT UPDATE (connection_id) ON source_records TO context_use_mcp;
