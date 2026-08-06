export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_path: string | null;
  archived_at: string | null;
  version_number: number;
  title: string;
  summary: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
  rendered_html?: string;
};

export type PageMetadata = Pick<
  Page,
  | "id"
  | "current_path"
  | "current_version_id"
  | "published_version_id"
  | "archived_at"
  | "version_number"
  | "title"
  | "summary"
  | "updated_at"
>;

export type Version = {
  id: string;
  page_id: string;
  version_number: number;
  path: string;
  title: string;
  summary: string;
  body_markdown?: string;
  commit_message: string;
  actor_kind: "dashboard" | "mcp";
  actor_subject: string;
  created_at: string;
};

export type KnowledgePageChange = {
  cursor: string;
  page_id: string;
  version_id: string;
  version_number: number;
  change_kind: "created" | "updated" | "archived" | "deleted";
  path: string;
  title: string;
  commit_message: string;
  actor_kind: "dashboard" | "mcp" | null;
  actor_subject: string | null;
  changed_at: string;
};

export type KnowledgePageChangeBatch = {
  changes: KnowledgePageChange[];
  next_cursor: string;
  has_more: boolean;
};

export type Directory = {
  id: string;
  current_path: string;
  version_number: number;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type DirectoryIndexEntry = {
  kind: "directory" | "page";
  id: string;
  path: string;
  title: string;
  summary: string;
  default_page_id: string | null;
};

export type DirectoryIndex = Directory & {
  guide: {
    id: string;
    path: string;
    version_number: number;
    title: string;
    summary: string;
  } | null;
  children: DirectoryIndexEntry[];
};

export type Asset = {
  id: string;
  current_path: string;
  public_path: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
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
  summary: string;
  path: string;
  rendered_html: string;
  current_public_path: string | null;
  warnings: string[];
  references: Array<{ kind: "page" | "directory" | "asset"; id: string; label: string; path: string | null; public: boolean }>;
};

export type ConnectedClient = {
  client_id: string;
  name: string | null;
  uri: string | null;
  version: string | null;
  created_at: string;
  approved_at: string;
  last_connected_at: string | null;
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
