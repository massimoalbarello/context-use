export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_path: string | null;
  required_public_path: string | null;
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
  public_path: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
  published_at: string | null;
  created_at: string;
};

export type AssetStatus = {
  content_available: boolean;
  public_url: string;
};

export type PublicationPreview = {
  page_id: string;
  version_id: string;
  version_number: number;
  title: string;
  path: string;
  rendered_html: string;
  current_public_path: string | null;
  warnings: string[];
  references: Array<{ kind: "page" | "asset"; id: string; label: string; path: string | null; public: boolean }>;
};

export type ConnectedClient = {
  client_id: string;
  name: string | null;
  uri: string | null;
  version: string | null;
  scopes: string[];
  created_at: string;
  approved_at: string;
  last_used_at: string | null;
};

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type InboundMessage = {
  id: string;
  reply_to: string;
  message: string;
  created_at: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  current_version_id: string;
  version_number: number;
  description: string;
  instructions_markdown: string;
  skill_markdown: string;
  commit_message: string;
  version_created_at: string;
  created_at: string;
  updated_at: string;
};

export type CronSchedule = {
  id: string;
  name: string;
  automation_key: string;
  automation_version_id: string;
  automation_version_number: number;
  instructions_markdown: string;
  commit_message: string;
  version_created_at: string;
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
  automation_version_id: string;
  automation_version_number: number;
  scheduled_for: string;
  input: Record<string, unknown>;
  status: "ready" | "claimed" | "succeeded" | "failed";
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  claim_expired: boolean;
  completed_at: string | null;
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
};
