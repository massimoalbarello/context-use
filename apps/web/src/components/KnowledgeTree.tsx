import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefCallback } from "react";
import {
  buildKnowledgeTree,
  countPublicItems,
  directoryPathsForPath,
  EXPANDED_PATHS_STORAGE_KEY,
  expandedPathsForDisplay,
  knowledgeTreeItemLabel,
  parseExpandedPaths,
  pruneEmptyDirectories,
  serializeExpandedPaths,
  type AssetTreeAsset,
  type PageTreeDirectory,
  type PageTreePage,
} from "../knowledge-tree.ts";
import { isPublishedPageOutdated } from "../publication-status.ts";
import type { Asset, Directory, PageMetadata } from "../types.ts";

export type KnowledgeSelection = { kind: "page" | "directory" | "asset"; id: string };

type KnowledgeTreeProps = {
  pages: PageMetadata[];
  directories: Directory[];
  assets: Asset[];
  query: string;
  selected: KnowledgeSelection | null;
  onSelect: (selection: KnowledgeSelection) => void;
  emptyMessage?: string;
};

function restoredExpandedPaths(): Set<string> | null {
  if (typeof window === "undefined") return null;
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

function AssetIcon() {
  return <svg className="tree-icon tree-asset-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.25 2.25h11.5v11.5H2.25z" /><path d="m3.75 11 2.5-2.75 2 2 1.5-1.5 2.5 2.25" /><circle cx="10.75" cy="5.25" r="1" />
  </svg>;
}

type TreeItem = PageTreePage | AssetTreeAsset;

function itemName(item: TreeItem) {
  return item.name;
}

function KnowledgeItems({
  directory,
  depth,
  selected,
  selectedItemRef,
  onSelect,
}: {
  directory: PageTreeDirectory;
  depth: number;
  selected: KnowledgeSelection | null;
  selectedItemRef: RefCallback<HTMLButtonElement>;
  onSelect: (selection: KnowledgeSelection) => void;
}) {
  const items: TreeItem[] = [...directory.pages, ...directory.assets].sort((left, right) => (
    itemName(left).localeCompare(itemName(right), undefined, { numeric: true, sensitivity: "base" })
  ));

  return <>{items.map((item) => {
    const entity = item.kind === "page" ? item.page : item.asset;
    const label = knowledgeTreeItemLabel(item);
    const active = selected?.kind === item.kind && selected.id === entity.id;
    const archived = item.kind === "page" && Boolean(item.page.archived_at);
    const isPublic = item.kind === "page" ? Boolean(item.page.published_version_id) : Boolean(item.asset.public_path);
    const publicationOutdated = item.kind === "page" && isPublishedPageOutdated(item.page);

    return <button
      type="button"
      className={`tree-row tree-${item.kind}-row${active ? " selected" : ""}${archived ? " archived" : ""}`}
      style={{ "--tree-depth": depth } as CSSProperties}
      role="treeitem"
      aria-selected={active}
      title={`${label}\n${entity.current_path}${publicationOutdated ? "\nPublished version is out of date" : ""}`}
      key={`${item.kind}-${entity.id}`}
      ref={active ? selectedItemRef : undefined}
      onClick={() => onSelect({ kind: item.kind, id: entity.id })}
    >
      <span className="tree-chevron-spacer" aria-hidden="true" />
      {item.kind === "page" ? <PageIcon /> : <AssetIcon />}
      <span className="tree-label">{label}</span>
      {archived
        ? <span className="tree-status">archived</span>
        : isPublic && <span className={`tree-status public${publicationOutdated ? " outdated" : ""}`}>public</span>}
    </button>;
  })}</>;
}

function DirectoryBranch({
  directory,
  depth,
  expandedPaths,
  selected,
  selectedItemRef,
  onToggle,
  onSelect,
}: {
  directory: PageTreeDirectory;
  depth: number;
  expandedPaths: Set<string>;
  selected: KnowledgeSelection | null;
  selectedItemRef: RefCallback<HTMLButtonElement>;
  onToggle: (path: string) => void;
  onSelect: (selection: KnowledgeSelection) => void;
}) {
  const expanded = expandedPaths.has(directory.path);
  const publicItemCount = expanded ? 0 : countPublicItems(directory);
  const label = directory.path === "" && directory.directory
    ? directory.directory.title
    : directory.name;
  const active = directory.directory
    ? selected?.kind === "directory" && selected.id === directory.directory.id
    : false;
  const rowStyle = { "--tree-depth": depth } as CSSProperties;

  return <div className="tree-branch">
    <button
      type="button"
      className={`tree-row tree-directory-row tree-page-row${active ? " selected" : ""}`}
      style={rowStyle}
      role="treeitem"
      aria-expanded={expanded}
      aria-label={`${label}${publicItemCount ? `, ${publicItemCount} public item${publicItemCount === 1 ? "" : "s"}` : ""}`}
      title={`${directory.path}/${publicItemCount ? `\n${publicItemCount} public item${publicItemCount === 1 ? "" : "s"}` : ""}`}
      aria-selected={active}
      ref={active ? selectedItemRef : undefined}
      onClick={() => {
        onToggle(directory.path);
        if (directory.directory) onSelect({ kind: "directory", id: directory.directory.id });
      }}
    >
      <Chevron expanded={expanded} />
      <FolderIcon expanded={expanded} />
      <span className="tree-label">{label}</span>
      {publicItemCount > 0 && <span className="tree-public-count" aria-hidden="true">{publicItemCount > 99 ? "99+" : publicItemCount}</span>}
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
        selected={selected}
        selectedItemRef={selectedItemRef}
        onToggle={onToggle}
        onSelect={onSelect}
      />)}
      <KnowledgeItems directory={directory} depth={depth + 1} selected={selected} selectedItemRef={selectedItemRef} onSelect={onSelect} />
    </div>}
  </div>;
}

