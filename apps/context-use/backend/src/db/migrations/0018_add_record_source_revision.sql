alter table "record" add column "source_revision" text
  check ("source_revision" is null or (
    length("source_revision") between 1 and 128 and "source_revision" not glob '*[^0-9]*'
  ));
