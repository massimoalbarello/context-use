-- Preserve heading fragments only for references whose target is independently public.
-- Private targets continue to project to inert authored labels without UUIDs, paths, or fragments.
CREATE OR REPLACE FUNCTION project_public_markdown(p_public_path text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE
  p_body text;
  p_source_path text;
  projected text;
  matched text[];
  target_path text;
  target_href text;
  label text;
  source_directory text;
BEGIN
  -- The executor can name only a page that is already public. Loading the raw
  -- body and private source path internally prevents the public EXECUTE grant
  -- required by the views from becoming an arbitrary private-path oracle.
  SELECT page.body_markdown,page.path
  INTO p_body,p_source_path
  FROM published_page_sources page
  WHERE page.public_path=p_public_path;
  IF NOT FOUND THEN RETURN ''; END IF;

  projected := regexp_replace(
    regexp_replace(coalesce(p_body,''),'<!--.*?-->','','gis'),
    '<!--.*$','','gis'
  );
  projected := regexp_replace(
    regexp_replace(projected,'<script([[:space:]][^>]*)?>.*?</script[[:space:]]*>','','gis'),
    '<script([[:space:]][^>]*)?>.*$','','gis'
  );
  projected := regexp_replace(
    regexp_replace(projected,'<style([[:space:]][^>]*)?>.*?</style[[:space:]]*>','','gis'),
    '<style([[:space:]][^>]*)?>.*$','','gis'
  );
  projected := regexp_replace(projected,'<[a-z!?/][^>]*(>|$)','','gis');

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(!\[([^]]*)\]\(context-use://asset/([0-9a-f-]{36})\)(\{[^}\r\n]*\})?)',
      'gi'
    )
  LOOP
    SELECT asset.public_path INTO target_path
    FROM assets asset
    WHERE asset.id=matched[3]::uuid
      AND asset.public_path IS NOT NULL
      AND asset.deleted_at IS NULL;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format(
             '![%s](context-use://public-asset/%s)%s',
             matched[2],target_path,coalesce(matched[4],'')
           )
      END
    );
  END LOOP;

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(context-use://page/([0-9a-f-]{36})(#[a-z0-9][a-z0-9_-]*)?\))',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.id=matched[3]::uuid;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format('[%s](/p/%s%s)',matched[2],target_path,coalesce(matched[4],''))
      END
    );
  END LOOP;

  -- A directory reference becomes public only when its generated index has at
  -- least one published descendant. The projection never exposes private
  -- siblings or mutable directory metadata.
  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(context-use://directory/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT directory.current_path INTO target_path
    FROM knowledge_directories directory
    WHERE directory.id=matched[3]::uuid
      AND EXISTS (
        SELECT 1 FROM published_page_sources page
        WHERE directory.current_path=''
           OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
      );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           WHEN target_path='' THEN format('[%s](/i)',matched[2])
           ELSE format('[%s](/i/%s)',matched[2],target_path)
      END
    );
  END LOOP;

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(/app/pages/([0-9a-f-]{36})(#[a-z0-9][a-z0-9_-]*)?\))',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.id=matched[3]::uuid;
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           ELSE format('[%s](/p/%s%s)',matched[2],target_path,coalesce(matched[4],''))
      END
    );
  END LOOP;

  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[([^]]*)\]\(/app/directories/([0-9a-f-]{36})\))',
      'gi'
    )
  LOOP
    SELECT directory.current_path INTO target_path
    FROM knowledge_directories directory
    WHERE directory.id=matched[3]::uuid
      AND EXISTS (
        SELECT 1 FROM published_page_sources page
        WHERE directory.current_path=''
           OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
      );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_path IS NULL THEN matched[2]
           WHEN target_path='' THEN format('[%s](/i)',matched[2])
           ELSE format('[%s](/i/%s)',matched[2],target_path)
      END
    );
  END LOOP;

  source_directory := regexp_replace(lower(p_source_path),'(^|/)[^/]+$','','');
  FOR matched IN
    SELECT regexp_matches(
      projected,
      '(\[\[([a-z0-9][a-z0-9/_-]*)(#[a-z0-9][a-z0-9_-]*)?(\|([^]\r\n]+))?\]\])',
      'gi'
    )
  LOOP
    SELECT page.public_path INTO target_path
    FROM published_page_sources page
    WHERE page.path=lower(matched[2])
       OR page.path=concat_ws('/',nullif(source_directory,''),lower(matched[2]))
    ORDER BY
      CASE WHEN page.path=concat_ws('/',nullif(source_directory,''),lower(matched[2])) THEN 0 ELSE 1 END,
      page.path
    LIMIT 1;
    target_href := CASE WHEN target_path IS NULL THEN NULL
                        ELSE format('/p/%s%s',target_path,coalesce(matched[3],''))
                   END;
    IF target_href IS NULL THEN
      SELECT directory.current_path INTO target_path
      FROM knowledge_directories directory
      WHERE (
          directory.current_path=lower(matched[2])
          OR directory.current_path=concat_ws('/',nullif(source_directory,''),lower(matched[2]))
        )
        AND EXISTS (
          SELECT 1 FROM published_page_sources page
          WHERE directory.current_path=''
             OR left(page.path,length(directory.current_path)+1)=directory.current_path||'/'
        )
      ORDER BY
        CASE WHEN directory.current_path=concat_ws('/',nullif(source_directory,''),lower(matched[2])) THEN 0 ELSE 1 END,
        directory.current_path
      LIMIT 1;
      target_href := CASE WHEN target_path IS NULL THEN NULL
                          WHEN target_path='' THEN '/i'
                          ELSE format('/i/%s',target_path)
                     END;
    END IF;
    label := coalesce(
      nullif(btrim(matched[5]),''),
      CASE WHEN target_href IS NULL THEN 'Private page'
           ELSE regexp_replace(matched[2],'^.*/','')
      END
    );
    projected := replace(
      projected,
      matched[1],
      CASE WHEN target_href IS NULL THEN label
           ELSE format('[%s](%s)',label,target_href)
      END
    );
  END LOOP;

  projected := regexp_replace(
    projected,'context-use://(page|directory|asset)/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/app/(pages|directories)/[0-9a-f-]{36}',
    '[private reference]','gi'
  );
  projected := regexp_replace(
    projected,'/api/(dashboard|mcp|public)/assets/[0-9a-f-]{36}(/(content|status))?',
    '[private asset reference]','gi'
  );
  -- Last-resort identifier minimization covers legacy/absolute URL shapes and
  -- malformed references that do not match any supported Markdown construct.
  projected := regexp_replace(
    projected,'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    '[private identifier]','gi'
  );
  RETURN projected;
END;
$$;
