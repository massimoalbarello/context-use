export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_slug: string | null;
  automation_id: string | null;
  archived_at: string | null;
  version_number: number;
  title: string;
  body_markdown: string;
  rendered_html?: string;
};

export type Version = {
  id: string;
  page_id: string;
  version_number: number;
  path: string;
  title: string;
  body_markdown?: string;
  commit_message: string;
  actor_kind: "dashboard" | "mcp";
  actor_subject: string;
  created_at: string;
};

export type Asset = {
  id: string;
  current_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
  published_at: string | null;
  created_at: string;
};

export type PublicationPreview = {
  page_id: string;
  version_id: string;
  version_number: number;
  title: string;
  path: string;
  rendered_html: string;
  current_slug: string | null;
  warnings: string[];
  references: Array<{ kind: "page" | "asset"; id: string; label: string; path: string | null; public: boolean }>;
};

export type ConnectedClient = {
  client_id: string;
  name: string | null;
  uri: string | null;
  scopes: string[];
  created_at: string;
  approved_at: string;
  last_used_at: string | null;
};

export type AutomationSkill = {
  id: string;
  name: string;
  current_version_id: string;
  version_number: number;
  description: string;
  instructions_markdown: string;
  skill_markdown: string;
  commit_message: string;
  version_created_at: string;
  schedule_count: number;
  created_at: string;
  updated_at: string;
};

export type CronSchedule = {
  id: string;
  name: string;
  skill_id: string;
  skill_name: string;
  skill_version_id: string;
  skill_version_number: number;
  cron_expression: string;
  timezone: string;
  input: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string;
  knowledge_path: string;
  generated_page_count: number;
  ready_count: number;
  claimed_count: number;
  last_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AutomationRun = {
  id: string;
  schedule_id: string;
  schedule_name: string;
  skill_id: string;
  skill_name: string;
  skill_version_id: string;
  skill_version_number: number;
  scheduled_for: string;
  input: Record<string, unknown>;
  status: "ready" | "claimed" | "succeeded" | "failed";
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
};
