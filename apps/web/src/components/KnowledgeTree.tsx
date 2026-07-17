import { useMemo, useState } from "react";
import type { Asset, Page } from "../types.ts";

export type KnowledgeSelection = { kind: "page" | "asset"; id: string };

type KnowledgeItem = KnowledgeSelection & {
  path: string;
  label: string;
  state: string | null;
};

type FolderNode = {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  items: KnowledgeItem[];
};

function createFolder(name = "", path = ""): FolderNode {
  return { name, path, folders: new Map(), items: [] };
}

function addItem(root: FolderNode, item: KnowledgeItem) {
  const segments = item.path.split("/");
  segments.pop();
  let folder = root;
  for (const segment of segments) {
    const path = folder.path ? `${folder.path}/${segment}` : segment;
    let child = folder.folders.get(segment);
    if (!child) {
      child = createFolder(segment, path);
      folder.folders.set(segment, child);
    }
    folder = child;
  }
  folder.items.push(item);
}

export function KnowledgeTree({
  pages,
  assets,
  selected,
  forceExpanded = false,
  onSelect,
}: {
  pages: Page[];
  assets: Asset[];
  selected: KnowledgeSelection | null;
  forceExpanded?: boolean;
  onSelect: (selection: KnowledgeSelection) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const root = useMemo(() => {
    const next = createFolder();
    for (const page of pages) {
      addItem(next, {
        kind: "page",
        id: page.id,
        path: page.current_path,
        label: page.title,
        state: page.archived_at ? "archived" : page.published_version_id ? "public" : null,
      });
    }
    for (const asset of assets) {
      addItem(next, {
        kind: "asset",
        id: asset.id,
        path: asset.current_path,
        label: asset.filename,
        state: asset.published_at ? "public" : null,
      });
    }
    return next;
  }, [pages, assets]);

  const toggle = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const renderFolder = (folder: FolderNode, rootFolder = false): React.ReactNode => {
    const children = [
      ...Array.from(folder.folders.values(), (value) => ({ type: "folder" as const, key: value.name, value })),
      ...folder.items.map((value) => ({ type: "item" as const, key: value.path.split("/").at(-1) ?? value.path, value })),
    ].sort((left, right) => left.key.localeCompare(right.key) || left.type.localeCompare(right.type));
    const isCollapsed = !rootFolder && !forceExpanded && collapsed.has(folder.path);

    return <div className={rootFolder ? "tree-root" : "tree-folder-group"} key={folder.path || "root"}>
      {!rootFolder && <button className="tree-folder" onClick={() => toggle(folder.path)} aria-expanded={!isCollapsed}>
        <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span><strong>{folder.name}</strong>
      </button>}
      {!isCollapsed && <div className={rootFolder ? "" : "tree-children"}>{children.map((child) => child.type === "folder"
        ? renderFolder(child.value)
        : <button
            className={`tree-item ${selected?.kind === child.value.kind && selected.id === child.value.id ? "selected" : ""} ${child.value.state === "archived" ? "archived" : ""}`}
            key={`${child.value.kind}-${child.value.id}`}
            onClick={() => onSelect({ kind: child.value.kind, id: child.value.id })}
          >
            <span className="tree-item-title"><i aria-hidden="true">{child.value.kind === "page" ? "▤" : "◆"}</i><strong>{child.value.label}</strong></span>
            <span>{child.key} · {child.value.kind}{child.value.state ? ` · ${child.value.state}` : ""}</span>
          </button>)}</div>}
    </div>;
  };

  if (!pages.length && !assets.length) return <p className="tree-empty">No knowledge found.</p>;
  return <div className="knowledge-tree">{renderFolder(root, true)}</div>;
}
