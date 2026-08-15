import type { Actor } from "@context-use/shared";
import { pageDelta, type MarkdownChange, type PageMetadataChange, type PageVersionForDelta } from "./page-delta.ts";

export type QueuedVersion = {
  version_number: number;
  commit_message: string;
  actor_kind: Actor["kind"] | null;
  actor_subject: string | null;
  created_at: string | Date;
};

export type RepublicationReview = {
  published_version_number: number;
  metadata_changes: PageMetadataChange[];
  markdown_changes: MarkdownChange[];
  queued_versions: QueuedVersion[];
  queued_versions_complete: boolean;
};

export type PublicationStateOfPage = {
  published_version_id: string | null;
  published_version_number?: number | null;
};

export type CandidateVersion = PageVersionForDelta & { version_number: number };

export type VersionHistoryReader = {
  version(pageId: string, versionNumber: number): Promise<(PageVersionForDelta & {
    version_number: number;
  }) | null>;
  history(pageId: string): Promise<QueuedVersion[]>;
};

/**
 * What republishing actually exposes.
 *
 * Publication pins one immutable version, so every edit since then has been accumulating
 * privately and republishing releases all of it at once. Reviewing the candidate page whole
 * hides that: the owner recognizes their own page and approves it, including passages an
 * agent added in between. Diff against the version the public currently has, and name who
 * wrote each version waiting behind it, so the decision is about what changes rather than
 * about the page.
 */
export async function republicationReview(
  pages: VersionHistoryReader,
  pageId: string,
  page: PublicationStateOfPage,
  candidate: CandidateVersion,
): Promise<RepublicationReview | null> {
  if (!page.published_version_id || !page.published_version_number) return null;
  const published = await pages.version(pageId, page.published_version_number);
  if (!published) return null;
  const queued = (await pages.history(pageId)).filter((version) => (
    version.version_number > published.version_number
      && version.version_number <= candidate.version_number
  ));
  return {
    published_version_number: published.version_number,
    ...await pageDelta(published, candidate),
    queued_versions: queued.sort((left, right) => left.version_number - right.version_number),
    // Retention prunes old versions, so a page left unpublished for long enough loses the
    // authorship of its earliest queued edits. Say so rather than presenting a short list
    // as the whole story.
    queued_versions_complete: queued.length
      === Math.max(candidate.version_number - published.version_number, 0),
  };
}
