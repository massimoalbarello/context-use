-- Context Use stores automation instructions and supporting assets as ordinary
-- private knowledge. Scheduling, execution, retries, and run history belong to
-- an external harness.
--
-- Existing instruction and generated pages must survive this migration with
-- their UUIDs, paths, versions, asset links, and publication state unchanged.
-- Detach their obsolete provenance before removing the scheduler tables.
LOCK TABLE knowledge_pages, cron_schedules, automation_versions, automation_runs
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "oauthResource", "oauthAccessToken", "oauthRefreshToken", "oauthConsent"
  IN ACCESS EXCLUSIVE MODE;

-- Retire every grant bound to the removed execution audience. Already-issued
-- JWTs also remain harmless because /mcp validates the exact knowledge
-- audience, but clearing durable grants prevents refresh and removes stale
-- execution-only clients from the dashboard.
DELETE FROM "oauthAccessToken" token
WHERE EXISTS (
  SELECT 1
  FROM "oauthResource" resource
  WHERE resource.identifier ~ '/mcp/execution$'
    AND token.resources @> jsonb_build_array(resource.identifier)
);

DELETE FROM "oauthRefreshToken" token
WHERE EXISTS (
  SELECT 1
  FROM "oauthResource" resource
  WHERE resource.identifier ~ '/mcp/execution$'
    AND token.resources @> jsonb_build_array(resource.identifier)
);

DELETE FROM "oauthConsent" consent
WHERE EXISTS (
  SELECT 1
  FROM "oauthResource" resource
  WHERE resource.identifier ~ '/mcp/execution$'
    AND consent.resources @> jsonb_build_array(resource.identifier)
);

DELETE FROM "oauthResource"
WHERE identifier ~ '/mcp/execution$';

DROP TRIGGER publication_intents_keep_automation_instructions_private
  ON publication_intents;
DROP FUNCTION keep_automation_instruction_pages_private();

DROP TRIGGER knowledge_pages_automation_path ON knowledge_pages;
DROP FUNCTION enforce_automation_page_path();
DROP TRIGGER knowledge_page_versions_automation_path ON knowledge_page_versions;
DROP FUNCTION enforce_automation_page_version_path();
DROP TRIGGER cron_schedules_keep_automation_key ON cron_schedules;
DROP FUNCTION keep_automation_key_immutable();

UPDATE knowledge_pages
SET automation_id=NULL
WHERE automation_id IS NOT NULL;

