create index "knowledge_page_mention_revision_idx"
  on "knowledge_page_entity_mention" ("owner_id", "source_revision_id", "target_entity_id");
