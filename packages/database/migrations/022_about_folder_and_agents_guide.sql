-- Keep owner-specific context in about/, with the protected introduction at
-- about/intro. The required public alias remains /p/about.

ALTER TABLE knowledge_pages
  DROP CONSTRAINT knowledge_pages_required_public_path;

DO $$
DECLARE
  about_page knowledge_pages%ROWTYPE;
  current_version knowledge_page_versions%ROWTYPE;
  conflict_page knowledge_pages%ROWTYPE;
  conflict_version knowledge_page_versions%ROWTYPE;
  next_version_id uuid;
  conflict_path text;
BEGIN
  SELECT * INTO about_page
  FROM knowledge_pages
  WHERE required_public_path='about'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'required about page is missing';
  END IF;

  IF about_page.current_path IS DISTINCT FROM 'about/intro' THEN
    SELECT * INTO conflict_page
    FROM knowledge_pages
    WHERE current_path='about/intro' AND archived_at IS NULL
      AND id<>about_page.id
    FOR UPDATE;

    IF FOUND THEN
      SELECT * INTO conflict_version
      FROM knowledge_page_versions
      WHERE id=conflict_page.current_version_id AND page_id=conflict_page.id;

      conflict_path := 'about/intro-' || left(conflict_page.id::text,8);
      WHILE EXISTS (
        SELECT 1 FROM knowledge_pages
        WHERE current_path=conflict_path AND archived_at IS NULL
      ) LOOP
        conflict_path := conflict_path || '-legacy';
      END LOOP;

      next_version_id := gen_random_uuid();
      INSERT INTO knowledge_page_versions(
        id,page_id,version_number,path,title,body_markdown,commit_message,
        actor_kind,actor_subject
      ) VALUES (
        next_version_id,conflict_page.id,conflict_version.version_number+1,
        conflict_path,conflict_version.title,conflict_version.body_markdown,
        'Reserve canonical about intro path','dashboard','context-use-migration'
      );
      UPDATE knowledge_pages
      SET current_path=conflict_path,current_version_id=next_version_id,updated_at=now()
      WHERE id=conflict_page.id;
    END IF;

    SELECT * INTO current_version
    FROM knowledge_page_versions
    WHERE id=about_page.current_version_id AND page_id=about_page.id;

    IF current_version.id=about_page.published_version_id
       AND current_version.version_number=1
       AND current_version.path='about'
       AND current_version.title='About'
       AND current_version.body_markdown=''
       AND current_version.actor_subject='context-use-bootstrap' THEN
      -- The empty bootstrap snapshot contains no owner data, so a fresh
      -- installation can adopt the folder structure without a synthetic v2.
      UPDATE knowledge_page_versions
      SET path='about/intro',title='Intro'
      WHERE id=current_version.id;
      UPDATE knowledge_pages
      SET current_path='about/intro',updated_at=now()
      WHERE id=about_page.id;
    ELSE
      next_version_id := gen_random_uuid();
      INSERT INTO knowledge_page_versions(
        id,page_id,version_number,path,title,body_markdown,commit_message,
        actor_kind,actor_subject
      ) VALUES (
        next_version_id,about_page.id,current_version.version_number+1,
        'about/intro',current_version.title,current_version.body_markdown,
        'Move introduction into about folder','dashboard','context-use-migration'
      );
      UPDATE knowledge_pages
      SET current_path='about/intro',current_version_id=next_version_id,updated_at=now()
      WHERE id=about_page.id;
    END IF;
  END IF;
END;
$$;

-- The history-preserving moves above can queue deferred FK checks. Flush them
-- before altering the table, then defer again for the page/version bootstrap.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_required_public_path CHECK (
    required_public_path IS NULL
    OR (
      required_public_path='about'
      AND current_path='about/intro'
      AND public_path=required_public_path
      AND published_version_id IS NOT NULL
      AND archived_at IS NULL
    )
  ),
  ADD CONSTRAINT knowledge_pages_about_is_folder CHECK (
    archived_at IS NOT NULL OR current_path<>'about'
  );

SET CONSTRAINTS ALL DEFERRED;

-- AGENTS.md is normal private knowledge: owners may refine it, and authenticated
-- MCP clients are instructed to read it before writing pages.
DO $$
DECLARE
  agents_page_id uuid;
  agents_version_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM knowledge_pages
    WHERE current_path='agents' AND archived_at IS NULL
  ) THEN
    agents_page_id := gen_random_uuid();
    agents_version_id := gen_random_uuid();

    INSERT INTO knowledge_pages(id,current_path,current_version_id)
    VALUES (agents_page_id,'agents',agents_version_id);

    INSERT INTO knowledge_page_versions(
      id,page_id,version_number,path,title,body_markdown,commit_message,
      actor_kind,actor_subject
    ) VALUES (
      agents_version_id,agents_page_id,1,'agents','AGENTS.md',
      E'# Knowledge base structure\n\n- Store information whose subject is the owner in `about/`. Start with `about/intro`.\n- Store other entities in separate top-level folders, such as `people/`, `companies/`, and `events/`.\n- Link related pages instead of nesting other entities under `about/`.\n',
      'Create knowledge base guide','dashboard','context-use-bootstrap'
    );
  END IF;
END;
$$;

-- Required pages may use a stable public alias that differs from their private
-- knowledge path; all ordinary pages still require an exact path match.
CREATE OR REPLACE FUNCTION confirm_publication_intent(
  p_intent_id uuid,
  p_owner_user_id text,
  p_session_id text,
  p_credential_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  intent publication_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent
  FROM publication_intents
  WHERE id=p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication intent not found' USING ERRCODE='P0002'; END IF;
  IF intent.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'publication intent already consumed' USING ERRCODE='23505'; END IF;
  IF intent.expires_at<=now() THEN RAISE EXCEPTION 'publication intent expired' USING ERRCODE='22023'; END IF;
  IF intent.owner_user_id<>p_owner_user_id OR intent.session_id<>p_session_id THEN
    RAISE EXCEPTION 'publication intent principal mismatch' USING ERRCODE='42501';
  END IF;
  IF length(p_credential_id)<1 THEN RAISE EXCEPTION 'verified credential required' USING ERRCODE='42501'; END IF;

  IF intent.target_kind='page' THEN
    IF intent.action IN ('publish','republish') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM knowledge_page_versions version
        JOIN knowledge_pages page ON page.id=version.page_id
        WHERE version.id=intent.version_id
          AND version.page_id=intent.target_id
          AND (
            version.path=intent.public_path
            OR page.required_public_path=intent.public_path
          )
      ) THEN
        RAISE EXCEPTION 'page version or public path mismatch' USING ERRCODE='23503';
      END IF;
      UPDATE knowledge_pages
      SET published_version_id=intent.version_id,
          public_path=intent.public_path,
          updated_at=now()
      WHERE id=intent.target_id AND archived_at IS NULL;
    ELSE
      UPDATE knowledge_pages
      SET published_version_id=NULL,public_path=NULL,updated_at=now()
      WHERE id=intent.target_id;
    END IF;
  ELSE
    IF intent.action IN ('publish','republish') THEN
      UPDATE assets
      SET published_at=now(),public_path=intent.public_path
      WHERE id=intent.target_id AND deleted_at IS NULL AND current_path=intent.public_path;
    ELSE
      UPDATE assets SET published_at=NULL,public_path=NULL WHERE id=intent.target_id;
    END IF;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication target not found' USING ERRCODE='P0002'; END IF;
  UPDATE publication_intents SET consumed_at=now() WHERE id=intent.id;
END;
$$;
