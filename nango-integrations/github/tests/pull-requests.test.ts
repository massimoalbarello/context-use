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
      {
        id: "granola",
        provider: "granola-mcp",
        displayName: "Granola",
        forwardWebhooks: false,
        setup: "manual",
      },
    ]);
    expect(MANAGED_FUNCTIONS).toEqual([
      {
        integrationId: "github",
        name: "pull-requests",
        type: "sync",
        models: ["GitHubPullRequest", "GitHubRepositorySyncState"],
        pipelineModels: ["GitHubPullRequest"],
      },
      {
        integrationId: "granola",
        name: "meetings",
        type: "sync",
        models: ["GranolaMeeting"],
        pipelineModels: ["GranolaMeeting"],
      },
    ]);
    expect(sync.frequency).toBe("every half hour");
    expect(sync.version).toBe("2.0.0");
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

  it("hydrates every open PR and only overlapping closed PRs as compact Markdown records", async () => {
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

    const records = pullRequestBatches.flatMap((batch) => batch.records);
    const openRecord = GitHubPullRequestSchema.parse(records[0]);
    expect(openRecord).toMatchObject({
      id: "1001",
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
      participants: ["alex", "maya", "platform", "priya", "sam", "taylor"],
    });
    expect(Object.keys(openRecord)).toEqual([
      "id",
      "created_at",
      "updated_at",
      "participants",
      "body",
    ]);
    expect(openRecord.body).toContain("# Pull request acme/widgets#11: Pull request 11");
    expect(openRecord.body).toContain("- Author: @maya");
    expect(openRecord.body).toContain("- Status: open");
    expect(openRecord.body).toContain("- Branch: `maya:feature` -> `acme:main`");
    expect(openRecord.body).toContain("- Labels: integration");
    expect(openRecord.body).toContain("- Assignees: @alex");
    expect(openRecord.body).toContain("- Requested reviewers: @platform, @sam");
    expect(openRecord.body).toContain("- Milestone: Readable records");
    expect(openRecord.body).toContain("- Change size: 1 file, 12 lines added, 3 lines removed");
    expect(openRecord.body).toContain("- URL: https://github.com/acme/widgets/pull/11");
    expect(openRecord.body).toContain("## Description\n\nRaw body for 11");
    expect(openRecord.body).toContain("## Commits");
    expect(openRecord.body).toContain("sha-a First commit");
    expect(openRecord.body).toContain("Additional commit context.");
    expect(openRecord.body).toContain("Review approved");
    expect(openRecord.body).toContain("Discussion comment");
    expect(openRecord.body).toContain("Code review comment on `src/example.ts:88`");
    expect(openRecord.body).toContain("Code comment");

    const serialized = JSON.stringify(openRecord);
    for (const providerField of [
      "node_id",
      "provider_only_field",
      "diff_hunk",
      "commit_id",
      "pull_request",
      "requested_reviewers",
    ]) {
      expect(serialized).not.toContain(providerField);
    }

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
    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]).toMatchObject({ id: "2001" });
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

    expect(savedRecords(fake, PULL_REQUEST_MODEL)[0]?.["body"]).toContain(
      "Data warning: GitHub reported 251 commits but returned 1.",
    );
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
    html_url: `https://github.com/${repository}/pull/${number}`,
    user: { id: 80, login: "maya" },
    assignees: [{ id: 83, login: "alex" }],
    requested_reviewers: [{ id: 81, login: "sam" }],
    requested_teams: [{ id: 82, slug: "platform" }],
    labels: [{ id: 1, name: "integration" }],
    milestone: { id: 2, title: "Readable records" },
    created_at: summary["updated_at"],
    closed_at: summary["state"] === "closed" ? summary["updated_at"] : null,
    merged_at: null,
    draft: false,
    head: { ref: "feature", label: "maya:feature", sha: "head-sha" },
    base: { ref: "main", label: "acme:main", sha: "base-sha" },
    commits: options.reportedCommitCount ?? (options.multiPageCommits ? 2 : 1),
    additions: 12,
    deletions: 3,
    changed_files: 1,
    provider_only_field: "kept",
  });
  fake.setPages(
    `${base}/commits`,
    options.multiPageCommits
      ? [[githubCommit("sha-a", "First commit\n\nAdditional commit context.", summary["updated_at"] as string)], [
        githubCommit("sha-b", "Second commit", summary["updated_at"] as string),
      ]]
      : [[githubCommit(`sha-${id}`, "One commit", summary["updated_at"] as string)]],
  );
  fake.setPages(`${base}/reviews`, [[{
    id: `${id}-review`,
    node_id: `REVIEW_${id}`,
    user: { id: 83, login: "alex" },
    state: "APPROVED",
    submitted_at: summary["updated_at"],
    body: "Schema looks clean.",
    html_url: `https://github.com/${repository}/pull/${number}#review`,
  }]]);
  fake.setPages(`/repos/${repository}/issues/${number}/comments`, [[{
    id: `${id}-issue-comment`,
    user: { id: 84, login: "taylor" },
    created_at: summary["updated_at"],
    updated_at: summary["updated_at"],
    body: "Discussion",
    html_url: `https://github.com/${repository}/pull/${number}#discussion`,
    provider_only_field: "kept",
  }]]);
  fake.setPages(`${base}/comments`, [[{
    id: `${id}-review-comment`,
    user: { id: 85, login: "priya" },
    created_at: summary["updated_at"],
    updated_at: summary["updated_at"],
    body: "Code comment",
    path: "src/example.ts",
    line: 88,
    html_url: `https://github.com/${repository}/pull/${number}#code-comment`,
    diff_hunk: "@@ -1 +1 @@",
    commit_id: "raw-commit-id",
  }]]);
}

function githubCommit(sha: string, message: string, timestamp: string): Record<string, unknown> {
  return {
    sha,
    node_id: `COMMIT_${sha}`,
    html_url: `https://github.com/acme/widgets/commit/${sha}`,
    author: { id: 80, login: "maya" },
    commit: {
      message,
      author: { name: "Maya", email: "maya@example.com", date: timestamp },
      tree: { sha: "provider-tree-sha" },
    },
  };
}

function savedRecords(fake: FakeNango, model: string): Array<Record<string, unknown>> {
  return fake.savedBatches
    .filter((batch) => batch.model === model)
    .flatMap((batch) => batch.records)
    .map((record) => record as Record<string, unknown>);
}
