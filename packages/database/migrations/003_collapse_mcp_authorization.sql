-- Replace the per-tool private MCP scopes with one installation-wide grant.
-- A partial legacy grant is revoked rather than silently widened.
DO $$
DECLARE
  legacy_scopes text[] := ARRAY[
    'kb:read',
    'kb:write',
    'assets:read',
    'assets:write',
    'skills:read',
    'skills:write',
    'automations:write',
    'automations:claim',
    'automations:execute'
  ];
  complete_legacy_grant jsonb := to_jsonb(ARRAY[
    'kb:read',
    'kb:write',
    'assets:read',
    'assets:write',
    'skills:read',
    'skills:write',
    'automations:write',
    'automations:claim',
    'automations:execute'
  ]::text[]);
BEGIN
  UPDATE "oauthRefreshToken"
  SET revoked=coalesce(revoked,now())
  WHERE scopes ?| legacy_scopes
    AND NOT scopes @> complete_legacy_grant;

  DELETE FROM "oauthConsent"
  WHERE scopes ?| legacy_scopes
    AND NOT scopes @> complete_legacy_grant;

  UPDATE "oauthClient"
  SET scopes=(
    SELECT coalesce(jsonb_agg(scope ORDER BY scope),'[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE WHEN value = ANY(legacy_scopes) THEN 'mcp:access' ELSE value END AS scope
      FROM jsonb_array_elements_text("oauthClient".scopes)
    ) collapsed
  )
  WHERE scopes ?| legacy_scopes;

  UPDATE "oauthConsent"
  SET scopes=(
    SELECT coalesce(jsonb_agg(scope ORDER BY scope),'[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE WHEN value = ANY(legacy_scopes) THEN 'mcp:access' ELSE value END AS scope
      FROM jsonb_array_elements_text("oauthConsent".scopes)
    ) collapsed
  )
  WHERE scopes @> complete_legacy_grant;

  UPDATE "oauthRefreshToken"
  SET scopes=(
    SELECT coalesce(jsonb_agg(scope ORDER BY scope),'[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE WHEN value = ANY(legacy_scopes) THEN 'mcp:access' ELSE value END AS scope
      FROM jsonb_array_elements_text("oauthRefreshToken".scopes)
    ) collapsed
  )
  WHERE scopes @> complete_legacy_grant;

  UPDATE "oauthResource"
  SET "allowedScopes"=(
    SELECT coalesce(jsonb_agg(scope ORDER BY scope),'[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE WHEN value = ANY(legacy_scopes) THEN 'mcp:access' ELSE value END AS scope
      FROM jsonb_array_elements_text("oauthResource"."allowedScopes")
    ) collapsed
  )
  WHERE "allowedScopes" ?| legacy_scopes;

  -- Access tokens are signed and cannot be rewritten. Removing their records
  -- makes the database accurately reflect that clients must refresh once.
  DELETE FROM "oauthAccessToken" WHERE scopes ?| legacy_scopes;
END
$$;

DROP TABLE IF EXISTS mcp_client_usage;
