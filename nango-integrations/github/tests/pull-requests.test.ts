import { afterEach, describe, expect, it, setSystemTime } from "bun:test";

import { GITHUB_OAUTH_SCOPES, MANAGED_FUNCTIONS, MANAGED_INTEGRATIONS } from "../../catalog.js";
import { FakeNango } from "../../test-support/fake-nango.js";
import sync, {
  type NangoSyncLocal,
} from "../syncs/pull-requests.js";

const FIXED_START = new Date("2026-07-31T12:30:00.000Z");
const PULL_REQUEST_MODEL = "GitHubPullRequest";
const REPOSITORY_STATE_MODEL = "GitHubRepositorySyncState";
const GitHubPullRequestSchema = sync.models.GitHubPullRequest;

function asNango(fake: FakeNango): NangoSyncLocal {
  return fake as unknown as NangoSyncLocal;
}

describe("GitHub pull request integration contract", () => {
  it("declares the managed GitHub integration and half-hour sync", () => {
    expect(GITHUB_OAUTH_SCOPES).toEqual(["repo"]);
    expect(MANAGED_INTEGRATIONS).toEqual([
      {
        id: "github",
        provider: "github",
        displayName: "GitHub",
        forwardWebhooks: false,
        oauth: { scopes: ["repo"] },
      },
    ]);
    expect(MANAGED_FUNCTIONS).toEqual([
      {
        integrationId: "github",
        name: "pull-requests",
        type: "sync",
        models: ["GitHubPullRequest", "GitHubRepositorySyncState"],
      },
    ]);
    expect(sync.frequency).toBe("every half hour");
    expect(sync.autoStart).toBe(true);
    expect(sync.scopes).toEqual(["repo"]);
    expect(Object.keys(sync.models)).toEqual([
      "GitHubPullRequest",
      "GitHubRepositorySyncState",
    ]);
  });
});

