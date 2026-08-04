import { createSync, type ProxyConfiguration } from "nango";
import { z } from "zod";

import { PipelineRecordSchema, type PipelineRecord } from "../../pipeline-record.js";

const PULL_REQUEST_MODEL = "GitHubPullRequest" as const;
const REPOSITORY_STATE_MODEL = "GitHubRepositorySyncState" as const;

const PAGE_SIZE = 100;
const PROXY_RETRIES = 3;
const CLOSED_PULL_REQUEST_OVERLAP_MS = 5 * 60 * 1000;

const GITHUB_API_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const GitHubIdSchema = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
]);

const RepositoryFullNameSchema = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, "Expected a GitHub repository in owner/repo form");

const RawGitHubRepositorySchema = z.looseObject({
  id: GitHubIdSchema,
  full_name: RepositoryFullNameSchema,
});

const RawGitHubUserSchema = z.object({
  login: z.string().min(1),
});

const RawGitHubTeamSchema = z.object({
  slug: z.string().min(1),
});

const RawGitHubLabelSchema = z.object({
  name: z.string().min(1),
});

const RawGitHubMilestoneSchema = z.object({
  title: z.string().min(1),
});

const RawGitHubBranchSchema = z.object({
  ref: z.string().min(1),
  label: z.string().min(1).optional(),
});

const PullRequestListItemSchema = z.looseObject({
  id: GitHubIdSchema,
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  updated_at: z.iso.datetime({ offset: true }),
});

