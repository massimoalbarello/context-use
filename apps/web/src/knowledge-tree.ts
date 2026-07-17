import type { Asset, Page } from "./types.ts";

export const EXPANDED_PATHS_STORAGE_KEY = "context-use.knowledge-tree.expanded-paths.v1";

export type PageTreePage = {
  kind: "page";
  name: string;
  page: Page;
};

export type AssetTreeAsset = {
  kind: "asset";
  name: string;
  asset: Asset;
};

export type PageTreeDirectory = {
  kind: "directory";
  name: string;
  path: string;
  directories: PageTreeDirectory[];
  pages: PageTreePage[];
  assets: AssetTreeAsset[];
};

type MutableDirectory = Omit<PageTreeDirectory, "directories"> & {
  directories: Map<string, MutableDirectory>;
};

const compareNames = (left: string, right: string) => left.localeCompare(right, undefined, {
  numeric: true,
  sensitivity: "base",
});

function materialize(directory: MutableDirectory): PageTreeDirectory {
  return {
    kind: "directory",
    name: directory.name,
    path: directory.path,
    directories: [...directory.directories.values()]
      .sort((left, right) => compareNames(left.name, right.name))
      .map(materialize),
    pages: [...directory.pages].sort((left, right) => (
      compareNames(left.name, right.name) || compareNames(left.page.title, right.page.title)
    )),
    assets: [...directory.assets].sort((left, right) => (
      compareNames(left.name, right.name) || compareNames(left.asset.filename, right.asset.filename)
    )),
  };
}

function directoryForPath(root: MutableDirectory, currentPath: string) {
  const segments = currentPath.split("/").filter(Boolean);
  const name = segments.pop() ?? currentPath;
  let directory = root;

  for (const segment of segments) {
    const path = directory.path ? `${directory.path}/${segment}` : segment;
    let child = directory.directories.get(segment);
    if (!child) {
      child = {
        kind: "directory",
        name: segment,
        path,
        directories: new Map(),
        pages: [],
        assets: [],
      };
      directory.directories.set(segment, child);
    }
    directory = child;
  }

  return { directory, name };
}

export function buildKnowledgeTree(pages: Page[], assets: Asset[]): PageTreeDirectory {
  const root: MutableDirectory = {
    kind: "directory",
    name: "",
    path: "",
    directories: new Map(),
    pages: [],
    assets: [],
  };

  for (const page of pages) {
    const { directory, name } = directoryForPath(root, page.current_path);
    directory.pages.push({ kind: "page", name, page });
  }

  for (const asset of assets) {
    const { directory, name } = directoryForPath(root, asset.current_path);
    directory.assets.push({ kind: "asset", name, asset });
  }

  return materialize(root);
}

export function buildPageTree(pages: Page[]): PageTreeDirectory {
  return buildKnowledgeTree(pages, []);
}

export function directoryPathsForPath(currentPath: string): string[] {
  const segments = currentPath.split("/").filter(Boolean).slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function directoryPathsForPage(page: Page): string[] {
  return directoryPathsForPath(page.current_path);
}

export function allDirectoryPaths(directory: PageTreeDirectory): string[] {
  return directory.directories.flatMap((child) => [child.path, ...allDirectoryPaths(child)]);
}

export function parseExpandedPaths(value: string | null): Set<string> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((path) => typeof path === "string")) return null;
    return new Set(parsed);
  } catch {
    return null;
  }
}

export function serializeExpandedPaths(paths: Set<string>): string {
  return JSON.stringify([...paths].sort(compareNames));
}