describe("GitHub pull request sync", () => {
  afterEach(() => {
    setSystemTime();
  });

  it("hydrates every open PR and only overlapping closed PRs as complete raw snapshots", async () => {
    const fake = new FakeNango();
    const repository = githubRepository(501, "acme/widgets");
    fake.setPages("/user/repos", [[repository]]);
    fake.setRecord(REPOSITORY_STATE_MODEL, "501", {
      id: "501",
      repository: "acme/widgets",
      closed_pull_requests_checked_through: "2026-07-31T12:00:00.000Z",
      _nango_metadata: { last_action: "UPDATED" },
    });

    const oldOpen = pullRequestSummary(1001, 11, "open", "2025-01-01T00:00:00.000Z");
    const recentClosed = pullRequestSummary(1002, 12, "closed", "2026-07-31T11:55:00.000Z");
    const outsideOverlap = pullRequestSummary(1003, 13, "closed", "2026-07-31T11:54:59.000Z");
    fake.setPages("/repos/acme/widgets/pulls", [[oldOpen], []], "open");
    fake.setPages(
      "/repos/acme/widgets/pulls",
      [[recentClosed, outsideOverlap], [pullRequestSummary(1004, 14, "closed", "2020-01-01T00:00:00.000Z")]],
      "closed",
    );
    addHydration(fake, "acme/widgets", oldOpen, { multiPageCommits: true });
    addHydration(fake, "acme/widgets", recentClosed);

    await executeSync(fake);

    expect(fake.recordsLookups).toEqual([
      { ids: ["501"], model: REPOSITORY_STATE_MODEL },
    ]);
    const pullRequestBatches = fake.savedBatches.filter(
      (batch) => batch.model === PULL_REQUEST_MODEL,
    );
    expect(pullRequestBatches).toHaveLength(2);
    expect(pullRequestBatches.every((batch) => batch.records.length === 1)).toBe(true);

    const snapshots = pullRequestBatches.flatMap((batch) => batch.records);
    const openSnapshot = GitHubPullRequestSchema.parse(snapshots[0]);
    expect(openSnapshot).toMatchObject({
      id: "1001",
      repository_id: "501",
      repository: "acme/widgets",
      number: 11,
      source_updated_at: "2025-01-01T00:00:00.000Z",
    });
    expect(openSnapshot.pull_request["node_id"]).toBe("PR_1001");
    expect(openSnapshot.pull_request["requested_reviewers"]).toEqual([{ id: 81, login: "sam" }]);
    expect(openSnapshot.commits.map((commit) => commit["sha"])).toEqual(["sha-a", "sha-b"]);
    expect(openSnapshot.reviews[0]?.["node_id"]).toBe("REVIEW_1001");
    expect(openSnapshot.issue_comments[0]?.["provider_only_field"]).toBe("kept");
    expect(openSnapshot.review_comments[0]?.["diff_hunk"]).toBe("@@ -1 +1 @@");
    expect(openSnapshot.collection_completeness).toEqual({
      commits: { expected: 2, fetched: 2, complete: true },
    });
    expect(JSON.stringify(openSnapshot)).not.toContain("synced_at");
    expect("body" in openSnapshot).toBe(false);

    const requestedEndpoints = [
      ...fake.getCalls.map((call) => call.endpoint),
      ...fake.paginateCalls.map((call) => call.endpoint),
    ];
    expect(requestedEndpoints.some((endpoint) => endpoint.endsWith("/requested_reviewers"))).toBe(false);
    expect(requestedEndpoints.some((endpoint) => endpoint.endsWith("/files"))).toBe(false);
    expect(requestedEndpoints).not.toContain("/repos/acme/widgets/pulls/13");
    expect(fake.yieldedPages.get("/repos/acme/widgets/pulls?state=closed")).toBe(1);
    expect(fake.yieldedPages.get("/repos/acme/widgets/pulls/11/commits")).toBe(2);

    expect(fake.savedBatches.at(-1)).toEqual({
      model: REPOSITORY_STATE_MODEL,
      records: [
        {
          id: "501",
          repository: "acme/widgets",
          closed_pull_requests_checked_through: FIXED_START.toISOString(),
        },
      ],
    });
  });

  it("backfills all closed PRs before the repository has sync state", async () => {
    const fake = new FakeNango();
    const repository = githubRepository(700, "acme/archive");
    const oldClosed = pullRequestSummary(2001, 99, "closed", "2018-04-03T10:00:00.000Z");
    fake.setPages("/user/repos", [[repository]]);
    fake.setPages("/repos/acme/archive/pulls", [[]], "open");
    fake.setPages("/repos/acme/archive/pulls", [[oldClosed]], "closed");
    addHydration(fake, "acme/archive", oldClosed);

    await executeSync(fake);

    expect(savedRecords(fake, PULL_REQUEST_MODEL)).toHaveLength(1);
    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]).toMatchObject({ id: "2001", number: 99 });
    expect(savedRecords(fake, REPOSITORY_STATE_MODEL)).toHaveLength(1);
  });

  it("marks a GitHub-capped commit collection as incomplete", async () => {
    const fake = new FakeNango();
    const repository = githubRepository(701, "acme/huge-change");
    const pullRequest = pullRequestSummary(2002, 100, "open", "2026-07-31T12:20:00.000Z");
    fake.setPages("/user/repos", [[repository]]);
    fake.setPages("/repos/acme/huge-change/pulls", [[pullRequest]], "open");
    fake.setPages("/repos/acme/huge-change/pulls", [[]], "closed");
    addHydration(fake, "acme/huge-change", pullRequest, {
      reportedCommitCount: 251,
    });

    await executeSync(fake);

    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]?.["collection_completeness"]).toEqual({
      commits: { expected: 251, fetched: 1, complete: false },
    });
    expect(fake.logs.some((message) => message.includes("1/251 commits fetched"))).toBe(true);
  });

  it("uses provider IDs for state and PR identity when a repository is renamed", async () => {
    const fake = new FakeNango();
    fake.metadata = { repositories: ["new-owner/new-name"] };
    const renamedRepository = githubRepository("repo-7", "new-owner/new-name");
    const ignoredRepository = githubRepository("repo-8", "other/not-selected");
    const pullRequest = pullRequestSummary("pr-9", 4, "open", "2026-07-31T12:10:00.000Z");
    fake.setPages("/user/repos", [[renamedRepository, ignoredRepository]]);
    fake.setRecord(REPOSITORY_STATE_MODEL, "repo-7", {
      id: "repo-7",
      repository: "old-owner/old-name",
      closed_pull_requests_checked_through: "2026-07-31T12:00:00.000Z",
    });
    fake.setPages("/repos/new-owner/new-name/pulls", [[pullRequest]], "open");
    fake.setPages("/repos/new-owner/new-name/pulls", [[]], "closed");
    addHydration(fake, "new-owner/new-name", pullRequest);

    await executeSync(fake);

    expect(fake.recordsLookups).toEqual([
      { ids: ["repo-7"], model: REPOSITORY_STATE_MODEL },
    ]);
    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]).toMatchObject({
      id: "pr-9",
      repository_id: "repo-7",
      repository: "new-owner/new-name",
    });
    expect(savedRecords(fake, REPOSITORY_STATE_MODEL)[0]).toMatchObject({
      id: "repo-7",
      repository: "new-owner/new-name",
    });
    expect(fake.paginateCalls.some((call) => call.endpoint.includes("other/not-selected"))).toBe(false);
  });

  it("continues other repositories, withholds failed state, then reports every failure", async () => {
    const fake = new FakeNango();
    const brokenRepository = githubRepository(1, "acme/broken");
    const healthyRepository = githubRepository(2, "acme/healthy");
    const brokenPullRequest = pullRequestSummary(10, 1, "open", "2026-07-31T12:00:00.000Z");
    const healthyPullRequest = pullRequestSummary(20, 2, "open", "2026-07-31T12:00:00.000Z");
    fake.setPages("/user/repos", [[brokenRepository, healthyRepository]]);
    fake.setPages("/repos/acme/broken/pulls", [[brokenPullRequest]], "open");
    fake.setPages("/repos/acme/broken/pulls", [[]], "closed");
    addHydration(fake, "acme/broken", brokenPullRequest);
    fake.fail("/repos/acme/broken/pulls/1/reviews", new Error("reviews endpoint exploded"));
    fake.setPages("/repos/acme/healthy/pulls", [[healthyPullRequest]], "open");
    fake.setPages("/repos/acme/healthy/pulls", [[]], "closed");
    addHydration(fake, "acme/healthy", healthyPullRequest);

    await expect(
      executeSync(fake),
    ).rejects.toThrow(
      "GitHub pull request sync failed for 1 repository: acme/broken: reviews endpoint exploded",
    );

    expect(savedRecords(fake, PULL_REQUEST_MODEL)).toHaveLength(1);
    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]).toMatchObject({
      id: "20",
      repository: "acme/healthy",
    });
    expect(savedRecords(fake, REPOSITORY_STATE_MODEL)).toEqual([
      {
        id: "2",
        repository: "acme/healthy",
        closed_pull_requests_checked_through: FIXED_START.toISOString(),
      },
    ]);
    expect(fake.logs.some((message) => message.includes("acme/broken"))).toBe(true);
  });

  it("processes visible configured repositories before reporting missing selections", async () => {
    const fake = new FakeNango();
    fake.metadata = { repositories: ["acme/visible", "acme/missing"] };
    const repository = githubRepository(3, "acme/visible");
    fake.setPages("/user/repos", [[repository]]);
    fake.setPages("/repos/acme/visible/pulls", [[]], "open");
    fake.setPages("/repos/acme/visible/pulls", [[]], "closed");

    await expect(
      executeSync(fake),
    ).rejects.toThrow(
      "acme/missing: configured repository is not visible to this GitHub connection",
    );
    expect(savedRecords(fake, REPOSITORY_STATE_MODEL)).toHaveLength(1);
  });
});

