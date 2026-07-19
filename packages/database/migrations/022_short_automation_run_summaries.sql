ALTER TABLE automation_runs
  DROP CONSTRAINT automation_runs_result_summary_check;

-- Keep historical long outcomes readable, but reject new ones. The generated
-- knowledge page is the canonical run output; this field is only a short note.
ALTER TABLE automation_runs
  ADD CONSTRAINT automation_runs_result_summary_check
  CHECK (result_summary IS NULL OR length(result_summary) <= 500)
  NOT VALID;