const RawGitHubPullRequestSchema = z.object({
  id: GitHubIdSchema,
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  title: z.string(),
  body: z.string().nullable().optional(),
  html_url: z.url(),
  user: RawGitHubUserSchema.nullable().optional(),
  assignees: z.array(RawGitHubUserSchema).optional().default([]),
  requested_reviewers: z.array(RawGitHubUserSchema).optional().default([]),
  requested_teams: z.array(RawGitHubTeamSchema).optional().default([]),
  labels: z.array(RawGitHubLabelSchema).optional().default([]),
  milestone: RawGitHubMilestoneSchema.nullable().optional(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  closed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  merged_at: z.iso.datetime({ offset: true }).nullable().optional(),
  draft: z.boolean().optional().default(false),
  head: RawGitHubBranchSchema,
  base: RawGitHubBranchSchema,
  commits: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  changed_files: z.number().int().nonnegative(),
});

const RawGitHubCommitSchema = z.object({
  sha: z.string().min(1),
  html_url: z.url().optional(),
  commit: z.object({
    message: z.string().optional(),
    author: z.object({
      name: z.string().nullable().optional(),
      date: z.iso.datetime({ offset: true }).nullable().optional(),
    }).nullable().optional(),
  }),
  author: RawGitHubUserSchema.nullable().optional(),
});

const RawGitHubReviewSchema = z.object({
  id: GitHubIdSchema,
  user: RawGitHubUserSchema.nullable().optional(),
  state: z.string().min(1),
  submitted_at: z.iso.datetime({ offset: true }).nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.url().optional(),
});

const RawGitHubIssueCommentSchema = z.object({
  id: GitHubIdSchema,
  user: RawGitHubUserSchema.nullable().optional(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  body: z.string().nullable().optional(),
  html_url: z.url().optional(),
});

const RawGitHubReviewCommentSchema = z.object({
  id: GitHubIdSchema,
  user: RawGitHubUserSchema.nullable().optional(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  body: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  line: z.number().int().positive().nullable().optional(),
  original_line: z.number().int().positive().nullable().optional(),
  html_url: z.url().optional(),
});

const GitHubPullRequestSchema = PipelineRecordSchema;

const GitHubRepositorySyncStateSchema = z.object({
  id: z.string().min(1),
  repository: RepositoryFullNameSchema,
  closed_pull_requests_checked_through: z.iso.datetime({ offset: true }),
});

const GitHubSyncMetadataSchema = z.object({
  repositories: z.array(RepositoryFullNameSchema).optional(),
});

type GitHubPullRequest = PipelineRecord;
type GitHubRepository = z.infer<typeof RawGitHubRepositorySchema>;
type GitHubRepositorySyncState = z.infer<typeof GitHubRepositorySyncStateSchema>;
type GitHubSyncMetadata = z.infer<typeof GitHubSyncMetadataSchema>;
type PullRequestListItem = z.infer<typeof PullRequestListItemSchema>;

const sync = createSync({
  description:
    "Sync compact, Markdown-first GitHub pull request records with complete discussion and review context",
  version: "2.0.0",
  frequency: "every half hour",
  autoStart: true,
  syncType: "incremental",
  scopes: ["repo"],
  metadata: GitHubSyncMetadataSchema,
  models: {
    GitHubPullRequest: GitHubPullRequestSchema,
    GitHubRepositorySyncState: GitHubRepositorySyncStateSchema,
  },
  exec: async (nango) => {
    await executeGitHubPullRequestSync(nango);
  },
});

export type NangoSyncLocal = Parameters<(typeof sync)["exec"]>[0];

async function executeGitHubPullRequestSync(
  nango: NangoSyncLocal,
  startedAt = new Date(),
): Promise<void> {
  if (Number.isNaN(startedAt.getTime())) {
    throw new Error("GitHub pull request sync received an invalid start time");
  }

  const metadata = GitHubSyncMetadataSchema.parse((await nango.getMetadata()) ?? {});
  const selection = await discoverRepositories(nango, metadata);
  const repositoryIds = selection.repositories.map((repository) => githubId(repository.id));
  const storedStates = await nango.getRecordsByIds<string, GitHubRepositorySyncState>(
    repositoryIds,
    REPOSITORY_STATE_MODEL,
  );
  const failures: RepositoryFailure[] = selection.missing.map((repository) => ({
    repository,
    error: "configured repository is not visible to this GitHub connection",
  }));

  for (const repository of selection.repositories) {
    const repositoryId = githubId(repository.id);
    try {
      const rawState = storedStates.get(repositoryId);
      const previousState = rawState
        ? GitHubRepositorySyncStateSchema.parse(rawState)
        : undefined;

      await syncRepository(nango, repository, previousState);
      await nango.batchSave(
        [
          GitHubRepositorySyncStateSchema.parse({
            id: repositoryId,
            repository: repository.full_name,
            closed_pull_requests_checked_through: startedAt.toISOString(),
          }),
        ],
        REPOSITORY_STATE_MODEL,
      );
    } catch (error) {
      const message = errorMessage(error);
      failures.push({ repository: repository.full_name, error: message });
      await nango.log(`GitHub pull request sync failed for ${repository.full_name}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `GitHub pull request sync failed for ${failures.length} ${pluralize("repository", failures.length)}: ${failures
        .map(({ repository, error }) => `${repository}: ${error}`)
        .join("; ")}`,
    );
  }
}

type RepositoryFailure = {
  repository: string;
  error: string;
};

type RepositorySelection = {
  repositories: GitHubRepository[];
  missing: string[];
};

async function discoverRepositories(
  nango: NangoSyncLocal,
  metadata: GitHubSyncMetadata,
): Promise<RepositorySelection> {
  const repositories = await fetchPaginated(
    nango,
    {
      endpoint: "/user/repos",
      headers: GITHUB_API_HEADERS,
      params: {
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "updated",
        direction: "desc",
        per_page: PAGE_SIZE,
      },
      paginate: linkPagination(),
      retries: PROXY_RETRIES,
    },
    RawGitHubRepositorySchema,
  );
  const uniqueRepositories = uniqueByStableId(repositories).sort((left, right) =>
    left.full_name.localeCompare(right.full_name),
  );

  if (metadata.repositories === undefined) {
    return { repositories: uniqueRepositories, missing: [] };
  }

  const requested = new Map(
    metadata.repositories.map((repository) => [repository.toLowerCase(), repository]),
  );
  const selected = uniqueRepositories.filter((repository) => {
    const key = repository.full_name.toLowerCase();
    if (!requested.has(key)) return false;
    requested.delete(key);
    return true;
  });

  return {
    repositories: selected,
    missing: [...requested.values()].sort(),
  };
}

async function syncRepository(
  nango: NangoSyncLocal,
  repository: GitHubRepository,
  previousState: GitHubRepositorySyncState | undefined,
): Promise<void> {
  const processedPullRequestIds = new Set<string>();
  const openCount = await syncPullRequestState(
    nango,
    repository,
    "open",
    undefined,
    processedPullRequestIds,
  );
  const closedCutoff = previousState
    ? new Date(
        Date.parse(previousState.closed_pull_requests_checked_through)
          - CLOSED_PULL_REQUEST_OVERLAP_MS,
      )
    : undefined;
  const closedCount = await syncPullRequestState(
    nango,
    repository,
    "closed",
    closedCutoff,
    processedPullRequestIds,
  );

  await nango.log(
    `Saved ${openCount} open and ${closedCount} closed GitHub pull request ${pluralize("snapshot", openCount + closedCount)} for ${repository.full_name}`,
  );
}

async function syncPullRequestState(
  nango: NangoSyncLocal,
  repository: GitHubRepository,
  state: "open" | "closed",
  updatedAtOrAfter: Date | undefined,
  processedPullRequestIds: Set<string>,
): Promise<number> {
  const { owner, repo } = parseRepositoryFullName(repository.full_name);
  const config = {
    endpoint: repositoryEndpoint(owner, repo, "/pulls"),
    headers: GITHUB_API_HEADERS,
    params: {
      state,
      sort: "updated",
      direction: "desc",
      per_page: PAGE_SIZE,
    },
    paginate: linkPagination(),
    retries: PROXY_RETRIES,
  } satisfies ProxyConfiguration;
  const cutoffTime = updatedAtOrAfter?.getTime();
  let saved = 0;
  let reachedCutoff = false;

  for await (const page of nango.paginate<unknown>(config)) {
    for (const rawPullRequest of page) {
      const pullRequest = PullRequestListItemSchema.parse(rawPullRequest);
      const sourceUpdatedAt = Date.parse(pullRequest.updated_at);
      if (cutoffTime !== undefined && sourceUpdatedAt < cutoffTime) {
        reachedCutoff = true;
        break;
      }

      const pullRequestId = githubId(pullRequest.id);
      if (processedPullRequestIds.has(pullRequestId)) continue;

      const snapshot = await hydratePullRequest(nango, repository, pullRequest);
      await nango.batchSave([snapshot], PULL_REQUEST_MODEL);
      processedPullRequestIds.add(pullRequestId);
      saved += 1;
    }

    if (reachedCutoff) break;
  }

  return saved;
}

async function hydratePullRequest(
  nango: NangoSyncLocal,
  repository: GitHubRepository,
  pullRequest: PullRequestListItem,
): Promise<GitHubPullRequest> {
  const { owner, repo } = parseRepositoryFullName(repository.full_name);
  const baseEndpoint = repositoryEndpoint(owner, repo, `/pulls/${pullRequest.number}`);
  const detailsResponse = await nango.get<unknown>({
    endpoint: baseEndpoint,
    headers: GITHUB_API_HEADERS,
    retries: PROXY_RETRIES,
  });
  const details = RawGitHubPullRequestSchema.parse(detailsResponse.data);
  const expectedId = githubId(pullRequest.id);
  const actualId = githubId(details.id);
  if (actualId !== expectedId) {
    throw new Error(
      `GitHub returned pull request id ${actualId} for list item ${expectedId} (${repository.full_name}#${pullRequest.number})`,
    );
  }

  const [commits, reviews, issueComments, reviewComments] = await Promise.all([
    fetchPaginated(
      nango,
      paginatedConfig(`${baseEndpoint}/commits`),
      RawGitHubCommitSchema,
    ),
    fetchPaginated(nango, paginatedConfig(`${baseEndpoint}/reviews`), RawGitHubReviewSchema),
    fetchPaginated(
      nango,
      paginatedConfig(repositoryEndpoint(owner, repo, `/issues/${pullRequest.number}/comments`)),
      RawGitHubIssueCommentSchema,
    ),
    fetchPaginated(
      nango,
      paginatedConfig(`${baseEndpoint}/comments`),
      RawGitHubReviewCommentSchema,
    ),
  ]);

  const collectionCompleteness = {
    commits: {
      expected: details.commits,
      fetched: commits.length,
      complete: commits.length === details.commits,
    },
  };
  if (!collectionCompleteness.commits.complete) {
    await nango.log(
      `GitHub capped related data for ${repository.full_name}#${pullRequest.number}: `
      + `${commits.length}/${details.commits} commits fetched`,
    );
  }
  const updatedAt = latestTimestamp([
    details.updated_at,
    ...reviews.map((review) => review.submitted_at),
    ...issueComments.map((comment) => comment.updated_at ?? comment.created_at),
    ...reviewComments.map((comment) => comment.updated_at ?? comment.created_at),
  ]);

  return GitHubPullRequestSchema.parse({
    id: actualId,
    created_at: details.created_at,
    updated_at: updatedAt,
    participants: participants(details, commits, reviews, issueComments, reviewComments),
    body: renderPullRequestBody(
      repository.full_name,
      details,
      commits,
      reviews,
      issueComments,
      reviewComments,
      collectionCompleteness,
      updatedAt,
    ),
  });
}

type CommitCompleteness = {
  commits: {
    expected: number;
    fetched: number;
    complete: boolean;
  };
};

function renderPullRequestBody(
  repository: string,
  pullRequest: z.infer<typeof RawGitHubPullRequestSchema>,
  commits: z.infer<typeof RawGitHubCommitSchema>[],
  reviews: z.infer<typeof RawGitHubReviewSchema>[],
  issueComments: z.infer<typeof RawGitHubIssueCommentSchema>[],
  reviewComments: z.infer<typeof RawGitHubReviewCommentSchema>[],
  completeness: CommitCompleteness,
  updatedAt: string,
): string {
  const status = pullRequest.merged_at
    ? "merged"
    : pullRequest.state === "closed"
      ? "closed"
      : pullRequest.draft
        ? "draft"
        : "open";
  const lines = [
    `# Pull request ${repository}#${pullRequest.number}: ${pullRequest.title}`,
    "",
    `- Status: ${status}`,
    `- Repository: ${repository}`,
    `- Author: ${actor(pullRequest.user)}`,
    `- Branch: \`${escapeCode(branch(pullRequest.head))}\` -> \`${escapeCode(branch(pullRequest.base))}\``,
    `- Created: ${pullRequest.created_at}`,
    `- Last activity: ${updatedAt}`,
    `- URL: ${pullRequest.html_url}`,
  ];

  if (pullRequest.merged_at) lines.push(`- Merged: ${pullRequest.merged_at}`);
  else if (pullRequest.closed_at) lines.push(`- Closed: ${pullRequest.closed_at}`);
  if (pullRequest.labels.length > 0) {
    lines.push(`- Labels: ${pullRequest.labels.map((label) => label.name).join(", ")}`);
  }
  if (pullRequest.assignees.length > 0) {
    lines.push(`- Assignees: ${pullRequest.assignees.map(actor).join(", ")}`);
  }
  const requestedReviewers = uniqueStrings([
    ...pullRequest.requested_reviewers.map(actor),
    ...pullRequest.requested_teams.map((team) => `@${team.slug}`),
  ]);
  if (requestedReviewers.length > 0) {
    lines.push(`- Requested reviewers: ${requestedReviewers.join(", ")}`);
  }
  if (pullRequest.milestone) lines.push(`- Milestone: ${pullRequest.milestone.title}`);
  lines.push(
    `- Change size: ${pullRequest.changed_files} ${pluralize("file", pullRequest.changed_files)}, ${pullRequest.additions ?? 0} ${pluralize("line", pullRequest.additions ?? 0)} added, ${pullRequest.deletions ?? 0} ${pluralize("line", pullRequest.deletions ?? 0)} removed`,
  );
  if (!completeness.commits.complete) {
    lines.push(
      `- Data warning: GitHub reported ${completeness.commits.expected} commits but returned ${completeness.commits.fetched}.`,
    );
  }

  lines.push("", "## Description", "", normalizedText(pullRequest.body) ?? "(no description)");

  if (commits.length > 0) {
    lines.push("", "## Commits", "");
    for (const commit of commits) {
      const message = splitMessage(commit.commit.message);
      const timestamp = commit.commit.author?.date;
      const commitAuthor = commit.author?.login ?? commit.commit.author?.name ?? "unknown";
      lines.push(
        `### ${headingParts(timestamp, `@${commitAuthor}`, `${commit.sha.slice(0, 12)} ${message.title}`)}`,
      );
      if (message.body) lines.push("", message.body);
      if (commit.html_url) lines.push("", `Link: ${commit.html_url}`);
      lines.push("");
    }
  }

  const events = [
    ...reviews.map((review) => ({
      timestamp: review.submitted_at ?? undefined,
      author: actor(review.user),
      title: `Review ${review.state.toLowerCase().replaceAll("_", " ")}`,
      body: normalizedText(review.body) ?? `${actor(review.user)} submitted this review.`,
      url: review.html_url,
    })),
    ...issueComments
      .filter((comment) => normalizedText(comment.body))
      .map((comment) => ({
        timestamp: comment.created_at,
        author: actor(comment.user),
        title: "Discussion comment",
        body: normalizedText(comment.body)!,
        url: comment.html_url,
      })),
    ...reviewComments
      .filter((comment) => normalizedText(comment.body))
      .map((comment) => ({
        timestamp: comment.created_at,
        author: actor(comment.user),
        title: `Code review comment${codeLocation(comment)}`,
        body: normalizedText(comment.body)!,
        url: comment.html_url,
      })),
  ].sort((left, right) => timestampValue(left.timestamp) - timestampValue(right.timestamp));

  if (events.length > 0) {
    lines.push("", "## Reviews and comments", "");
    for (const event of events) {
      lines.push(`### ${headingParts(event.timestamp, event.author, event.title)}`, "", event.body);
      if (event.url) lines.push("", `Link: ${event.url}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

function participants(
  pullRequest: z.infer<typeof RawGitHubPullRequestSchema>,
  commits: z.infer<typeof RawGitHubCommitSchema>[],
  reviews: z.infer<typeof RawGitHubReviewSchema>[],
  issueComments: z.infer<typeof RawGitHubIssueCommentSchema>[],
  reviewComments: z.infer<typeof RawGitHubReviewCommentSchema>[],
): string[] {
  return uniqueStrings([
    pullRequest.user?.login,
    ...pullRequest.assignees.map((user) => user.login),
    ...pullRequest.requested_reviewers.map((user) => user.login),
    ...pullRequest.requested_teams.map((team) => team.slug),
    ...commits.map((commit) => commit.author?.login ?? commit.commit.author?.name ?? undefined),
    ...reviews.map((review) => review.user?.login),
    ...issueComments.map((comment) => comment.user?.login),
    ...reviewComments.map((comment) => comment.user?.login),
  ].filter((value): value is string => Boolean(value && value !== "unknown")));
}

function actor(user: z.infer<typeof RawGitHubUserSchema> | null | undefined): string {
  return user ? `@${user.login}` : "unknown";
}

function branch(value: z.infer<typeof RawGitHubBranchSchema>): string {
  return value.label ?? value.ref;
}

function escapeCode(value: string): string {
  return value.replaceAll("`", "\\`");
}

function normalizedText(value: string | null | undefined): string | undefined {
  const normalized = value?.replaceAll("\r\n", "\n").trim();
  return normalized ? normalized : undefined;
}

function splitMessage(value: string | undefined): { title: string; body?: string } {
  const normalized = normalizedText(value) ?? "(no commit message)";
  const [title, ...rest] = normalized.split("\n");
  const body = rest.join("\n").trim();
  return { title: title!, ...(body ? { body } : {}) };
}

function headingParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" - ");
}

function codeLocation(comment: z.infer<typeof RawGitHubReviewCommentSchema>): string {
  if (!comment.path) return "";
  const line = comment.line ?? comment.original_line;
  return ` on \`${escapeCode(comment.path)}${line ? `:${line}` : ""}\``;
}

function timestampValue(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.MAX_SAFE_INTEGER;
}

function latestTimestamp(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function paginatedConfig(endpoint: string): ProxyConfiguration {
  return {
    endpoint,
    headers: GITHUB_API_HEADERS,
    params: { per_page: PAGE_SIZE },
    paginate: linkPagination(),
    retries: PROXY_RETRIES,
  };
}

async function fetchPaginated<T>(
  nango: NangoSyncLocal,
  config: ProxyConfiguration,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const values: T[] = [];
  for await (const page of nango.paginate<unknown>(config)) {
    for (const value of page) {
      values.push(schema.parse(value));
    }
  }
  return values;
}

function linkPagination(): NonNullable<ProxyConfiguration["paginate"]> {
  return {
    type: "link",
    limit_name_in_request: "per_page",
    limit: PAGE_SIZE,
    link_rel_in_response_header: "next",
  };
}

function repositoryEndpoint(owner: string, repo: string, suffix: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

function parseRepositoryFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid GitHub repository ${JSON.stringify(fullName)}; expected owner/repo`);
  }
  return { owner, repo };
}

function githubId(value: z.infer<typeof GitHubIdSchema>): string {
  return String(value);
}

function uniqueByStableId(repositories: GitHubRepository[]): GitHubRepository[] {
  const byId = new Map<string, GitHubRepository>();
  for (const repository of repositories) {
    byId.set(githubId(repository.id), repository);
  }
  return [...byId.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export default sync;
