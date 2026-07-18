import type { PublicMcpPageSummary } from "@context-use/database";

export type PublicPageReference = {
  slug: string;
  title: string;
  url: string;
};

export type PublicPageTreeNode = PublicPageReference & {
  children: PublicPageTreeNode[];
};

function comparePages(left: PublicPageReference, right: PublicPageReference): number {
  return left.title.localeCompare(right.title, "en", { sensitivity: "base" })
    || left.slug.localeCompare(right.slug, "en");
}

function reference(page: PublicMcpPageSummary, publicSiteOrigin: string): PublicPageReference {
  return {
    slug: page.slug,
    title: page.title,
    url: new URL(`/p/${encodeURIComponent(page.slug)}`, publicSiteOrigin).href,
  };
}

export function publicPageMap(pages: PublicMcpPageSummary[]): Map<string, PublicMcpPageSummary> {
  return new Map(pages.map((page) => [page.slug, page]));
}

export function buildPublicPageTree(
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageTreeNode[] {
  const bySlug = publicPageMap(pages);
  const children = new Map<string | null, PublicMcpPageSummary[]>();
  for (const page of pages) {
    const parentSlug = page.parent_slug && page.parent_slug !== page.slug && bySlug.has(page.parent_slug)
      ? page.parent_slug
      : null;
    const siblings = children.get(parentSlug) ?? [];
    siblings.push(page);
    children.set(parentSlug, siblings);
  }

  const visit = (page: PublicMcpPageSummary, ancestors: Set<string>): PublicPageTreeNode => {
    if (ancestors.has(page.slug)) return { ...reference(page, publicSiteOrigin), children: [] };
    const nextAncestors = new Set(ancestors).add(page.slug);
    return {
      ...reference(page, publicSiteOrigin),
      children: (children.get(page.slug) ?? [])
        .map((child) => visit(child, nextAncestors))
        .sort(comparePages),
    };
  };

  return (children.get(null) ?? []).map((page) => visit(page, new Set())).sort(comparePages);
}

export function publicBreadcrumbs(
  slug: string,
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageReference[] {
  const bySlug = publicPageMap(pages);
  const breadcrumbs: PublicPageReference[] = [];
  const visited = new Set<string>();
  let current = bySlug.get(slug);
  while (current && !visited.has(current.slug)) {
    visited.add(current.slug);
    breadcrumbs.unshift(reference(current, publicSiteOrigin));
    current = current.parent_slug ? bySlug.get(current.parent_slug) : undefined;
  }
  return breadcrumbs;
}

export function publicChildren(
  slug: string,
  pages: PublicMcpPageSummary[],
  publicSiteOrigin: string,
): PublicPageReference[] {
  return pages
    .filter((page) => page.parent_slug === slug)
    .map((page) => reference(page, publicSiteOrigin))
    .sort(comparePages);
}
