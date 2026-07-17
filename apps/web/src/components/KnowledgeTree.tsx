import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  allDirectoryPaths,
  buildPageTree,
  directoryPathsForPage,
  EXPANDED_PATHS_STORAGE_KEY,
  parseExpandedPaths,
  serializeExpandedPaths,
  type PageTreeDirectory,
} from "../knowledge-tree.ts";
import type { Page } from "../types.ts";

type KnowledgeTreeProps = {
  pages: Page[];
  query: string;
  selectedPageId: string | null;
  onSelectPage: (page: Page) => void;
};

function restoredExpandedPaths(): Set<string> | null {
  try {
    return parseExpandedPaths(window.localStorage.getItem(EXPANDED_PATHS_STORAGE_KEY));
  } catch {
    return null;
  }
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <svg className={`tree-chevron${expanded ? " expanded" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
    <path d="m6 3.5 4.5 4.5L6 12.5" />
  </svg>;
}

function FolderIcon({ expanded }: { expanded: boolean }) {
  return <svg className="tree-icon folder-icon" viewBox="0 0 16 16" aria-hidden="true">
    {expanded
      ? <path d="M1.75 5.25h12.5l-1.1 7H2.85l-1.1-7Zm.75-2h4l1.25 1.5h5.75" />
      : <path d="M1.75 3.25h4.6l1.2 1.5h6.7v7.5H1.75v-9Z" />}
  </svg>;
}

function PageIcon() {
  return <svg className="tree-icon page-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 1.75h6.25L13 5.5v8.75H3V1.75Z" /><path d="M9 1.75V5.5h4" />
  </svg>;
}

function DirectoryBranch({
  directory,
  depth,
  expandedPaths,
  selectedPageId,
  onToggle,
  onSelectPage,
}: {
  directory: PageTreeDirectory;
  depth: number;
  expandedPaths: Set<string>;
  selectedPageId: string | null;
  onToggle: (path: string) => void;
  onSelectPage: (page: Page) => void;
}) {
  const expanded = expandedPaths.has(directory.path);
  const rowStyle = { "--tree-depth": depth } as CSSProperties;

  return <div className="tree-branch">
    <button
      type="button"
      className="tree-row tree-directory-row"
      style={rowStyle}
      role="treeitem"
      aria-expanded={expanded}
      title={`${directory.path}/`}
      onClick={() => onToggle(directory.path)}
    >
      <Chevron expanded={expanded} />
      <FolderIcon expanded={expanded} />
      <span className="tree-label">{directory.name}</span>
    </button>
    {expanded && <div
      className="tree-children"
      role="group"
      style={{ "--tree-depth": depth } as CSSProperties}
    >
      {directory.directories.map((child) => <DirectoryBranch
        key={child.path}
        directory={child}
        depth={depth + 1}
        expandedPaths={expandedPaths}
        selectedPageId={selectedPageId}
        onToggle={onToggle}
        onSelectPage={onSelectPage}
      />)}
      {directory.pages.map(({ page, name }) => <button
        type="button"
        className={`tree-row tree-page-row${selectedPageId === page.id ? " selected" : ""}${page.archived_at ? " archived" : ""}`}
        style={{ "--tree-depth": depth + 1 } as CSSProperties}
        role="treeitem"
        aria-selected={selectedPageId === page.id}
        title={`${page.title}\n${page.current_path}`}
        key={page.id}
        onClick={() => onSelectPage(page)}
      >
        <span className="tree-chevron-spacer" aria-hidden="true" />
        <PageIcon />
        <span className="tree-label">{page.title || name}</span>
        {page.archived_at
          ? <span className="tree-status">archived</span>
          : page.published_version_id && <span className="tree-status public">public</span>}
      </button>)}
    </div>}
  </div>;
}

export function KnowledgeTree({ pages, query, selectedPageId, onSelectPage }: KnowledgeTreeProps) {
  const tree = useMemo(() => buildPageTree(pages), [pages]);
  const restoredPaths = useRef<Set<string> | null>(restoredExpandedPaths());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => restoredPaths.current ?? new Set(),
  );
  const initialized = useRef(restoredPaths.current !== null);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_PATHS_STORAGE_KEY, serializeExpandedPaths(expandedPaths));
    } catch {
      // The tree still works when browser storage is unavailable.
    }
  }, [expandedPaths]);

  useEffect(() => {
    const pathsToReveal: string[] = [];
    if (!initialized.current && pages.length) {
      pathsToReveal.push(...tree.directories.map((directory) => directory.path));
      initialized.current = true;
    }
    const selectedPage = pages.find((page) => page.id === selectedPageId);
    if (selectedPage) pathsToReveal.push(...directoryPathsForPage(selectedPage));
    if (query.trim()) pathsToReveal.push(...allDirectoryPaths(tree));
    if (!pathsToReveal.length) return;

    setExpandedPaths((current) => {
      const next = new Set(current);
      pathsToReveal.forEach((path) => next.add(path));
      return next;
    });
  }, [pages, query, selectedPageId, tree]);

  const toggle = (path: string) => setExpandedPaths((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  if (!pages.length) return <div className="tree-empty">{query ? "No matching pages" : "No pages yet"}</div>;

  return <div className="page-tree" role="tree" aria-label="Knowledge pages">
    {tree.directories.map((directory) => <DirectoryBranch
      key={directory.path}
      directory={directory}
      depth={0}
      expandedPaths={expandedPaths}
      selectedPageId={selectedPageId}
      onToggle={toggle}
      onSelectPage={onSelectPage}
    />)}
    {tree.pages.map(({ page, name }) => <button
      type="button"
      className={`tree-row tree-page-row${selectedPageId === page.id ? " selected" : ""}${page.archived_at ? " archived" : ""}`}
      style={{ "--tree-depth": 0 } as CSSProperties}
      role="treeitem"
      aria-selected={selectedPageId === page.id}
      title={`${page.title}\n${page.current_path}`}
      key={page.id}
      onClick={() => onSelectPage(page)}
    >
      <span className="tree-chevron-spacer" aria-hidden="true" />
      <PageIcon />
      <span className="tree-label">{page.title || name}</span>
      {page.archived_at
        ? <span className="tree-status">archived</span>
        : page.published_version_id && <span className="tree-status public">public</span>}
    </button>)}
  </div>;
}
