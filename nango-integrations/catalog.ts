export const GITHUB_OAUTH_SCOPES = ["repo"] as const;

export const MANAGED_INTEGRATIONS = [
  {
    id: "github",
    provider: "github",
    displayName: "GitHub",
    forwardWebhooks: false,
    oauth: {
      scopes: GITHUB_OAUTH_SCOPES,
    },
  },
] as const;

export const MANAGED_FUNCTIONS = [
  {
    integrationId: "github",
    name: "pull-requests",
    type: "sync" as const,
    models: ["GitHubPullRequest", "GitHubRepositorySyncState"] as const,
    pipelineModels: ["GitHubPullRequest"] as const,
  },
] as const;
