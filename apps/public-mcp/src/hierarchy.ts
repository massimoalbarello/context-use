import type { PublicMcpPageSummary } from "@context-use/database";

export type PublicPageReference = {
  path: string;
  title: string;
  url: string;
};

export type PublicPageTreeNode = PublicPageReference & {
  children: PublicPageTreeNode[];
};

function comparePages(left: PublicPageReference, right: PublicPageReference): number {
  return left.title.localeCompare(right.title, "en", { sensitivity: "base" })
    || left.path.localeCompare(right.path, "en");
}

function reference(page: PublicMcpPageSummary, publicSiteOrigin: string): PublicPageReference {
  return {
    path: page.path,
    title: page.title,
    url: new URL(`/p/${page.path}`, publicSiteOrigin).href,
  };
}

export function publicPageMap(pages: PublicMcpPageSummary[]): Map<string, PublicMcpPageSummary> {
  return new Map(pages.map((page) => [page.path, page]));
}

export function buildPublicPageTree(
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageTreeNode[] {
  const bySlug = publicPageMap(pages);
  const children = new Map<string | null, PublicMcpPageSummary[]>();
  for (const page of pages) {
    const parentPath = page.parent_path && page.parent_path !== page.path && bySlug.has(page.parent_path)
      ? page.parent_path
      : null;
    const siblings = children.get(parentPath) ?? [];
    siblings.push(page);
    children.set(parentPath, siblings);
  }

  const visit = (page: PublicMcpPageSummary, ancestors: Set<string>): PublicPageTreeNode => {
    if (ancestors.has(page.path)) return { ...reference(page, publicSiteOrigin), children: [] };
    const nextAncestors = new Set(ancestors).add(page.path);
    return {
      ...reference(page, publicSiteOrigin),
      children: (children.get(page.path) ?? [])
        .map((child) => visit(child, nextAncestors))
        .sort(comparePages),
    };
  };

  return (children.get(null) ?? []).map((page) => visit(page, new Set())).sort(comparePages);
}

export function publicBreadcrumbs(
  path: string,
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageReference[] {
  const bySlug = publicPageMap(pages);
  const breadcrumbs: PublicPageReference[] = [];
  const visited = new Set<string>();
  let current = bySlug.get(path);
  while (current && !visited.has(current.path)) {
    visited.add(current.path);
    breadcrumbs.unshift(reference(current, publicSiteOrigin));
    current = current.parent_path ? bySlug.get(current.parent_path) : undefined;
  }
  return breadcrumbs;
}

export function publicChildren(
  path: string,
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageReference[] {
  return pages
    .filter((page) => page.parent_path === path)
    .map((page) => reference(page, publicSiteOrigin))
    .sort(comparePages);
}
