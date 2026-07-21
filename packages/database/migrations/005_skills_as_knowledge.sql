-- Skills are ordinary versioned Markdown pages. Migrate every legacy skill and
-- its immutable history before removing the parallel skill tables.
DO $$
DECLARE
  has_collision boolean;
BEGIN
  IF to_regclass('public.agent_skills') IS NULL
     AND to_regclass('public.agent_skill_versions') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.agent_skills') IS NULL
     OR to_regclass('public.agent_skill_versions') IS NULL THEN
    RAISE EXCEPTION 'legacy skill tables are incomplete; refusing to discard skill history';
  END IF;

  EXECUTE $query$
    SELECT EXISTS (
      SELECT 1
      FROM agent_skills skill
      JOIN knowledge_pages page
        ON page.id=skill.id
        OR (
          page.archived_at IS NULL
          AND skill.deleted_at IS NULL
          AND page.current_path='skills/' || skill.name
        )
    )
    OR EXISTS (
      SELECT 1
      FROM agent_skill_versions version
      JOIN knowledge_page_versions page_version ON page_version.id=version.id
    )
  $query$ INTO has_collision;

  IF has_collision THEN
    RAISE EXCEPTION 'cannot migrate legacy skills because a knowledge page path or UUID collides';
  END IF;

  EXECUTE $migration$
    INSERT INTO knowledge_pages(
      id,current_path,current_version_id,created_at,updated_at,archived_at
    )
    SELECT
      id,'skills/' || name,current_version_id,created_at,updated_at,deleted_at
    FROM agent_skills
  $migration$;

  EXECUTE $migration$
    INSERT INTO knowledge_page_versions(
      id,page_id,version_number,path,title,body_markdown,
      commit_message,actor_kind,actor_subject,created_at
    )
    SELECT
      version.id,
      version.skill_id,
      version.version_number,
      'skills/' || skill.name,
      'SKILL.md',
      E'---\nname: ' || skill.name
        || E'\ndescription: ' || to_json(version.description)::text
        || E'\n---\n\n' || version.instructions_markdown,
      version.commit_message,
      version.actor_kind,
      version.actor_subject,
      version.created_at
    FROM agent_skill_versions version
    JOIN agent_skills skill ON skill.id=version.skill_id
  $migration$;
END;
$$;

DROP TABLE IF EXISTS agent_skills,agent_skill_versions;

-- Existing installations have an editable guide, so append only the new
-- convention and preserve every owner customization already present.
DO $$
DECLARE
  guide record;
  next_version_id uuid;
  skills_guide text := E'## Skills\n\n- Discover reusable Agent Skills by listing current pages whose paths begin with `skills/`.\n- Store each skill at the stable semantic path `skills/<skill-name>`.\n- The page body is the complete standard `SKILL.md`: YAML frontmatter with `name` and `description`, followed by the skill instructions. Use the frontmatter to decide whether a skill is relevant before following its instructions.\n- Create, update, and archive skills with the ordinary page tools; page history and commit messages provide versioning.';
BEGIN
  SELECT
    page.id,
    page.current_path,
    version.version_number,
    version.title,
    version.body_markdown
  INTO guide
  FROM knowledge_pages page
  JOIN knowledge_page_versions version ON version.id=page.current_version_id
  WHERE page.current_path='agents' AND page.archived_at IS NULL
  FOR UPDATE OF page;

  IF NOT FOUND OR guide.body_markdown LIKE '%skills/<skill-name>%' THEN
    RETURN;
  END IF;

  next_version_id := gen_random_uuid();
  INSERT INTO knowledge_page_versions(
    id,page_id,version_number,path,title,body_markdown,
    commit_message,actor_kind,actor_subject
  ) VALUES (
    next_version_id,
    guide.id,
    guide.version_number + 1,
    guide.current_path,
    guide.title,
    rtrim(guide.body_markdown) || E'\n\n' || skills_guide || E'\n',
    'Document page-backed skills',
    'dashboard',
    'context-use-migration'
  );

  UPDATE knowledge_pages
  SET current_version_id=next_version_id,updated_at=now()
  WHERE id=guide.id;
END;
$$;
