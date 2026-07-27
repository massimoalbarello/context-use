-- Automations declare where they may write, so their output can live where its
-- subject belongs instead of being filed under whichever automation authored it.
-- A day's digest belongs in that day's diary folder; an enriched company page
-- belongs in companies/. Provenance stays on knowledge_pages.automation_id and
-- is unaffected by location.
--
-- write_scope is additive: an automation may always write inside its own
-- automations/<key>/ folder, so the default empty array preserves existing
-- behaviour exactly.
ALTER TABLE cron_schedules
  ADD COLUMN write_scope jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT cron_schedules_write_scope_shape CHECK (
    jsonb_typeof(write_scope)='array'
    AND jsonb_array_length(write_scope) <= 16
  );

GRANT INSERT (write_scope) ON cron_schedules TO context_use_mcp;
GRANT INSERT (write_scope) ON cron_schedules TO context_use_dashboard;
GRANT UPDATE (write_scope) ON cron_schedules TO context_use_dashboard;
