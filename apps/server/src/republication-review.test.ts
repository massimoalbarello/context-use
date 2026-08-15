import { describe, expect, test } from "bun:test";
import {
  republicationReview,
  type QueuedVersion,
  type VersionHistoryReader,
} from "./republication-review.ts";

const publishedBody = [
  "# Massimo Albarello\n",
  "\n",
  "Founder of Context Use.\n",
  "\n",
  "Based in Zurich.\n",
].join("");

function reader(overrides: {
  versions?: Record<number, { path: string; title: string; summary: string; body_markdown: string }>;
  history?: QueuedVersion[];
} = {}): VersionHistoryReader {
  const versions = overrides.versions ?? {
    3: {
      path: "about/intro",
      title: "Massimo Albarello",
      summary: "Who the owner is.",
      body_markdown: publishedBody,
    },
  };
  return {
    async version(_pageId: string, versionNumber: number) {
      const version = versions[versionNumber];
      return version ? { ...version, version_number: versionNumber } : null;
    },
    async history() {
      return overrides.history ?? [];
    },
  };
}

const candidate = {
  version_number: 6,
  path: "about/intro",
  title: "Massimo Albarello",
  summary: "Who the owner is.",
  body_markdown: publishedBody.replace("Based in Zurich.", "Based in Zurich. Declined the NovaMind offer."),
};

const queued: QueuedVersion[] = [
  {
    version_number: 4,
    commit_message: "Record the NovaMind conversation",
    actor_kind: "mcp",
    actor_subject: "claude-desktop",
    created_at: "2026-08-10T09:00:00.000Z",
  },
  {
    version_number: 5,
    commit_message: "Tidy the opening",
    actor_kind: "dashboard",
    actor_subject: "context-use-owner",
    created_at: "2026-08-11T09:00:00.000Z",
  },
  {
    version_number: 6,
    commit_message: "Record the declined offer",
    actor_kind: "mcp",
    actor_subject: "claude-desktop",
    created_at: "2026-08-12T09:00:00.000Z",
  },
];

describe("republication review", () => {
  test("diffs the candidate against the version the public actually has", async () => {
    const review = await republicationReview(
      reader({ history: queued }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      candidate,
    );

    expect(review?.published_version_number).toBe(3);
    expect(review?.markdown_changes).toEqual([{
      before: "Based in Zurich.\n",
      after: "Based in Zurich. Declined the NovaMind offer.\n",
    }]);
    expect(review?.metadata_changes).toEqual([]);
    // The unchanged opening is not part of the decision and must not be shown as a change.
    expect(JSON.stringify(review?.markdown_changes)).not.toContain("Founder of Context Use");
  });

  test("attributes every version waiting behind the published one", async () => {
    const review = await republicationReview(
      reader({ history: queued }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      candidate,
    );

    expect(review?.queued_versions.map((version) => [version.version_number, version.actor_kind]))
      .toEqual([[4, "mcp"], [5, "dashboard"], [6, "mcp"]]);
    expect(review?.queued_versions_complete).toBe(true);
  });

  test("reports an incomplete queue when retention pruned the earliest edits", async () => {
    const review = await republicationReview(
      reader({ history: queued.slice(1) }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      candidate,
    );

    expect(review?.queued_versions).toHaveLength(2);
    expect(review?.queued_versions_complete).toBe(false);
  });

  test("excludes versions outside the published-to-candidate window", async () => {
    const review = await republicationReview(
      reader({
        history: [
          {
            version_number: 3,
            commit_message: "The published version itself",
            actor_kind: "dashboard",
            actor_subject: "context-use-owner",
            created_at: "2026-08-01T09:00:00.000Z",
          },
          ...queued,
          {
            version_number: 7,
            commit_message: "Written after the candidate",
            actor_kind: "mcp",
            actor_subject: "claude-desktop",
            created_at: "2026-08-13T09:00:00.000Z",
          },
        ],
      }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      candidate,
    );

    expect(review?.queued_versions.map((version) => version.version_number)).toEqual([4, 5, 6]);
    expect(review?.queued_versions_complete).toBe(true);
  });

  test("treats a rollback to an earlier version as a diff with nothing queued", async () => {
    const review = await republicationReview(
      reader({
        versions: {
          3: {
            path: "about/intro",
            title: "Massimo Albarello",
            summary: "Who the owner is.",
            body_markdown: publishedBody,
          },
        },
        history: queued,
      }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      { ...candidate, version_number: 2, body_markdown: "# Massimo Albarello\n" },
    );

    expect(review?.queued_versions).toEqual([]);
    expect(review?.queued_versions_complete).toBe(true);
    expect(review?.markdown_changes.length).toBeGreaterThan(0);
  });

  test("reports no review for a page the owner has never published", async () => {
    expect(await republicationReview(
      reader(),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: null, published_version_number: null },
      candidate,
    )).toBeNull();
  });

  test("reports no review when the published version can no longer be read", async () => {
    expect(await republicationReview(
      reader({ versions: {} }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      candidate,
    )).toBeNull();
  });

  test("reports an identical republication as an empty change set", async () => {
    const review = await republicationReview(
      reader({ history: [] }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      {
        version_number: 3,
        path: "about/intro",
        title: "Massimo Albarello",
        summary: "Who the owner is.",
        body_markdown: publishedBody,
      },
    );

    expect(review).toMatchObject({
      published_version_number: 3,
      metadata_changes: [],
      markdown_changes: [],
      queued_versions: [],
      queued_versions_complete: true,
    });
  });

  test("surfaces a path or title move as a metadata change", async () => {
    const review = await republicationReview(
      reader({ history: [] }),
      "11111111-1111-4111-8111-111111111111",
      { published_version_id: "22222222-2222-4222-8222-222222222222", published_version_number: 3 },
      { ...candidate, version_number: 4, path: "about/profile", title: "Massimo" },
    );

    expect(review?.metadata_changes).toEqual([
      { field: "path", before: "about/intro", after: "about/profile" },
      { field: "title", before: "Massimo Albarello", after: "Massimo" },
    ]);
  });
});
