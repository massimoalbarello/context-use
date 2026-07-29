-- Directory indexes and pages share the public /p hierarchy. Keep this
-- migration focused on URL projection so it cannot drift from the privacy
-- filtering and heading-fragment behavior in project_public_markdown.
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('project_public_markdown(text)'::regprocedure)
  INTO definition;

  definition := replace(
    definition,
    'WHEN target_path='''' THEN format(''[%s](/i)'',matched[2])',
    'WHEN target_path='''' THEN format(''[%s](/p/)'',matched[2])'
  );
  definition := replace(
    definition,
    'ELSE format(''[%s](/i/%s)'',matched[2],target_path)',
    'ELSE format(''[%s](/p/%s/)'',matched[2],target_path)'
  );
  definition := replace(
    definition,
    'WHEN target_path='''' THEN ''/i''',
    'WHEN target_path='''' THEN ''/p/'''
  );
  definition := replace(
    definition,
    'ELSE format(''/i/%s'',target_path)',
    'ELSE format(''/p/%s/'',target_path)'
  );

  IF strpos(definition,'/i')>0 THEN
    RAISE EXCEPTION 'project_public_markdown still contains legacy directory URLs';
  END IF;
  EXECUTE definition;
END;
$$;
