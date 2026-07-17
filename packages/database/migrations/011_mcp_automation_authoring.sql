GRANT INSERT (id,name,current_version_id)
  ON automation_skills TO context_use_mcp;

GRANT INSERT (id,skill_id,version_number,instructions_markdown,commit_message,actor_kind,actor_subject)
  ON automation_skill_versions TO context_use_mcp;

GRANT INSERT (id,name,skill_version_id,cron_expression,timezone,input,enabled,next_run_at)
  ON cron_schedules TO context_use_mcp;