export function KnowledgeTree({ pages, directories, assets, query, selected, onSelect, emptyMessage }: KnowledgeTreeProps) {
  const tree = useMemo(() => {
    const completeTree = buildKnowledgeTree(pages, assets, directories);
    return query.trim() ? completeTree : pruneEmptyDirectories(completeTree);
  }, [pages, assets, directories, query]);
  const restoredPaths = useRef<Set<string> | null>(restoredExpandedPaths());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => restoredPaths.current ?? new Set(),
  );
  const initialized = useRef(restoredPaths.current !== null);
  const scrollFrame = useRef<number | null>(null);
  const visibleExpandedPaths = useMemo(
    () => expandedPathsForDisplay(expandedPaths, tree, query),
    [expandedPaths, query, tree],
  );
  const hasRootDirectory = tree.directory !== null;
  const selectedPath = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === "page") return pages.find((page) => page.id === selected.id)?.current_path ?? null;
    if (selected.kind === "directory") return directories.find((directory) => directory.id === selected.id)?.current_path ?? null;
    return assets.find((asset) => asset.id === selected.id)?.current_path ?? null;
  }, [assets, directories, pages, selected]);
  const selectedItemRef = useCallback<RefCallback<HTMLButtonElement>>((element) => {
    if (!element) return;
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (element.isConnected) element.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }, [selected?.id, selected?.kind]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_PATHS_STORAGE_KEY, serializeExpandedPaths(expandedPaths));
    } catch {
      // The tree still works when browser storage is unavailable.
    }
  }, [expandedPaths]);

  useEffect(() => {
    if (initialized.current || (!pages.length && !assets.length && !directories.length)) return;
    initialized.current = true;
    setExpandedPaths(new Set([
      ...(tree.directory ? [tree.path] : []),
      ...tree.directories.map((directory) => directory.path),
    ]));
  }, [assets.length, directories.length, pages.length, tree]);

  useEffect(() => {
    if (selectedPath === null) return;
    const pathsToReveal = [
      ...(hasRootDirectory ? [tree.path] : []),
      ...directoryPathsForPath(selectedPath),
    ];
    if (!pathsToReveal.length) return;

    setExpandedPaths((current) => {
      const next = new Set(current);
      let changed = false;
      for (const path of pathsToReveal) {
        if (next.has(path)) continue;
        next.add(path);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [hasRootDirectory, selectedPath, tree.path]);

  useEffect(() => () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
  }, []);

  const toggle = (path: string) => setExpandedPaths((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  if (!pages.length && !assets.length && !tree.directory && !tree.directories.length) {
    return <div className="tree-empty">{query ? "No matching knowledge" : emptyMessage ?? "No knowledge yet"}</div>;
  }

  return <div className="page-tree" role="tree" aria-label="Knowledge pages and assets">
    {tree.directory
      ? <DirectoryBranch
        directory={tree}
        depth={0}
        expandedPaths={visibleExpandedPaths}
        selected={selected}
        selectedItemRef={selectedItemRef}
        onToggle={toggle}
        onSelect={onSelect}
      />
      : <>
        {tree.directories.map((directory) => <DirectoryBranch
          key={directory.path}
          directory={directory}
          depth={0}
          expandedPaths={visibleExpandedPaths}
          selected={selected}
          selectedItemRef={selectedItemRef}
          onToggle={toggle}
          onSelect={onSelect}
        />)}
        <KnowledgeItems directory={tree} depth={0} selected={selected} selectedItemRef={selectedItemRef} onSelect={onSelect} />
      </>}
  </div>;
}
