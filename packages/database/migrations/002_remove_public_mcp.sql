-- Remove the retired anonymous MCP projection and its login role from existing
-- installations. Fresh databases already omit them from the baseline.

DROP VIEW IF EXISTS public_mcp_pages;
DROP FUNCTION IF EXISTS project_public_mcp_markdown(text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='context_use_public_mcp') THEN
    EXECUTE format(
      'REVOKE CONNECT ON DATABASE %I FROM context_use_public_mcp',
      current_database()
    );
    PERFORM pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE usename='context_use_public_mcp'
      AND pid<>pg_backend_pid();
    EXECUTE 'DROP OWNED BY context_use_public_mcp';
    EXECUTE 'DROP ROLE context_use_public_mcp';
  END IF;
END;
$$;