async function executeSync(fake: FakeNango): Promise<void> {
  setSystemTime(FIXED_START);
  await sync.exec(asNango(fake));
}

function githubRepository(id: string | number, fullName: string): Record<string, unknown> {
  return {
    id,
    node_id: `REPO_${id}`,
    full_name: fullName,
    private: true,
    provider_only_field: "kept",
  };
}

function pullRequestSummary(
  id: string | number,
  number: number,
  state: "open" | "closed",
  updatedAt: string,
): Record<string, unknown> {
  return {
    id,
    node_id: `PR_${id}`,
    number,
    state,
    title: `Pull request ${number}`,
    updated_at: updatedAt,
  };
}

function addHydration(
  fake: FakeNango,
  repository: string,
  summary: Record<string, unknown>,
  options: {
    multiPageCommits?: boolean;
    reportedCommitCount?: number;
  } = {},
): void {
  const number = summary["number"] as number;
  const id = summary["id"] as string | number;
  const base = `/repos/${repository}/pulls/${number}`;
  fake.setResponse(base, {
    ...summary,
    body: `Raw body for ${number}`,
    requested_reviewers: [{ id: 81, login: "sam" }],
    requested_teams: [{ id: 82, slug: "platform" }],
    head: { ref: "feature", sha: "head-sha" },
    base: { ref: "main", sha: "base-sha" },
    commits: options.reportedCommitCount ?? (options.multiPageCommits ? 2 : 1),
    changed_files: 1,
    provider_only_field: "kept",
  });
  fake.setPages(
    `${base}/commits`,
    options.multiPageCommits
      ? [[{ sha: "sha-a", commit: { message: "A" } }], [{ sha: "sha-b", commit: { message: "B" } }]]
      : [[{ sha: `sha-${id}`, commit: { message: "One commit" } }]],
  );
  fake.setPages(`${base}/reviews`, [[{
    id: `${id}-review`,
    node_id: `REVIEW_${id}`,
    state: "APPROVED",
  }]]);
  fake.setPages(`/repos/${repository}/issues/${number}/comments`, [[{
    id: `${id}-issue-comment`,
    body: "Discussion",
    provider_only_field: "kept",
  }]]);
  fake.setPages(`${base}/comments`, [[{
    id: `${id}-review-comment`,
    body: "Code comment",
    diff_hunk: "@@ -1 +1 @@",
    commit_id: "raw-commit-id",
  }]]);
}

function savedRecords(fake: FakeNango, model: string): Array<Record<string, unknown>> {
  return fake.savedBatches
    .filter((batch) => batch.model === model)
    .flatMap((batch) => batch.records)
    .map((record) => record as Record<string, unknown>);
}
