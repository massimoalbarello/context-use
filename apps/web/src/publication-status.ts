import type { Page } from "./types.ts";

export type PublicationFilter = "all" | "public" | "updates";

export function isPublishedPageOutdated(
  page: Pick<Page, "current_version_id" | "published_version_id">,
): boolean {
  return Boolean(
    page.published_version_id
    && page.published_version_id !== page.current_version_id,
  );
}

export function filterPagesByPublication(pages: Page[], filter: PublicationFilter): Page[] {
  if (filter === "public") return pages.filter((page) => Boolean(page.published_version_id));
  if (filter === "updates") return pages.filter(isPublishedPageOutdated);
  return pages;
}
