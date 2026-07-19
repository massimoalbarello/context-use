-- Every installation has one owner-editable public entry page. Its initial
-- published snapshot is deliberately empty; later edits remain private until
-- the owner explicitly republishes an exact version with their passkey.
ALTER TABLE knowledge_pages ADD COLUMN required_public_slug text;

ALTER TABLE knowledge_pages
  ADD CONSTRAINT knowledge_pages_required_public_slug CHECK (
    required_public_slug IS NULL
    OR (
      required_public_slug = 'about'
      AND public_slug = required_public_slug
      AND published_version_id IS NOT NULL
      AND archived_at IS NULL
    )
  );

CREATE UNIQUE INDEX knowledge_pages_required_public_slug_unique
  ON knowledge_pages(required_public_slug)
  WHERE required_public_slug IS NOT NULL;

DO $$
DECLARE
  about_page_id uuid;
  about_version_id uuid;
  about_path text;
BEGIN
  SELECT id INTO about_page_id
  FROM knowledge_pages
  WHERE public_slug = 'about'
  LIMIT 1;

  IF about_page_id IS NOT NULL THEN
    UPDATE knowledge_pages
    SET required_public_slug = 'about', archived_at = NULL
    WHERE id = about_page_id;
  ELSE
    about_page_id := gen_random_uuid();
    about_version_id := gen_random_uuid();

    IF NOT EXISTS (
      SELECT 1 FROM knowledge_pages
      WHERE current_path = 'about' AND archived_at IS NULL
    ) THEN
      about_path := 'about';
    ELSIF NOT EXISTS (
      SELECT 1 FROM knowledge_pages
      WHERE current_path = 'context-use/about' AND archived_at IS NULL
    ) THEN
      about_path := 'context-use/about';
    ELSE
      about_path := 'context-use/about-' || left(about_page_id::text, 8);
    END IF;

    INSERT INTO knowledge_pages(
      id,current_path,current_version_id,published_version_id,public_slug,
      required_public_slug
    ) VALUES (
      about_page_id,about_path,about_version_id,about_version_id,'about','about'
    );

    INSERT INTO knowledge_page_versions(
      id,page_id,version_number,path,title,body_markdown,commit_message,
      actor_kind,actor_subject
    ) VALUES (
      about_version_id,about_page_id,1,about_path,'About','',
      'Create required public about page','dashboard','context-use-bootstrap'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION protect_required_public_page_intent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  required_slug text;
BEGIN
  IF NEW.target_kind <> 'page' THEN RETURN NEW; END IF;

  SELECT required_public_slug INTO required_slug
  FROM knowledge_pages
  WHERE id = NEW.target_id;

  IF required_slug IS NOT NULL
     AND (NEW.action = 'unpublish' OR NEW.public_slug IS DISTINCT FROM required_slug) THEN
    RAISE EXCEPTION 'the required /p/% page cannot be moved or unpublished', required_slug
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_intents_protect_required_public_page
BEFORE INSERT ON publication_intents
FOR EACH ROW EXECUTE FUNCTION protect_required_public_page_intent();

REVOKE ALL ON FUNCTION protect_required_public_page_intent() FROM PUBLIC;
