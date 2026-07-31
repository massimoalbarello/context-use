import { createSync, type ProxyConfiguration } from "nango";
import { z } from "zod";

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

const PullRequestListItemSchema = z.looseObject({
  id: GitHubIdSchema,
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  updated_at: z.iso.datetime({ offset: true }),
});

const RawGitHubPullRequestSchema = z.looseObject({
  id: GitHubIdSchema,
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  updated_at: z.iso.datetime({ offset: true }),
  commits: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
});

const RawGitHubCommitSchema = z.looseObject({
  sha: z.string().min(1),
});

const RawGitHubReviewSchema = z.looseObject({
  id: GitHubIdSchema,
});

const RawGitHubIssueCommentSchema = z.looseObject({
  id: GitHubIdSchema,
});

const RawGitHubReviewCommentSchema = z.looseObject({
  id: GitHubIdSchema,
});

const GitHubPullRequestSchema = z.object({
  id: z.string().min(1),
  repository_id: z.string().min(1),
  repository: RepositoryFullNameSchema,
  number: z.number().int().positive(),
  source_updated_at: z.iso.datetime({ offset: true }),
  pull_request: RawGitHubPullRequestSchema,
  commits: z.array(RawGitHubCommitSchema),
  reviews: z.array(RawGitHubReviewSchema),
  issue_comments: z.array(RawGitHubIssueCommentSchema),
  review_comments: z.array(RawGitHubReviewCommentSchema),
  collection_completeness: z.object({
    commits: z.object({
      expected: z.number().int().nonnegative(),
      fetched: z.number().int().nonnegative(),
      complete: z.boolean(),
    }),
  }),
});

const GitHubRepositorySyncStateSchema = z.object({
  id: z.string().min(1),
  repository: RepositoryFullNameSchema,
  closed_pull_requests_checked_through: z.iso.datetime({ offset: true }),
});

const GitHubSyncMetadataSchema = z.object({
  repositories: z.array(RepositoryFullNameSchema).optional(),
});

type GitHubPullRequest = z.infer<typeof GitHubPullRequestSchema>;
type GitHubRepository = z.infer<typeof RawGitHubRepositorySchema>;
type GitHubRepositorySyncState = z.infer<typeof GitHubRepositorySyncStateSchema>;
type GitHubSyncMetadata = z.infer<typeof GitHubSyncMetadataSchema>;
type PullRequestListItem = z.infer<typeof PullRequestListItemSchema>;

const sync = createSync({
  description:
    "Sync raw GitHub pull request snapshots with explicit commit-list completeness and per-repository incremental state",
  version: "1.0.0",
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

  return GitHubPullRequestSchema.parse({
    id: actualId,
    repository_id: githubId(repository.id),
    repository: repository.full_name,
    number: details.number,
    source_updated_at: details.updated_at,
    pull_request: details,
    commits,
    reviews,
    issue_comments: issueComments,
    review_comments: reviewComments,
    collection_completeness: collectionCompleteness,
  });
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
