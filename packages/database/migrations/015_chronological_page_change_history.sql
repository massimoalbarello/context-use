-- Dashboard history is browsed by event time. The identity sequence remains a
-- stable tie-breaker for events that share the same timestamp.
CREATE INDEX knowledge_page_changes_chronological_idx
  ON knowledge_page_changes(changed_at DESC,change_sequence DESC);