-- Instruction pages are now ordinary pages, so the passkey-confirmed permanent
-- deletion boundary no longer needs to consult the retired scheduler.
CREATE OR REPLACE FUNCTION confirm_page_deletion_intent(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_credential_id text,
  p_expected_counter integer,
  p_new_counter integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  intent record;
  intent_challenge text;
  target record;
BEGIN
  IF p_owner_user_id IS NULL OR p_session_id IS NULL
     OR p_credential_id IS NULL OR length(trim(p_credential_id))<1
     OR p_expected_counter IS NULL OR p_new_counter IS NULL THEN
    RAISE EXCEPTION 'verified page deletion principal required' USING ERRCODE='42501';
  END IF;

  SELECT id,page_id,expected_version_id,owner_user_id,session_id,expires_at
  INTO intent
  FROM page_deletion_intents
  WHERE id=p_intent_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'page deletion intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.expires_at<=now() THEN
    RAISE EXCEPTION 'page deletion intent expired' USING ERRCODE='22023';
  END IF;
  IF intent.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR intent.session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'page deletion intent principal mismatch' USING ERRCODE='42501';
  END IF;
  SELECT challenge INTO intent_challenge
  FROM confirmation_challenges
  WHERE intent_kind='page_deletion' AND intent_id=intent.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'page deletion challenge not issued' USING ERRCODE='42501';
  END IF;

  SELECT id,current_version_id,published_version_id,archived_at
  INTO target
  FROM knowledge_pages
  WHERE id=intent.page_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'page not found' USING ERRCODE='P0002'; END IF;
  IF target.archived_at IS NULL OR target.published_version_id IS NOT NULL
     OR target.current_version_id IS DISTINCT FROM intent.expected_version_id THEN
    RAISE EXCEPTION 'page is no longer eligible for permanent deletion' USING ERRCODE='22023';
  END IF;

  PERFORM consume_confirmation_challenge(
    'page_deletion',intent.id,intent_challenge,intent.owner_user_id,
    p_credential_id,p_expected_counter,p_new_counter
  );

  DELETE FROM publication_intents
  WHERE target_kind='page' AND target_id=target.id;
  DELETE FROM knowledge_page_versions WHERE page_id=target.id;
  DELETE FROM knowledge_pages WHERE id=target.id;
END;
$$;

REVOKE SELECT (instructions_page_id) ON cron_schedules
  FROM context_use_boundary_owner;

ALTER TABLE knowledge_pages
  DROP CONSTRAINT knowledge_pages_automation_id_fk;
ALTER TABLE cron_schedules
  DROP CONSTRAINT cron_schedules_current_version_fk,
  DROP CONSTRAINT cron_schedules_instructions_page_fk;

DROP TABLE automation_runs;
DROP TABLE automation_versions;
DROP TABLE cron_schedules;

DROP INDEX knowledge_pages_automation_idx;
ALTER TABLE knowledge_pages DROP COLUMN automation_id;

UPDATE knowledge_directories
SET title='Automations',
    summary='Instructions and supporting assets used by automations running in external harnesses.',
    version_number=version_number+1,
    search_vector=directory_search_vector(
      current_path,
      'Automations',
      'Instructions and supporting assets used by automations running in external harnesses.',
      intro_markdown
    ),
    updated_at=now()
WHERE current_path='automations';

-- The folder contract is editorial guidance, not a second automation model.
-- Existing local guidance wins; never overwrite owner-authored knowledge.
DO $$
DECLARE
  guide_page_id uuid := gen_random_uuid();
  guide_version_id uuid := gen_random_uuid();
BEGIN
  IF EXISTS (
    SELECT 1
    FROM knowledge_pages
    WHERE current_path='automations/agents' AND archived_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO knowledge_pages(id,current_path,current_version_id,search_vector)
  VALUES (
    guide_page_id,
    'automations/agents',
    guide_version_id,
    page_search_vector(
      'automations/agents',
      'AGENTS.md',
      'The naming and storage conventions for automation instructions and supporting assets.',
      $guide$
# Automation instructions

The `automations/` directory stores instructions and supporting assets for automations that run in an external harness. Context Use provides private, versioned knowledge and assets; it does not schedule jobs, execute them, retry them, or store run state.

## Structure

- Give each automation a stable kebab-case directory at `automations/<automation-name>/`.
- Store its canonical instruction page at `automations/<automation-name>/instructions`.
- Reserve the `instructions` leaf within each automation directory for that canonical instruction page; do not use it for unrelated pages or assets.
- Use the automation directory only for automation definitions and the supporting context or assets they need, such as an HTML template.
- Store durable output at the canonical path for its subject, not beneath `automations/`, unless the instructions explicitly require an automation-local artifact.
- Link instruction pages, supporting pages, and assets with ordinary Context Use references.

Automation instruction and support pages use the ordinary page lifecycle and tools. They are private by default. Reading or editing them never requires publication, and an external harness should access them through the authenticated MCP connection.

Keep schedules, retries, run history, execution state, and credentials in the external harness. Never store secrets in automation instruction pages or assets.
$guide$
    )
  );

  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,summary,body_markdown,
    commit_message,actor_kind,actor_subject
  ) VALUES (
    guide_version_id,
    guide_page_id,
    1,
    'automations/agents',
    'AGENTS.md',
    'The naming and storage conventions for automation instructions and supporting assets.',
    $guide$
# Automation instructions

The `automations/` directory stores instructions and supporting assets for automations that run in an external harness. Context Use provides private, versioned knowledge and assets; it does not schedule jobs, execute them, retry them, or store run state.

## Structure

- Give each automation a stable kebab-case directory at `automations/<automation-name>/`.
- Store its canonical instruction page at `automations/<automation-name>/instructions`.
- Reserve the `instructions` leaf within each automation directory for that canonical instruction page; do not use it for unrelated pages or assets.
- Use the automation directory only for automation definitions and the supporting context or assets they need, such as an HTML template.
- Store durable output at the canonical path for its subject, not beneath `automations/`, unless the instructions explicitly require an automation-local artifact.
- Link instruction pages, supporting pages, and assets with ordinary Context Use references.

Automation instruction and support pages use the ordinary page lifecycle and tools. They are private by default. Reading or editing them never requires publication, and an external harness should access them through the authenticated MCP connection.

Keep schedules, retries, run history, execution state, and credentials in the external harness. Never store secrets in automation instruction pages or assets.
$guide$,
    'Create automation directory guide',
    'dashboard',
    'context-use-migration'
  );
END;
$$;
