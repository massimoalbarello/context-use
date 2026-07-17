export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_slug: string | null;
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

export type AuditEvent = {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};
