-- PostgreSQL requires a newly added enum value to commit before functions can
-- use it. Keep this migration deliberately isolated from the import boundary.
ALTER TYPE confirmation_intent_kind ADD VALUE 'knowledge_import';
