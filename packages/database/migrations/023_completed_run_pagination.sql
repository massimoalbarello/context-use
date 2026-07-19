CREATE INDEX automation_runs_completed_idx
  ON automation_runs (completed_at DESC, id DESC)
  WHERE status IN ('succeeded', 'failed');
